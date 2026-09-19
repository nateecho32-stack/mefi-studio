// Mefi's Studio AI+ — Electron main process (CommonJS: Electron's most reliable main format).
// Window + IPC for the catalog, the LÖVE launcher, and the optional speed probe.

const { spawn } = require("node:child_process");
const { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveStudioPaths } = require("./scripts/paths.cjs");
const { createProjects } = require("./scripts/projects.cjs");
const electron = require("electron");

if (typeof electron === "string" || !electron.app) {
  console.error(
    "[mefi-studio] Electron did not start as a GUI process.\n" +
      "ELECTRON_RUN_AS_NODE is set in this shell, so electron ran as plain Node.\n" +
      "Clear it (Remove-Item Env:ELECTRON_RUN_AS_NODE) and run: npm start"
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, clipboard, desktopCapturer, powerSaveBlocker, Tray, Menu, nativeImage, screen } = electron;

const STUDIO_ROOT = __dirname;
const { sourceRoot: SOURCE_ROOT, repoRoot: REPO_ROOT, gameRoot: GAME_ROOT } = resolveStudioPaths({
  studioRoot: STUDIO_ROOT,
  isPackaged: app.isPackaged,
  executablePath: process.execPath,
});
const SMOKE = process.argv.includes("--smoke");
const CAPTURE = process.argv.includes("--capture") || process.argv.includes("--capture-idle");
const CLI_MODE = process.argv.some((arg) =>
  ["--set-key", "--set-zai-key", "--set-gateway-key", "--jev-probe", "--jev-status", "--jev-models", "--speed-probe", "--assistant-brief", "--assistant-improve", "--assistant-grow", "--assistant-audit", "--assistant-proactive", "--assistant-all"].includes(arg)
);

// GUI launches are single-instance: two windows would fight over the same
// userData cache and double every watcher. CLI runs skip the lock so headless
// briefs still work while the app is open.
if (!SMOKE && !CAPTURE && !CLI_MODE) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
}
const LOVE_DIR = GAME_ROOT && path.join(GAME_ROOT, "build", "cache", "love-11.5-win64");
const LOVE_EXE = LOVE_DIR && path.join(LOVE_DIR, "love.exe");
const DEV_PROJECT = GAME_ROOT && path.join(GAME_ROOT, "dev", "dev_tool_love_project");
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
const projects = createProjects({
  defaultRoot: REPO_ROOT,
  studioRoot: STUDIO_ROOT,
  preferredRoot: process.env.MEFI_STUDIO_REPO ? REPO_ROOT : null,
  saved: (() => { try { return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")).projects; } catch { return {}; } })(),
  isDirectory: (root) => { try { return statSync(root).isDirectory(); } catch { return false; } },
});
const projectRoot = () => projects.current().path;
const projectDataPath = (file) => projects.dataPath(file);
const isStudioProject = () => path.resolve(projectRoot()).toLowerCase() === path.resolve(SOURCE_ROOT).toLowerCase();
let projectSwitching = false;
let projectOperations = 0;
let projectBoardWrites = 0;
let projectAgentJobs = 0;
const originalIpcHandle = ipcMain.handle.bind(ipcMain);

function handleProjectIpc(channel, handler) {
  if (channel.startsWith("projects:")) return originalIpcHandle(channel, handler);
  originalIpcHandle(channel, (_event, ...args) => {
    if (projectSwitching) return { ok: false, error: "Switching projects. Try again in a moment." };
    const project = projects.active();
    projectOperations += 1;
    return projects.run(project, () => Promise.resolve().then(() => handler(_event, ...args)).finally(() => { projectOperations -= 1; }));
  });
}
ipcMain.handle = handleProjectIpc;

app.setName("Mefi's Studio AI+");

let window = null;
let activeChild = null;
let eyesTimer = null;
let eyesLastTs = Date.now();

// Script modules load through one versioned importer so a live update can
// drop a cached copy: after invalidateModules() the next getter call imports
// `file:///…?v=N` and the running process picks up the new file, no restart.
const moduleVersions = new Map();
const moduleCache = new Map();

async function loadModule(rel) {
  const version = moduleVersions.get(rel) ?? 0;
  const cached = moduleCache.get(rel);
  if (cached && cached.version === version) return cached.module;
  const module = await import(`${pathToFileURL(path.join(STUDIO_ROOT, rel)).href}?v=${version}`);
  moduleCache.set(rel, { version, module });
  return module;
}

function invalidateModules(rels) {
  const swapped = [];
  for (const rel of rels ?? []) {
    const key = String(rel).replace(/\\/g, "/");
    moduleVersions.set(key, (moduleVersions.get(key) ?? 0) + 1);
    moduleCache.delete(key);
    swapped.push(key);
  }
  return swapped;
}

async function getEyes() {
  const project = projects.current();
  // NOTE: the board's SQLite authority (enableBoardStore) is intentionally
  // NOT activated yet — the patch is still half-landed: boardRowSlots()
  // returns 10/11 slots for tasks/ideas against an 11-placeholder insert,
  // the schema lacks created_at/updated_at on requests and ideas, and a
  // stale ~/.local/share/mefi-studio/board.db already carries migrated=1,
  // so enabling today makes every board read fail to an empty list. When
  // the store passes a read/write round trip, activate it here:
  //   eyes.enableBoardStore(eyes.defaultBoardConfig(STUDIO_ROOT));
  return projects.eyes(await loadModule("scripts/eyes.mjs"), project);
}

async function getAuditor() {
  const auditor = await loadModule("scripts/auditor.mjs");
  if (isStudioProject()) return auditor;
  // Studio's wiring audit is specific to Studio. Never file its findings as
  // work for an unrelated project merely because that folder is selected.
  return { ...auditor, audit: async () => ({ ok: true, skipped: true, errors: 0, warnings: 0, findings: [], checkedAt: Date.now(), text: "Studio wiring audit applies to the Studio project. Use this project's own checks." }), auditRequests: () => [] };
}

async function getAnalyzer() {
  return loadModule("scripts/analyzer.mjs");
}

async function getReference() {
  return loadModule("scripts/reference.mjs");
}

async function getMachine() {
  return loadModule("scripts/machine.mjs");
}

// The Policy Lab's modules (build brief): the frozen baseline policy, the
// append-only experience store, and the verification receipts. All observation
// layer — none of them may claim work, spawn children, or write board stores.
async function getPolicyModule() {
  return loadModule("scripts/policy.mjs");
}

async function getExperienceModule() {
  return loadModule("scripts/experience.mjs");
}

async function getReceiptsModule() {
  return loadModule("scripts/receipts.mjs");
}

// The assistant service also reads this pointer synchronously (caps, roster
// helpers), so the getter refreshes it after a swap.
let assistantModule = null;
async function getAssistant() {
  assistantModule = await loadModule("scripts/assistant.mjs");
  return assistantModule;
}

const MACHINE_STATUS_PATH = path.join(STUDIO_ROOT, "data", "machine-status.json");
const RESOURCE_LOG_PATH = path.join(STUDIO_ROOT, "data", "resource-manager.json");
const MACHINE_DEFAULTS = { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 };
let machineTimer = null;
let machinePreviousCpu = new Map();
const machineEvents = [];
let machineReadInFlight = null;
let machineReadCache = null;

// UI readers share a scan and may reuse a two-second snapshot. Resource
// enforcement bypasses this cache and always gets fresh process information.
function readMachineStatus({ kill = false } = {}) {
  if (kill) {
    machineReadCache = null;
    return resourcePass({ kill: true, reason: "manual" });
  }
  if (machineReadInFlight) return machineReadInFlight;
  if (machineReadCache && Date.now() - machineReadCache.at < 2000) return Promise.resolve(machineReadCache.status);
  machineReadInFlight = resourcePass({ kill: false, reason: "manual" }).then((status) => {
    machineReadCache = { at: Date.now(), status };
    return status;
  }).finally(() => { machineReadInFlight = null; });
  return machineReadInFlight;
}

// Resource manager: watches LOVE test runs, kills strays/hangs/over-age
// processes, and tells the agents through the inbox + briefing facts.
// `withProcesses: false` skips the PowerShell process scan (the expensive
// part) and only refreshes lease state.
async function resourcePass({ kill = true, reason = "poll", withProcesses = true } = {}) {
  const machine = await getMachine();
  const eyes = await getEyes();
  const settings = await readSettings();
  const limits = { ...MACHINE_DEFAULTS, ...(settings.machine ?? {}) };
  const leases = await machine.leaseStatus({ repoRoot: projectRoot() });
  const processes = withProcesses ? await machine.processSnapshot() : [];
  const { verdicts } = withProcesses ? machine.classify({ processes, previousCpu: machinePreviousCpu, limits }) : { verdicts: [] };
  if (withProcesses) machinePreviousCpu = new Map(processes.map((row) => [row.pid, row.cpuMs]));

  const actions = [];
  if (kill && limits.autoKill) {
    for (const verdict of verdicts) {
      if (!verdict.killable) continue;
      spawn("taskkill", ["/pid", String(verdict.pid), "/t", "/f"], { windowsHide: true });
      const action = { at: Date.now(), reason, pid: verdict.pid, status: verdict.status, label: verdict.name, commandLine: verdict.commandLine };
      actions.push(action);
      machineEvents.unshift(action);
      logLine(`[machine] killed pid ${verdict.pid} (${verdict.status})`);
      await queueRequests([
        {
          title: `Test run killed (${verdict.status})`,
          prompt:
            `Resource manager killed ${verdict.name} pid ${verdict.pid} (${verdict.status}${verdict.ageMinutes ? `, ${verdict.ageMinutes}m old` : ""}). ` +
            `Command: ${verdict.commandLine}. The machine is free for the next run; re-run the test after checking the failure output.`,
          source: "machine",
          at: Date.now(),
        },
      ]);
    }
  }

  const running = verdicts.filter((verdict) => verdict.test);
  const status = {
    updatedAt: new Date().toISOString(),
    reason,
    leases: {
      busy: leases.busy,
      exclusive: leases.exclusive,
      totalWidth: leases.totalWidth,
      holders: leases.holders,
    },
    running,
    processes: verdicts,
    actions,
    wait: leases.busy,
    lines: machine.describe({ leases, processes: verdicts, actions }),
  };
  await eyes.writeJson(MACHINE_STATUS_PATH, status);
  await eyes.writeJson(RESOURCE_LOG_PATH, { updatedAt: status.updatedAt, events: machineEvents.slice(0, 60) });
  send("machine:status", status);
  return status;
}

function startMachineWatch() {
  if (machineTimer) return { ok: true, running: true };
  let lastProcessScan = 0;
  const tick = async () => {
    let leases = { busy: false };
    try {
      const machine = await getMachine();
      leases = await machine.leaseStatus({ repoRoot: projectRoot() });
    } catch {}
    const hidden = window && (window.isMinimized() || !window.isVisible());
    // PowerShell process scan only when tests are running or every 30s as a
    // backstop; lease reads are cheap filesystem calls either way.
    const withProcesses = !hidden && (leases.busy || Date.now() - lastProcessScan > 30000);
    if (withProcesses) lastProcessScan = Date.now();
    try {
      await resourcePass({ kill: true, reason: withProcesses ? "poll" : "leases", withProcesses });
    } catch (error) {
      logLine(`[machine] scan failed: ${error.message}`);
    }
    machineTimer = setTimeout(() => projects.run(projects.active(), tick), hidden ? 20000 : leases.busy ? 5000 : 10000);
  };
  machineTimer = setTimeout(() => projects.run(projects.active(), tick), 1500);
  machineTimer.unref?.();
  return { ok: true, running: true };
}

function stopMachineWatch() {
  if (machineTimer) clearTimeout(machineTimer);
  machineTimer = null;
  return { ok: true, running: false };
}

// ---- live update: watch the source tree, then reload or relaunch --------
// Dev runs from the source tree itself; the packaged payload watches the repo
// it was built from. Agents edit the source, this turns that into a running app.
const UPDATE_SOURCE_ROOT = SOURCE_ROOT;
const UPDATE_GRACE_MS = 250;
let updater = null;

function relaunchArgs() {
  const args = process.argv.slice(1).filter((arg) => !arg.startsWith("--updated"));
  args.push("--updated");
  return args;
}

function updateEvent(patch) {
  return { phase: "idle", kind: null, files: [], error: null, reason: null, auto: true, watching: Boolean(updater), at: Date.now(), ...patch };
}

// The renderer writes localStorage["mefiStudio.resume"] so the next boot lands
// back on the Command view / sheet the user was looking at. Awaited, so the
// write always happens before the page goes away.
async function saveResume() {
  if (!window || window.isDestroyed()) return;
  try {
    await window.webContents.executeJavaScript("window.MefiNav?.saveResume?.() ?? null", true);
  } catch {}
}

async function applyReload(files) {
  if (!window || window.isDestroyed()) return { ok: false };
  await saveResume();
  window.webContents.once("did-finish-load", () =>
    send("update:event", updateEvent({ phase: "reloaded", kind: "reload", files, auto: updater?.status().auto !== false, watching: true }))
  );
  window.webContents.reloadIgnoringCache();
  return { ok: true };
}

// Styles land in the live page: the renderer swaps the text of its style
// slot. false (no slot, no page) sends the engine down the reload path.
async function applyStyle(files) {
  if (!window || window.isDestroyed()) return false;
  let css;
  try {
    css = await readFile(path.join(STUDIO_ROOT, "renderer", "styles.css"), "utf8");
  } catch {
    return false;
  }
  let applied = false;
  try {
    applied = (await window.webContents.executeJavaScript(`window.MefiNav?.applyStyles?.(${JSON.stringify(css)}) === true`, true)) === true;
  } catch {
    applied = false;
  }
  if (!applied) return false;
  send("update:event", updateEvent({ phase: "styled", kind: "style", files, auto: updater?.status().auto !== false, watching: true }));
  logLine("[update] styles applied in place");
  return true;
}

// Changed script modules are re-imported in this process: the getters drop
// their cached copy, the assistant re-reads its logic at once, and a changed
// updater restarts the watcher from the new file once this pass is over.
async function applyModules(rels) {
  const swapped = invalidateModules(rels);
  if (swapped.includes("scripts/assistant.mjs")) {
    try {
      await getAssistant();
      assistantLog("control", "swapped scripts/assistant.mjs");
    } catch (error) {
      logLine(`[update] assistant.mjs swap failed: ${error?.message ?? error}`);
    }
  }
  if (swapped.includes("scripts/updater.mjs")) {
    setTimeout(() => {
      stopUpdateWatch();
      startUpdateWatch().catch((error) => logLine(`[update] watcher restart failed: ${error?.message ?? error}`));
    }, 0);
  }
  send("update:event", updateEvent({ phase: "swapped", kind: "modules", files: swapped, auto: updater?.status().auto !== false, watching: true }));
  logLine(`[update] swapped ${swapped.join(", ")}`);
  return { ok: true, modules: swapped };
}

// The engine's pause gate. A hidden, minimized or unfocused window can take a
// reload or restart now; a visible one waits until the user has been idle
// for 4 s with no unsaved text in a field, or 30 s regardless. It never gives
// up: a manual apply bypasses it. A page that cannot report activity (an
// older build) is treated as paused.
async function awaitPause(kind) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (;;) {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized() || !window.isVisible() || !window.isFocused()) return;
    let activity = null;
    try {
      activity = await window.webContents.executeJavaScript("window.MefiNav?.activity?.() ?? null", true);
    } catch {}
    if (!activity || typeof activity !== "object") return;
    const idleMs = Number(activity.idleMs) || 0;
    if ((idleMs >= 4000 && !activity.typing) || idleMs >= 30000) return;
    await pause(1000);
  }
}

// counted: false is the manual "Restart now" — the user, not a loop. Only
// restarts the updater itself asked for may feed the restart-loop guard.
// How long a live update may sit behind running build jobs before it goes
// through regardless. Long enough for a normal run, short enough that a busy
// builder cannot pin the app on stale code.
const UPDATE_MAX_HOLD_MS = 15 * 60000;
let restartHeldSince = 0;

async function applyRestart(files, { counted = true } = {}) {
  // A relaunch taskkills the LOVE child (see the process exit hook); park the
  // update instead of shooting the user's running game.
  if (activeChild && activeChild.exitCode === null) return { deferred: true, reason: "Love2D is running" };
  // Same for the builders, and for the same reason. The agents edit this repo,
  // main.cjs is a restart-class file, and a restart kills every `opencode run`
  // it spawned — so the loop was shooting itself: agent edits main.cjs, app
  // restarts ~20 s later, agent dies, nothing ever finished. The deferral is
  // safe because a run is hard-killed at EXECUTOR_KILL_MS, so it always ends.
  if (autopilot.jobs.length) {
    // Bounded, though: with three slots and a full queue the builder is rarely
    // idle, and a hold with no ceiling would mean core changes never land at
    // all. Past the ceiling the restart wins and the runs are re-queued by
    // housekeeping, which rescues any claim whose job is gone.
    restartHeldSince = restartHeldSince || Date.now();
    if (Date.now() - restartHeldSince < UPDATE_MAX_HOLD_MS) {
      return { deferred: true, reason: `${autopilot.jobs.length} build job(s) running` };
    }
    logLine(`[update] restart held ${Math.round((Date.now() - restartHeldSince) / 60000)}m behind the builders — applying anyway`);
  }
  restartHeldSince = 0;
  const settings = await readSettings();
  const at = Date.now();
  const recent = (settings.update?.restarts ?? []).filter((stamp) => at - stamp < 60000);
  settings.update = {
    ...(settings.update ?? {}),
    auto: updater?.status().auto !== false,
    lastRestart: { at, files, kind: "restart" },
    restarts: counted ? [...recent, at].slice(-5) : recent,
  };
  // The relaunched window comes back where this one was.
  if (window && !window.isDestroyed()) settings.window = { bounds: window.getBounds(), maximized: window.isMaximized() };
  await writeSettings(settings);
  await saveResume();
  try {
    window?.webContents.session.flushStorageData();
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, UPDATE_GRACE_MS));
  stopUpdateWatch();
  stopEyesWatch();
  stopMachineWatch();
  // Free the lock before relaunching, or the new instance can lose the race
  // against this one exiting and quit itself.
  app.releaseSingleInstanceLock();
  app.relaunch({ args: relaunchArgs() });
  app.exit(0);
  return { ok: true };
}

async function startUpdateWatch() {
  if (updater || SMOKE || CAPTURE || CLI_MODE) return { ok: true, running: Boolean(updater) };
  if (!existsSync(path.join(UPDATE_SOURCE_ROOT, "renderer", "booklet.template.html"))) {
    send("update:event", updateEvent({ reason: "source tree not found", watching: false }));
    return { ok: false, error: "source tree not found" };
  }
  const settings = await readSettings();
  const at = Date.now();
  // Always load the payload's own copy: the source copy may be mid-edit. The
  // mtime in the URL makes a swapped updater import fresh instead of cached.
  const file = path.join(STUDIO_ROOT, "scripts", "updater.mjs");
  const info = await stat(file);
  const module = await import(`${pathToFileURL(file).href}?v=${Math.floor(info.mtimeMs)}`);
  updater = module.createUpdater({
    sourceRoot: UPDATE_SOURCE_ROOT,
    appRoot: STUDIO_ROOT,
    packaged: app.isPackaged,
    execPath: process.execPath,
    auto: settings.update?.auto !== false,
    restartHistory: (settings.update?.restarts ?? []).filter((stamp) => at - stamp < 60000),
    actions: { reload: applyReload, restart: applyRestart, style: applyStyle, modules: applyModules },
    gate: awaitPause,
    // document.hidden's main-process twin: while the window is minimized or
    // hidden the updater pauses its stat-walk poll (watchers stay live).
    hidden: () => {
      try {
        return Boolean(window && (window.isMinimized() || !window.isVisible()));
      } catch {
        return false;
      }
    },
    onEvent: (payload) => send("update:event", payload),
  });
  await updater.start();
  logLine(`[update] watching ${UPDATE_SOURCE_ROOT}`);
  return { ok: true, running: true };
}

function stopUpdateWatch() {
  if (updater) updater.stop();
  updater = null;
  return { ok: true, running: false };
}

// A boot that carries --updated tells the renderer what it just came back from.
async function announceRestart() {
  if (!process.argv.includes("--updated")) return;
  const settings = await readSettings();
  const last = settings.update?.lastRestart;
  if (!last || Date.now() - last.at > 120000) return;
  send("update:event", updateEvent({ phase: "restarted", kind: last.kind ?? "restart", files: last.files ?? [], auto: settings.update?.auto !== false, at: last.at }));
}

async function queueRequests(additions) {
  if (!additions?.length) return 0;
  // Through the board gateway: the dedupe reads the inbox INSIDE the lock, so
  // two filing passes can no longer both see "absent" and queue the same
  // request twice. The title key catches a refiling under a lightly different
  // wording; the exact source+prompt pair remains for identical snapshots.
  additions = additions.map((row) => projects.stamp(row));
  const patch = await mutateBoard((board) => {
    const fresh = additions.filter(
      (request) =>
        !board.requests.some(
          (item) =>
            (item.source === request.source && item.prompt === request.prompt) ||
            (request.title && workTitleKey(item.title) && workTitleKey(item.title) === workTitleKey(request.title))
        )
    );
    if (!fresh.length) return { added: 0 };
    board.requests = [...fresh, ...board.requests].slice(0, 200);
    return { requests: board.requests, added: fresh.length, accepted: fresh };
  });
  // Jev shadow intake: classify what landed against the closest existing
  // work and RECORD the proposal. Fire-and-forget — admission never waits
  // on a classifier, and a failure here changes nothing on the board.
  jevShadowIntake(patch.accepted);
  return patch.added ?? 0;
}

// Jev classifies admitted observations without delaying or changing board work.
// The bounded queue retains arrivals during cooldown/in-flight calls, retries
// transient failures, and excludes the observation itself from retrieval.
let jevQueuePromise = null;
const jevProjectQueues = new Map();
let jevProbeInFlight = null;
const jevPendingCharges = [];
let jevChargeFlush = null;
function getJevQueue() {
  const project = projects.current();
  jevQueuePromise = jevProjectQueues.get(project.id) ?? null;
  if (!jevQueuePromise) {
    jevQueuePromise = loadModule("scripts/jev-loop.mjs")
      .then(({ createJevQueue }) => createJevQueue({ runBatch: (additions) => projects.run(project, () => runJevIntake(additions)) }))
      .catch((error) => { jevProjectQueues.delete(project.id); jevQueuePromise = null; throw error; });
    jevProjectQueues.set(project.id, jevQueuePromise);
  }
  return jevQueuePromise;
}

function jevShadowIntake(additions) {
  if (SMOKE || CAPTURE || CLI_MODE) return;
  if (!additions?.length) return;
  getJevQueue().then((queue) => queue.enqueue(additions)).catch((error) => logLine(`[jev] queue unavailable: ${error.message}`));
}

function flushJevCharges() {
  if (jevChargeFlush) return jevChargeFlush;
  if (!jevPendingCharges.length) return Promise.resolve();
  jevChargeFlush = (async () => {
    const experience = await getExperienceModule();
    while (jevPendingCharges.length) {
      await experience.spendBudget(POLICY_BUDGET_PATH, jevPendingCharges[0]);
      jevPendingCharges.shift();
    }
  })().finally(() => { jevChargeFlush = null; });
  return jevChargeFlush;
}

async function chargeJevCall(result, purpose) {
  if (!result.usage?.modelCalls) return;
  jevPendingCharges.push({
    purpose,
    modelCalls: result.usage.modelCalls,
    tokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
    note: `${result.ok ? "completed" : "failed"} · ${result.model ?? "Jev"}`,
  });
  // Retain a paid result when accounting fails. Future calls flush this debt
  // first, so retrying a ledger write never repeats a paid classification.
  await flushJevCharges().catch((error) => logLine(`[jev] accounting pending: ${error.message}`));
}

async function runJevIntake(additions) {
  const settings = await readSettings();
  if (settings.jevShadow === false) return { ok: true, defer: true, reason: "disabled" };
  const [client, loop, classification, eyes] = await Promise.all([
    loadModule("scripts/decision-client.mjs"), loadModule("scripts/jev-loop.mjs"),
    loadModule("scripts/work-classification.mjs"), getEyes(),
  ]);
  const resolved = client.resolveApiKey({ settings, decrypt: decryptKey });
  if (!resolved) return { ok: true, defer: true, reason: "no-key" };
  try { await flushJevCharges(); }
  catch { return { ok: true, defer: true, reason: "accounting-pending" }; }
  const [requests, tasks] = await Promise.all([eyes.readJson(REQUESTS_PATH, []), eyes.readJson(TASKS_PATH, [])]);
  const { comparisons, questions, state } = loop.planIntake(additions, { requests, tasks });
  if (!comparisons.length) return { ok: true, attempted: false, proposals: 0 };
  const result = await client.classify({ questions, state, apiKey: resolved.key });
  await chargeJevCall(result, "jev-shadow-intake");
  if (!result.ok) {
    logLine(`[jev] classification unavailable: ${assistantClip(result.error, 160)}`);
    return { ok: false, attempted: Boolean(result.usage?.modelCalls), error: result.error };
  }
  const at = Date.now();
  for (let index = 0; index < comparisons.length; index += 1) {
    const { addition, hit } = comparisons[index];
    const answer = result.answers[`rel_${index}`].choice;
    const proposal = classification.interpretRelationship({ choice: answer });
    policyRecord("jev-proposal", {
      proposalId: `jev_${at}_${index}`,
      observation: { title: assistantClip(addition.title, 160), source: assistantClip(addition.source ?? "", 40) },
      candidate: { kind: hit.item.kind, title: assistantClip(hit.item.title, 160) },
      question: "observation_relationship", answer, proposedAction: proposal.action,
      retrieval: { overlapTokens: hit.overlap }, model: result.model, elapsedMs: result.elapsedMs,
    });
  }
  logLine(`[jev] ${comparisons.length} intake proposal(s) recorded in ${result.elapsedMs}ms`);
  return { ok: true, attempted: true, proposals: comparisons.length };
}

async function jevStatus() {
  const [settings, client, queue] = await Promise.all([readSettings(), loadModule("scripts/decision-client.mjs"), getJevQueue()]);
  const resolved = client.resolveApiKey({ settings, decrypt: decryptKey });
  return { configured: Boolean(resolved), enabled: settings.jevShadow !== false,
    model: client.gatewayConfig().model, accountingPending: jevPendingCharges.length, ...queue.status() };
}

function probeJev() {
  if (jevProbeInFlight) return jevProbeInFlight;
  jevProbeInFlight = (async () => {
    const [settings, client] = await Promise.all([readSettings(), loadModule("scripts/decision-client.mjs")]);
    const resolved = client.resolveApiKey({ settings, decrypt: decryptKey });
    if (!resolved) return { ok: false, error: "Save a Jev gateway key first." };
    try { await flushJevCharges(); }
    catch { return { ok: false, error: "Jev is waiting for its usage ledger to become writable. No additional call was made." }; }
    const result = await client.classify({
      questions: [{ id: "connection", type: "choice", prompt: "Choose ready if the state says ready, otherwise unavailable.", options: ["ready", "unavailable"] }],
      state: "ready", apiKey: resolved.key,
    });
    await chargeJevCall(result, "jev-connection-check");
    if (!result.ok) return { ok: false, error: result.error };
    if (result.answers.connection.choice !== "ready") return { ok: false, error: "Jev answered, but the connection check returned an unexpected result." };
    return { ok: true, model: result.model, elapsedMs: result.elapsedMs };
  })().finally(() => { jevProbeInFlight = null; });
  return jevProbeInFlight;
}

const PINS_PATH = path.join(STUDIO_ROOT, "data", "eyes-pins.json");
const REQUESTS_PATH = path.join(STUDIO_ROOT, "data", "eyes-requests.json");
const CHECKPOINTS_PATH = path.join(STUDIO_ROOT, "data", "eyes-checkpoints.json");
const BRIEFING_PATH = path.join(STUDIO_ROOT, "data", "eyes-briefing.json");
const TASKS_PATH = path.join(STUDIO_ROOT, "data", "eyes-tasks.json");
const IDEAS_PATH = path.join(STUDIO_ROOT, "data", "eyes-feature-ideas.json");
const ASSISTANT_HISTORY_PATH = path.join(STUDIO_ROOT, "data", "assistant-history.json");
const EXECUTOR_LOG_PATH = path.join(STUDIO_ROOT, "data", "executor-log.jsonl");

// The Policy Lab's stores (build brief): append-only experiment truth beside
// the board. Nothing else writes here — the compactor, tidy and housekeeping
// retention lists never touch it, so clearing a card can never erase the
// history policies are evaluated on.
const POLICY_LAB_DIR = path.join(STUDIO_ROOT, "data", "policy-lab");
const EXPERIENCE_PATH = path.join(POLICY_LAB_DIR, "experience.jsonl");
const RECEIPTS_PATH = path.join(POLICY_LAB_DIR, "receipts.jsonl");
const ACTIVE_POLICY_PATH = path.join(POLICY_LAB_DIR, "active-policy.json");
const POLICY_BUDGET_PATH = path.join(POLICY_LAB_DIR, "budget.json");

// The board's SQLite authority lives OUTSIDE data/ (OneDrive sync has hung
// writers here before): ~/.local/share/mefi-studio/board.db, overridable with
// MEFI_STUDIO_BOARD_DB. Once enabled (see getEyes), reads of the three board
// stores are served by the database and every committed change rewrites the
// JSON view; on first run the existing JSON files are imported wholesale. If
// the database cannot open, eyes.mjs falls back to plain file mode per call.
const ASSISTANT_MODEL = "deepseek-v4.1-flash";
const ASSISTANT_ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
// The user's own z.ai GLM Coding Plan: same OpenAI chat-completions shape,
// billed to their plan instead of OpenCode's balance. glm-5.3-flash is the
// multimodal default (routine work + the only vision-capable route); glm-5.3
// is text-only with always-on reasoning, reserved for the heavy passes.
const ZAI_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const ZAI_MODEL_ROUTINE = "glm-5.3-flash";
const ZAI_MODEL_HEAVY = "glm-5.3";
const AI_PROVIDERS = ["auto", "zai", "opencode", "grok"];

const ASSISTANT_SYSTEM = [
  "You are A-Eyes, the coordination assistant for several AI coding agents sharing one machine and one repo.",
  "You receive authoritative JSON facts about live sessions: titles, agents, todos with status, recently changed files, file collisions (same file edited by multiple sessions, each with an owner whose work the others should adopt), and presence (who is editing each file right now).",
  "Reply with STRICT minified JSON only. No markdown, no prose, no extra keys.",
  'Schema: {"summary":"<=50 words","alerts":[{"severity":"info|warn|critical","title":"<=8 words","detail":"<=40 words","sessionIds":["ses_..."]}],"checkpoints":[{"sessionId":"ses_...","note":"<=30 words"}],"expand":[]}',
  "Alerts must cover: file collisions, two sessions overlapping on the same subsystem, stale in-progress work, and unusually large deletions. Checkpoints are short progress notes for active sessions (one per session, the most useful observation).",
  "Never invent sessions, files, ids, or numbers that are not in the facts.",
].join(" ");

const ASSISTANT_GROW_SYSTEM = [
  "You are A-Eyes, the coordination assistant for AI coding agents working on one repo.",
  "You receive JSON facts about recent sessions plus an archive list of older session titles.",
  "Reply with STRICT minified JSON only, no markdown: {\"summary\":\"<=40 words\",\"alerts\":[],\"checkpoints\":[],\"expand\":[{\"title\":\"<=8 words\",\"prompt\":\"<=60 words\"}]}",
  "The expand list must contain 3-6 concrete, buildable follow-up requests that grow the archive work: unfinished threads, systems implied but never finished, or polish noted in titles. Ground every item in the given titles; do not invent features with no basis.",
].join(" ");

const ASSISTANT_IMPROVE_SYSTEM = [
  "You are Mefi, the resident assistant improving the selected project whose file inventory and check commands are provided. Infer its technology from these facts; do not assume it is Studio itself.",
  "You receive the app file inventory (paths and line counts), package scripts, recent agent sessions, and file collisions.",
  'Reply with STRICT minified JSON only: {"summary":"<=40 words","alerts":[],"checkpoints":[],"expand":[{"title":"<=8 words","prompt":"<=60 words"}]}',
  "expand must contain 2-5 concrete improvements to THIS app, each naming the exact file(s) to touch and the acceptance check. Prefer dead-code removal, harder tests, keyboard/accessibility gaps, poll performance, and renderer polish. Never propose speculative rewrites or new dependencies.",
].join(" ");

function startEyesWatch() {
  if (eyesTimer) return { ok: true, running: true };
  let idleTicks = 0;
  const tick = async () => {
    // Hidden or minimized windows need no live feed; skip the DB query.
    if (window && (window.isMinimized() || !window.isVisible())) {
      eyesTimer = setTimeout(() => projects.run(projects.active(), tick), 5000);
      return;
    }
    try {
      const eyes = await getEyes();
      const activity = eyes.activitySince({ since: eyesLastTs });
      if (activity.length) {
        eyesLastTs = activity[activity.length - 1].time;
        idleTicks = 0;
        const todos = eyes.listTodos();
        send("eyes:activity", { activity, todos });
      } else {
        idleTicks += 1;
      }
    } catch (error) {
      send("eyes:error", String(error.message ?? error));
    }
    // Back off to 5s when the machine has been quiet for two minutes.
    eyesTimer = setTimeout(() => projects.run(projects.active(), tick), idleTicks > 60 ? 5000 : 2000);
  };
  eyesTimer = setTimeout(() => projects.run(projects.active(), tick), 500);
  eyesTimer.unref?.();
  return { ok: true, running: true };
}

function stopEyesWatch() {
  if (eyesTimer) clearTimeout(eyesTimer);
  eyesTimer = null;
  return { ok: true, running: false };
}

async function improveFacts(eyes) {
  const files = [];
  async function walk(dir, depth) {
    if (depth > 2 || files.length > 140) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (/\.(mjs|cjs|js|css|html|json|md)$/.test(entry.name)) {
        try {
          const text = await readFile(full, "utf8");
          if (text.length < 250000) files.push({ path: path.relative(projectRoot(), full).replace(/\\/g, "/"), lines: text.split("\n").length });
        } catch {}
      }
    }
  }
  await walk(projectRoot(), 0);
  const facts = eyes.assistantFacts({ sessionLimit: 6, changeLimit: 30, root: projectRoot() });
  let packageScripts = {};
  try {
    packageScripts = JSON.parse(await readFile(path.join(projectRoot(), "package.json"), "utf8")).scripts ?? {};
  } catch {}
  return {
    generatedAt: new Date().toISOString(),
    appInventory: files,
    packageScripts,
    recentSessions: facts.sessions.map((session) => ({ title: session.title, agent: session.agent, todos: session.todos.slice(0, 6) })),
    collisions: facts.collisions.slice(0, 6),
  };
}

const ASSISTANT_EXPLORE_SYSTEM = [
  "You are A-Eyes reviewing one checkpoint for a human. You receive a checkpoint (note + timestamp), its session, and the session's recent changes.",
  'Reply with STRICT minified JSON only: {"summary":"<=60 words","review":{"progress":"<=40 words","remaining":"<=40 words","verdict":"done|in-progress|stalled"},"alerts":[],"checkpoints":[],"expand":[]}',
  "Ground every statement in the given changes; if evidence is thin, say so in the review instead of inventing progress.",
].join(" ");

const ASSISTANT_AUDIT_SYSTEM = [
  "You are A-Eyes' auditor: a third agent whose job is finding gaps, unlinked or unsecured ends, and unwired features in the app whose local audit is provided.",
  'Reply with STRICT minified JSON only: {"summary":"<=50 words","alerts":[{"severity":"info|warn|critical","title":"<=8 words","detail":"<=40 words","sessionIds":[]}],"checkpoints":[],"expand":[{"title":"<=8 words","prompt":"<=60 words"}]}',
  "Use the local audit findings and the file inventory. expand items must each name the exact file(s) and the verification command. Do not repeat findings that are already errors; those are handled.",
].join(" ");

const ASSISTANT_ANALYZER_SYSTEM = [
  "You are A-Eyes' analyzer. You receive either a file analysis (composition, outline, markers, references) or an idea verification (keyword coverage plus real evidence hits from the repo).",
  'Reply with STRICT minified JSON only: {"summary":"<=50 words (what it is, or the idea verdict)","features":["<=12 words each, up to 5"],"ideas":["<=14 words, up to 4"],"content":["outline highlights, up to 6"],"gaps":["<=14 words, up to 5, grounded in the evidence"]}',
  "Never invent files or features that are not in the payload. Gaps for ideas must reference the provided evidence or its absence.",
].join(" ");

const ASSISTANT_IDEAS_SYSTEM = [
  "You classify candidate observation lines from AI coding chats for a game and its studio app, and you review the live task board.",
  'Reply with STRICT minified JSON only: {"ideas":[{"title":"<=8 words","detail":"<=30 words","tags":["<=3 tags"]}],"taskGroups":[{"title":"<=4 word theme","tasks":["exact openTasks title"]}]}',
  "Only use the provided candidate lines. Merge near-duplicates and group thematically.",
  "The existingTitles list is what is already recorded — do not re-propose any of it, not even reworded.",
  "Return only genuine, actionable proposals; returning an empty ideas list is correct when every candidate is already represented, is progress narration, or describes something already done.",
  "openTasks is the live board: a taskGroup folds 2-8 of them that are one body of work — paraphrases, duplicates, or steps of a single job — into one plan, so name each task by its exact openTasks title. Never group unrelated work or a singleton; omit taskGroups entirely when the board is already tidy.",
].join(" ");

const ASSISTANT_OVERSEER_SYSTEM = [
  "You are the Overseer — the R&D layer above A-Eyes, the always-on assistant in Mefi's Studio AI+ (Electron main.cjs, dependency-free renderer, pure logic in scripts/assistant.mjs, Python contract tests in tools/).",
  "You never do the assistant's jobs; you study its digest and your own playbook, then improve how the assistant works: its cadences, prefs, prompts and tooling.",
  'Reply with STRICT minified JSON only: {"summary":"<=40 words","health":"good|fair|poor","score":0-100,"findings":[{"severity":"info|warn|critical","title":"<=8 words","detail":"<=30 words"}],"lessons":["<=18 words"],"upgrades":[{"title":"<=8 words","prompt":"<=60 words"}],"prefs":{"foldAfterMinutes":0,"staleAfterHours":0,"tidyDoneAfterHours":0,"parallel":0,"aiParallel":0}}',
  "facts.intel is what working agents last reported home — a failed builder is work to unstick, not a footnote. Respond to those reports: retry, narrow, or hand the next piece on.",
  "upgrades are concrete changes to the assistant itself — each names the file to touch (main.cjs, scripts/assistant.mjs, renderer/*.js, tools/*) and the check that proves it. Never repeat an open directive; playbook.directives lists what is already out.",
  "lessons are durable rules about what keeps this assistant healthy: carry forward playbook lessons that still hold, sharpen vague ones, drop dead ones — the playbook is how you improve yourself between passes.",
  "prefs carries only the keys that should change; omit it when nothing should move. Ground every claim in the digest; never invent sessions, files, ids or metrics.",
].join(" ");

const ASSISTANT_CHAT_SYSTEM = [
  "You are the assistant in Mefi's Studio AI+: an always-on helper that watches several AI coding agents sharing one machine and one repo, tidies their work, and keeps the node tree organized.",
  "You run a roster of agents — watcher, machine, auditor, keeper, briefer, improver, grower, ideas, reference — and every work instruction sends all of them out in parallel alongside the request it queues for the executor.",
  "You receive JSON: message (the user's latest text — always present, even when short), did (what you just did), thread, then facts (live sessions with todos, file collisions, tasks, the request inbox, ideas, machine, audit, briefing, update, the executor and its in-flight jobs, log — the assistant's own recent activity — suggestions — ranked next-work picks — and memory, a pushed primer of typed cells: dec/obs/bel/rsk/ver).",
  "facts.memory is compiled against this message before you see it — do not search for it. If memory.dig is true, a remembered fact was superseded; address that row before acting.",
  "facts.log is the assistant's own activity tail (ticks omitted). Read it when asked about the log, what just happened, or what you have been doing; do not invent lines that are not there.",
  "Reply in plain text only: at most 120 words, no JSON, no markdown, no headings. Ground every statement in the facts; when the facts do not cover the question, say so. You may mention what you just did.",
  "The thread is yours: it, that, them, yes and the second one all refer back to what you just said — answer follow-ups directly instead of asking what was meant. Small talk earns a one-line human answer, not a status dump.",
  "When did is not empty, lead with it and name the thing that started — 'starting work on <title>' for a queued request, the pass name for a run agent, the roster for a dispatch — never a state dump. When did is empty and the message is a question, answer the question only.",
  "A greeting or open-ended message earns one short status line and an offer of the top pick from facts.suggestions ('could work on <title>') — do not list the whole board. Questions about work end with the best matching suggestion when one exists.",
  "Never narrate your own plumbing — reply jobs, attempts, the pool, queued responders — the user sees sessions, tasks, the inbox and the executor, not the machinery.",
  "Never invent sessions, files, numbers or ids that are not in the facts.",
].join(" ");

// OpenCode Go requires a stable x-opencode-session so requests route and cache
// well; one id per installation, kept beside the (encrypted) key.
async function assistantSessionId() {
  const settings = await readSettings();
  if (!settings.assistantSession) {
    settings.assistantSession = `ses_mefi_${crypto.randomBytes(12).toString("hex")}`;
    await writeSettings(settings);
  }
  return settings.assistantSession;
}

function decryptKey(settings, field) {
  if (!settings?.[field] || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(settings[field], "base64"));
  } catch {
    return null;
  }
}

// The assistant's model is the owner's choice, not a constant: the Studio tab
// carries per-role overrides (routine pass / heavy pass). Empty = the route's
// own default. Whatever id is saved is sent verbatim — the model list drifts
// weekly, so the field is a text input, not a closed list.
function assistantModelOverride(settings, role) {
  const models = settings.aiModels && typeof settings.aiModels === "object" ? settings.aiModels : {};
  const wanted = String(role === "heavy" ? models.heavy : models.routine ?? "").trim();
  return wanted.slice(0, 120);
}

// Pick who pays for this call. "auto" prefers the user's z.ai plan and only
// touches OpenCode when that is the explicit pick or the only key on file; a
// z.ai failure retries on OpenCode solely when aiFallbackOpenCode was turned
// on in the Studio tab — never by default, so there are no surprise charges.
// "grok" rides the Grok CLI instead of an HTTP endpoint: the CLI carries its
// own auth, so no key is needed, and the saved model override (if any) is
// passed with -m. `allowGrok: false` resolves the same preference order with
// grok excluded — the fallback pass a failed grok call lands on.
async function resolveAiRoute(role = "routine", { allowGrok = true } = {}) {
  const settings = await readSettings();
  let provider = AI_PROVIDERS.includes(settings.aiProvider) ? settings.aiProvider : "auto";
  if (provider === "grok" && !allowGrok) provider = "auto";
  const zaiKey = decryptKey(settings, "zaiApiKeyEncrypted");
  const goKey = decryptKey(settings, "apiKeyEncrypted");
  if (provider === "grok") return { ok: true, provider: "grok", model: assistantModelOverride(settings, role), endpoint: null, apiKey: null, fallback: null };
  if (provider === "opencode" || (provider === "auto" && !zaiKey)) {
    if (!goKey) return { ok: false, error: "no API key saved - add a z.ai or OpenCode Go key in the Studio tab" };
    return { ok: true, provider: "opencode", endpoint: ASSISTANT_ENDPOINT, model: assistantModelOverride(settings, role) || ASSISTANT_MODEL, apiKey: goKey, fallback: null };
  }
  if (!zaiKey) return { ok: false, error: "no z.ai key saved - add one in the Studio tab" };
  return {
    ok: true,
    provider: "zai",
    endpoint: ZAI_ENDPOINT,
    model: assistantModelOverride(settings, role) || (role === "heavy" ? ZAI_MODEL_HEAVY : ZAI_MODEL_ROUTINE),
    apiKey: zaiKey,
    fallback:
      provider === "auto" && settings.aiFallbackOpenCode === true && goKey
        ? { endpoint: ASSISTANT_ENDPOINT, model: ASSISTANT_MODEL, apiKey: goKey }
        : null,
  };
}

async function chatCompletion(endpoint, apiKey, model, body, { sessionHeader = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": "mefi-studio/0.1 (A-Eyes)",
    };
    if (sessionHeader) headers["x-opencode-session"] = sessionHeader;
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, error: `assistant HTTP ${response.status}: ${(await response.text()).slice(0, 200)}` };
    const payload = await response.json();
    const choice = payload.choices?.[0] ?? {};
    const text = choice.message?.content ?? "";
    const reasoning = choice.message?.reasoning_content ?? "";
    // A reasoning model can spend the whole budget thinking; if content is
    // empty but reasoning contains the JSON, use it rather than failing.
    if (!text.trim() && reasoning.includes("{")) return { ok: true, text: reasoning, reasoning, finish: choice.finish_reason, model: body.model };
    if (!text.trim()) return { ok: false, error: `empty reply (finish=${choice.finish_reason ?? "?"}, reasoning=${reasoning.length} chars)` };
    return { ok: true, text, reasoning, finish: choice.finish_reason, model: body.model };
  } catch (error) {
    return { ok: false, error: `assistant call failed: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// The Grok CLI as an assistant route: one headless single-turn call, system +
// payload in via --prompt-file (the text can carry quotes and JSON, which no
// command line should have to quote), plain text out on stdout. Auth rides
// the CLI's own login, so no key is stored or read.
async function grokCompletion(system, user, model, { timeoutMs = 180000 } = {}) {
  const tmp = path.join(app.getPath("temp"), `mefi-grok-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.txt`);
  try {
    await writeFile(tmp, `${system}\n\n${user}`, "utf8");
    const args = ["--prompt-file", tmp, "--output-format", "plain", "--permission-mode", "dontAsk"];
    if (model) args.push("-m", model);
    return await new Promise((resolve) => {
      const child = spawn("grok", args, { cwd: projectRoot(), windowsHide: true });
      let text = "";
      let err = "";
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        resolve({ ok: false, error: "grok cli timed out" });
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => (text += chunk));
      child.stderr?.on("data", (chunk) => (err += chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: `grok spawn failed: ${error.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (text.trim()) resolve({ ok: true, text: text.trim(), model: model || "grok" });
        else resolve({ ok: false, error: `grok empty reply (exit ${code ?? "?"})${err.trim() ? `: ${err.trim().slice(-160)}` : ""}` });
      });
    });
  } catch (error) {
    return { ok: false, error: `grok call failed: ${error.message}` };
  } finally {
    try {
      await rm(tmp, { force: true });
    } catch {}
  }
}

// The Studio-managed OpenCode provider: GLM 5.3 / 5.3 Flash on the owner's
// z.ai Coding Plan. The config rides each process through
// OPENCODE_CONFIG_CONTENT and the key arrives as MEFI_ZAI_API_KEY — nothing is
// written to OpenCode's own auth store and no OpenCode route can see it.
function zaiProviderConfig() {
  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      "mefi-zai": {
        npm: "@ai-sdk/openai-compatible",
        name: "z.ai GLM (Mefi)",
        options: {
          baseURL: "https://api.z.ai/api/coding/paas/v4",
          apiKey: "{env:MEFI_ZAI_API_KEY}",
        },
        models: {
          "glm-5.3-flash": { name: "GLM 5.3 Flash (routine + vision)" },
          "glm-5.3": { name: "GLM 5.3 (hard text work)" },
        },
      },
    },
  };
}

async function zaiOpencodeEnv() {
  const key = decryptKey(await readSettings(), "zaiApiKeyEncrypted");
  if (!key) return null;
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify(zaiProviderConfig()), MEFI_ZAI_API_KEY: key };
}

// Which route an autopilot `opencode run` takes. auto + a saved z.ai key rides
// mefi-zai (the coding plan, never the OpenCode balance); "opencode" stays on
// OpenCode's own account; "zai" with no key fails loudly instead of billing
// OpenCode by surprise. executorCli moves the whole run to another coding CLI
// — "grok" hands the job to the Grok CLI (its own login, sentinel protocol
// unchanged), so the builders' seats are a Studio choice, not a constant.
// Grok is never a single point of failure: a missing CLI resolves straight to
// the opencode route, and the grok route carries the opencode route with it so
// a run that dies can fall back per job (see spawnNextJob).
let grokCliProbe = { checkedAt: 0, ok: false };
function grokCliAvailable() {
  if (Date.now() - grokCliProbe.checkedAt < 5 * 60000) return Promise.resolve(grokCliProbe.ok);
  return new Promise((resolve) => {
    const child = spawn("where.exe", ["grok"], { windowsHide: true });
    const done = (ok) => {
      grokCliProbe = { checkedAt: Date.now(), ok };
      resolve(ok);
    };
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

async function executorRunEnv() {
  const settings = await readSettings();
  // The opencode half: the default runner, with the mefi-zai provider when a
  // z.ai key is saved. Computed once and reused as the grok fallback route.
  const opencodeRoute = async () => {
    const provider = AI_PROVIDERS.includes(settings.aiProvider) ? settings.aiProvider : "auto";
    if (provider === "opencode") return { cli: "opencode", env: {}, modelArgs: "", via: "opencode default" };
    const zaiEnv = await zaiOpencodeEnv();
    // Queue-draining builders always ride glm-5.3-flash on the coding plan.
    // glm-5.3 (heavy) is the overseer/improve route, not a 24/7 worker.
    if (zaiEnv) return { cli: "opencode", env: zaiEnv, modelArgs: ` --model mefi-zai/${ZAI_MODEL_ROUTINE}`, via: `mefi-zai/${ZAI_MODEL_ROUTINE}` };
    if (provider === "zai") return { error: "AI routing is z.ai-only but no z.ai key is saved" };
    return { cli: "opencode", env: {}, modelArgs: "", via: "opencode default" };
  };
  if (settings.executorCli === "grok") {
    const buildModel = String(settings.executorModel ?? "").trim().slice(0, 120);
    const opencode = await opencodeRoute();
    if (!(await grokCliAvailable())) {
      // The chosen runner is not on the machine: do not park the builders —
      // take the opencode route and say so on the feed.
      logLine("[autopilot] grok CLI not found — builders fall back to opencode run");
      pushAutopilotHistory("fallback", "grok CLI not found — builders on opencode");
      if (!opencode.error) opencode.via += " · grok missing";
      return opencode;
    }
    return { cli: "grok", env: {}, modelArgs: "", via: "grok cli", grok: true, model: buildModel, opencode };
  }
  return opencodeRoute();
}

async function assistantFetch(system, user, maxTokens = 6000, { role = "routine" } = {}) {
  const route = await resolveAiRoute(role);
  if (!route.ok) return route;
  // Grok rides its CLI, not an HTTP endpoint — maxTokens has no knob there,
  // and the model id (when the Studio saved one) rides -m inside the helper.
  // The CLI is the route, not the whole story: a missing binary, a timeout or
  // an empty reply falls back once to the keyed HTTP routes — z.ai by
  // preference, OpenCode Go by the same auto rules, never back to grok.
  if (route.provider === "grok") {
    const grok = await grokCompletion(system, user, route.model);
    if (grok.ok) {
      if (assistantState?.ai && projects.current().id === projects.active().id) assistantState.ai.model = grok.model;
      return grok;
    }
    const http = await resolveAiRoute(role, { allowGrok: false });
    if (!http.ok) return grok;
    const retried = await httpAssistantCall(http, system, user, maxTokens);
    if (retried.ok) logLine(`[assistant] grok cli failed (${String(grok.error ?? "").slice(0, 90)}) — answered via ${retried.model}`);
    return retried.ok ? retried : grok;
  }
  return httpAssistantCall(route, system, user, maxTokens);
}

// The HTTP half of assistantFetch: body shaping (the reasoning knobs), the
// primary call, and the opt-in OpenCode fallback. Split out so the grok-CLI
// route can land here when the CLI cannot answer.
async function httpAssistantCall(route, system, user, maxTokens) {
  const body = {
    model: route.model,
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // glm-5.3 reasons on every request and caps effort at low|high|max — "low"
  // keeps the heavy passes honest without burning the plan. The flash route
  // and OpenCode keep the previous single-knob shape.
  if (route.model === ZAI_MODEL_HEAVY) {
    body.reasoning_effort = "low";
    body.thinking = { type: "enabled" };
  } else if (route.provider === "opencode") {
    body.reasoning_effort = "low";
  }
  const sessionHeader = route.provider === "opencode" ? await assistantSessionId() : null;
  const primary = await chatCompletion(route.endpoint, route.apiKey, route.model, body, { sessionHeader });
  if (primary.ok) {
    // The status panel shows the route that actually answered, not a static label.
    if (assistantState?.ai && projects.current().id === projects.active().id) assistantState.ai.model = primary.model;
    return primary;
  }
  if (!route.fallback) return primary;
  const fallbackBody = { ...body, model: route.fallback.model, reasoning_effort: "low" };
  delete fallbackBody.thinking;
  const retried = await chatCompletion(route.fallback.endpoint, route.fallback.apiKey, route.fallback.model, fallbackBody, { sessionHeader: await assistantSessionId() });
  if (retried.ok && assistantState?.ai && projects.current().id === projects.active().id) assistantState.ai.model = retried.model;
  return retried;
}

function normalizeBriefing(result) {
  // Some reasoning models wrap the JSON in the summary field; unwrap once.
  if (result && typeof result.summary === "string" && result.summary.trim().startsWith("{")) {
    try {
      const inner = JSON.parse(result.summary);
      if (inner && typeof inner === "object") {
        return {
          ...result,
          ...inner,
          summary: inner.summary ?? result.summary.slice(0, 200),
          alerts: inner.alerts ?? result.alerts ?? [],
          checkpoints: inner.checkpoints ?? result.checkpoints ?? [],
          expand: inner.expand ?? result.expand ?? [],
        };
      }
    } catch {}
  }
  return result;
}

async function runAssistant(mode = "brief", sessionId = null, payload = null) {
  const settings = await readSettings();
  if ((!settings.apiKeyEncrypted && !settings.zaiApiKeyEncrypted) || !safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "no API key saved - add a z.ai or OpenCode Go key in the Studio tab" };
  }
  const eyes = await getEyes();
  let facts;
  if (mode === "improve") {
    facts = await improveFacts(eyes);
  } else if (mode === "audit") {
    const auditor = await getAuditor();
    const local = await auditor.audit();
    const inventory = (await improveFacts(eyes)).appInventory;
    facts = {
      generatedAt: new Date().toISOString(),
      localAudit: { errors: local.errors, warnings: local.warnings, findings: local.findings.slice(0, 24) },
      inventory: inventory.slice(0, 90),
    };
  } else if (mode === "explore" || mode === "expand") {
    const base = eyes.assistantFacts({ root: projectRoot() });
    const session = base.sessions.find((item) => item.id === sessionId) ?? null;
    facts = {
      generatedAt: base.generatedAt,
      checkpoint: payload?.note ? { note: payload.note, at: payload.at, files: payload.files ?? [] } : null,
      session,
      recentChanges: eyes
        .listChanges({ sessionId, limit: 14 })
        .map((change) => ({ tool: change.tool, file: change.file, additions: change.additions, deletions: change.deletions })),
    };
  } else if (mode === "grow") {
    const base = eyes.assistantFacts({ root: projectRoot() });
    facts = {
      generatedAt: base.generatedAt,
      recentTitles: base.sessions.slice(0, 6).map((session) => session.title),
      archive: eyes
        .listSessions({ limit: 40 })
        .filter((session) => Date.now() - session.timeUpdated > 30 * 60 * 1000)
        .slice(0, 24)
        .map((session) => ({ id: session.id, title: session.title, agent: session.agent })),
    };
  } else {
    facts = eyes.assistantFacts({ sessionLimit: 8, changeLimit: 40, todoLimitPerSession: 8, root: projectRoot() });
    if (mode === "checkpoint" && sessionId) {
      facts = { ...facts, sessions: facts.sessions.filter((session) => session.id === sessionId) };
    }
  }
  const system =
    mode === "grow" || mode === "expand"
      ? ASSISTANT_GROW_SYSTEM
      : mode === "improve"
        ? ASSISTANT_IMPROVE_SYSTEM
        : mode === "explore"
          ? ASSISTANT_EXPLORE_SYSTEM
          : mode === "audit"
            ? ASSISTANT_AUDIT_SYSTEM
            : ASSISTANT_SYSTEM;
  try {
    const machineStatus = await resourcePass({ kill: false, reason: "facts", withProcesses: false });
    const leases = machineStatus.leases ?? {};
    facts = {
      ...facts,
      machine: {
        wait: machineStatus.wait,
        exclusive: machineStatus.leases.exclusive,
        holders: machineStatus.leases.holders.map((holder) => `${holder.label || holder.agent} (w${holder.width}${holder.exclusive ? ", exclusive" : ""})`),
        runningTests: machineStatus.running.map((entry) => ({ pid: entry.pid, status: entry.status, ageMinutes: entry.ageMinutes })),
        summary: machineStatus.lines,
      },
    };
    void leases;
  } catch {}
  // The brief knows what the assistant has in flight and what it restarted.
  if (mode === "brief" && assistantState) facts = { ...facts, work: assistantState.work ?? [], resumed: assistantState.resumed ?? null };
  const user = JSON.stringify(facts).slice(0, 14000);
  // The improver rewrites the assistant's own playbook — the one pass that
  // earns the always-reasoning glm-5.3 route; everything else rides flash.
  const call = await assistantFetch(system, user, 6000, { role: mode === "improve" ? "heavy" : "routine" });
  if (!call.ok) return { ok: false, error: call.error };
  const text = call.text;  let result = null;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    result = normalizeBriefing(JSON.parse(text.slice(start, end + 1)));
  } catch {
    result = { summary: text.slice(0, 300), alerts: [], checkpoints: [], expand: [] };
  }
  const briefing = { mode, generatedAt: new Date().toISOString(), model: call.model ?? ASSISTANT_MODEL, ...result };
  if (mode !== "grow" && mode !== "improve" && mode !== "expand") {
    await eyes.writeJson(BRIEFING_PATH, briefing);
    if (Array.isArray(result.checkpoints) && result.checkpoints.length) {
      const store = await eyes.readJson(CHECKPOINTS_PATH, {});
      const latestPngs = await eyes.listPngs({ roots: [path.join(projectRoot(), "tools", "logs")], limit: 1 });
      const latestPng = latestPngs[0]?.path ?? null;
      const filesFor = (checkpointSessionId) =>
        facts.sessions?.find((session) => session.id === checkpointSessionId)?.changed?.files ?? [];
      for (const checkpoint of result.checkpoints) {
        if (!checkpoint?.sessionId || !checkpoint?.note) continue;
        const list = store[checkpoint.sessionId] ?? [];
        list.unshift({
          note: String(checkpoint.note).slice(0, 240),
          at: Date.now(),
          source: ASSISTANT_MODEL,
          files: filesFor(checkpoint.sessionId),
          png: latestPng,
        });
        store[checkpoint.sessionId] = list.slice(0, 50);
      }
      await eyes.writeJson(CHECKPOINTS_PATH, store);
    }
    send("eyes:briefing", briefing);
  }
  const checkpoints = await eyes.readJson(CHECKPOINTS_PATH, {});
  send("eyes:checkpoints", checkpoints);
  logLine(`[assistant] ${mode} done via ${ASSISTANT_MODEL}`);
  return { ok: true, briefing, checkpoints };
}

// ---- the assistant service ------------------------------------------------
// Always-on agent pool, message thread, fixes and tidying. The pure logic
// (roster, cadence, organize, tidy, intents, local replies) lives in
// scripts/assistant.mjs; this is the wiring: the state file, the scheduler
// and its setTimeout tick chain, store/machine/audit facts, and the pushes
// that keep every surface live.
const ASSISTANT_PATH = path.join(STUDIO_ROOT, "data", "eyes-assistant.json");
const ASSISTANT_CAPS = { messages: 200, log: 300, fixes: 100 };
// What a broken data/eyes-*.json is reset to; eyes-assistant.json is rewritten
// from memory instead.
const ASSISTANT_DATA_FALLBACKS = {
  "eyes-tasks.json": [],
  "eyes-feature-ideas.json": [],
  "eyes-requests.json": [],
  "eyes-pins.json": {},
  "eyes-checkpoints.json": {},
  "eyes-briefing.json": {},
  "eyes-assistant.json": null,
};
const ASSISTANT_DATA_EVENTS = {
  "eyes-tasks.json": "eyes:tasks",
  "eyes-feature-ideas.json": "eyes:ideas",
  "eyes-requests.json": "eyes:requests",
  "eyes-checkpoints.json": "eyes:checkpoints",
  "eyes-briefing.json": "eyes:briefing",
};
// When pushes coalesce, the most telling event of the window wins.
const ASSISTANT_EVENT_RANK = { organize: 6, reply: 5, message: 4, focus: 4, think: 4, intel: 3, fix: 3, tidy: 3, context: 3, error: 2, agent: 2 };
// The pool: responder > on-demand > cadence; a job gets 150 s.
const ASSISTANT_PRIORITY = { responder: 3, demand: 2, cadence: 1 };
const ASSISTANT_JOB_TIMEOUT_MS = 150000;
const ASSISTANT_CADENCE_ROLES = ["watcher", "machine", "auditor", "keeper", "compactor", "foreman", "thinker", "briefer", "overseer", "improver", "ideas", "grower"];
// Cadence roles that spend an AI call, so a keyless (or non-proactive) tick
// must not fire them. The overseer is deliberately absent: it falls back to a
// local review. The ideas scan is too — it degrades to a keyless scan.
const ASSISTANT_AI_ROLES = new Set(["briefer", "improver", "grower"]);
// The line a finished `opencode run` prints for us. See spawnNextJob: the CLI's
// exit code is not a verdict, this is.
const EXECUTOR_DONE_MARK = "MEFI_JOB_DONE";
// The handoff protocol. A run that finds more work than it should do in one
// pass hands it on instead of dropping it: NEXT queues a request another
// executor agent picks up, CALL wakes a roster agent to follow the work up.
// This is how one job becomes a chain instead of a dead end.
const EXECUTOR_NEXT_MARK = "MEFI_NEXT:";
const EXECUTOR_CALL_MARK = "MEFI_CALL:";
const EXECUTOR_MAX_HANDOFFS = 3; // per run — a job cannot flood the queue
const EXECUTOR_MAX_DEPTH = 3; // how far a chain may run before it has to stop
// Total prompt budget for one run. The tail (handoff + sentinel) is reserved
// out of this first; only the task's own text is trimmed to fit.
const EXECUTOR_PROMPT_MAX = 1600;
// The budget the run is told it has, and the hard kill that backs it up. A job
// killed at the deadline can never report the sentinel, so it is always filed
// as a failure however much it achieved — an agent that knows its budget can
// instead land the valuable part and hand the remainder on before time is up.
const MINUTE_MS = 60000;
const EXECUTOR_BUDGET_MINUTES = 15;
const EXECUTOR_KILL_MS = 25 * 60 * 1000;
// A run that has registered no OpenCode session and printed nothing within
// this window is a wedged start, not a working run: twelve same-second
// startups once collided on the shared OpenCode store and every one sat
// silent for the whole kill budget, stalling the pool cycle after cycle.
// Killed as infrastructure failure so the executor names the cause and parks.
const EXECUTOR_START_BUDGET_MS = 3 * 60 * 1000;
// Process starts are staggered so a full pool never stampedes the shared
// OpenCode store (SQLite) and its snapshot repo at the same instant.
const EXECUTOR_STAGGER_MS = 3000;
// How often a running job's progress is re-read from its session's todo list.
// The fraction only moves when the run completes a todo, so a slow poll costs
// one cheap read and pushes fire on change, not on a clock.
const EXECUTOR_PROGRESS_POLL_MS = 10000;
// Roles a finishing run is allowed to wake. The responder answers the user and
// is never summoned by a job; the rest are all follow-up work.
const EXECUTOR_CALLABLE = new Set(["auditor", "reference", "ideas", "improver", "grower", "watcher", "keeper", "machine", "briefer", "overseer"]);

// Pull the handoffs out of one line of a run's output.
function parseExecutorHandoff(line) {
  const text = String(line ?? "").replace(/\[[0-9;]*m/g, "").trim();
  const next = text.indexOf(EXECUTOR_NEXT_MARK);
  if (next >= 0) {
    const body = text.slice(next + EXECUTOR_NEXT_MARK.length).trim();
    const [title, ...rest] = body.split("::");
    const label = String(title ?? "").trim().slice(0, 90);
    if (!label) return null;
    return { kind: "next", title: label, prompt: (rest.join("::").trim() || label).slice(0, 600) };
  }
  const call = text.indexOf(EXECUTOR_CALL_MARK);
  if (call >= 0) {
    const role = text.slice(call + EXECUTOR_CALL_MARK.length).trim().split(/[\s,.]/)[0]?.toLowerCase();
    return role && EXECUTOR_CALLABLE.has(role) ? { kind: "call", role } : null;
  }
  return null;
}
// assistant:run modes map onto roster roles; everything else is a brief.
const ASSISTANT_RUN_ROLES = { improve: "improver", grow: "grower", expand: "grower", audit: "auditor" };
const ASSISTANT_RUN_KINDS = new Set(["brief", "improve", "grow", "explore", "expand", "audit", "checkpoint"]);
const ASSISTANT_WORK_STALE_MS = 10 * 60000;
// After the hard kill, a short grace: if close() never fires the claim is
// wedged and supervise reaps it. Must sit past EXECUTOR_KILL_MS or a live
// run is flagged while it is still allowed to work.
const ASSISTANT_JOB_WEDGED_MS = EXECUTOR_KILL_MS + 90 * 1000;
// Where an agent works, as the tree names its nodes. Cosmetic target updates
// are throttled; they must never hold a worker slot or delay its result.
const ASSISTANT_NODE = { kind: "assistant", id: "__assistant__" };
const ROOT_NODE = { kind: "root", id: "__root__" };
const FOLDED_NODE = { kind: "folded", id: "__folded__" };
const ASSISTANT_HOP_MS = 900;
const ASSISTANT_ROLE_VERBS = {
  watcher: "watching",
  machine: "scanning the machine",
  auditor: "auditing",
  keeper: "tidying",
  compactor: "compacting the queue",
  foreman: "handing out work",
  thinker: "thinking",
  briefer: "briefing",
  overseer: "overseeing",
  responder: "replying to",
  improver: "improving",
  grower: "growing",
  ideas: "scanning ideas",
  reference: "gathering for",
};
const ASSISTANT_STOP_WORDS = new Set(["what", "with", "that", "this", "please", "about", "from", "have", "into", "your", "there", "then", "than", "they", "them", "will", "would", "could", "should", "check", "make", "tell", "show", "look", "working", "assistant"]);

let assistantState = null;
let assistantLoading = null;
let assistantLoop = false;
let assistantTimer = null;
let assistantTickInFlight = null;
let assistantTickDemand = null;
let assistantBlocker = null;
let assistantSavedAt = 0;
let assistantSaveTimer = null;
let assistantEmitTimer = null;
let assistantEmitPending = null;
let assistantFirstTickResolve = null;
const assistantFirstTick = new Promise((resolve) => (assistantFirstTickResolve = resolve));
const assistantCache = { store: null, storeError: null, machine: null, audit: null, chats: [], chatsAt: 0, porcelain: "", porcelainAt: 0 };
let assistantStoreReadInFlight = null;
// How much of every agent's conversation the overseer may look at. Chats are
// the earliest place a stuck or confused run shows up, so it reads them all —
// bounded, because they share the 14k fact budget with everything else.
const OVERSEER_CHAT_LIMIT = 40;
const OVERSEER_CHAT_WINDOW_MS = 6 * 3600 * 1000;
const pool = { queue: [], running: new Map(), seq: 0, waiters: [] };
// What the previous process left in flight, read from the raw file at load
// and restarted by startAssistant().
let assistantPending = null;
let assistantWriting = null;
let assistantWriteAgain = false;
let tray = null;
let trayPaused = null;

// Last resort when scripts/assistant.mjs itself cannot load: the thread and
// the pool still work, the smart parts report themselves missing.
function assistantEmptyState(now) {
  return {
    version: 1,
    status: "running",
    startedAt: now,
    heartbeatAt: 0,
    tickCount: 0,
    nextTickAt: 0,
    intervalMs: 30000,
    ai: { keyPresent: false, online: false, lastOkAt: 0, lastError: null, failures: 0, backoffUntil: 0, model: ASSISTANT_MODEL },
    action: { kind: "idle", text: "idle", since: now },
    lastError: null,
    messages: [],
    log: [],
    thinking: null,
    fixes: [],
    organization: {
      updatedAt: 0,
      policy: { foldAfterMinutes: 60, staleAfterHours: 24, maxSessions: 8, maxTodosPerSession: 14 },
      order: [],
      active: [],
      stale: [],
      folded: [],
      counts: { sessions: 0, active: 0, stale: 0, folded: 0, hiddenTodos: 0 },
    },
    housekeeping: { lastAt: 0, tasksArchived: 0, ideasPruned: 0, requestsCleared: 0, checkpointsDropped: 0, foldersCleaned: 0, lastText: "" },
    problems: [],
    unread: 0,
    prefs: { proactive: true, keepAwake: true, background: true, foldAfterMinutes: 60, staleAfterHours: 24, tidyDoneAfterHours: 24, parallel: 8, aiParallel: 4 },
    pool: { parallel: 8, aiParallel: 4, running: 0, queued: 0 },
    agents: [],
    work: [],
    overseer: { reviews: 0, lastReviewAt: 0, lastSummary: "", score: null, health: "unknown", findings: [], lessons: [], directives: [], scores: [], digest: null },
    focus: null,
    nodeFolders: {},
    closedAt: 0,
    resumed: null,
  };
}

async function assistantKeyPresent() {
  try {
    const settings = await readSettings();
    return Boolean(settings.apiKeyEncrypted || settings.zaiApiKeyEncrypted) && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

async function loadAssistant() {
  const now = Date.now();
  let raw = null;
  try {
    raw = JSON.parse(await readFile(projectDataPath(ASSISTANT_PATH), "utf8"));
  } catch {}
  let moduleError = null;
  try {
    const assistant = await getAssistant();
    // The raw file still says what was running when the app went away;
    // normalizeState turns those rows idle, so the pending work is read first.
    assistantPending = raw ? assistant.pendingWork(raw, now) : null;
    assistantState = assistant.normalizeState(raw, now);
    assistantState.closedAt = Number(raw?.heartbeatAt) || 0;
  } catch (error) {
    moduleError = error;
    assistantState = assistantEmptyState(now);
  }
  const settings = await readSettings();
  const stored = settings.assistant ?? {};
  // Migration: the explorer's old settings.ui.proactive switch seeds the pref.
  const proactive = stored.proactive ?? settings.ui?.proactive ?? true;
  assistantState.prefs = { ...assistantState.prefs, ...stored, proactive: proactive !== false };
  // A saved parallelism is an explicit choice, old-looking or not — the
  // machine default only fills a preference that was never set. (It used to
  // override 1–3 as "the old throttle", silently undoing the operator.)
  // Keep the persisted label (what last answered); the default only covers a
  // state that never recorded a call. Live calls re-record it via assistantFetch.
  assistantState.ai.model = assistantState.ai.model || ASSISTANT_MODEL;
  assistantState.ai.keyPresent = await assistantKeyPresent();
  assistantState.action = { kind: "idle", text: "idle", since: now };
  assistantState.projectId = projects.current().id;
  assistantState.projectPath = projectRoot();
  assistantPoolCounts();
  if (moduleError) assistantLog("error", `assistant logic unavailable: ${moduleError.message}`);
  return assistantState;
}

async function ensureAssistant() {
  if (assistantState) return assistantState;
  if (!assistantLoading) assistantLoading = loadAssistant().finally(() => (assistantLoading = null));
  return assistantLoading;
}

function assistantCaps() {
  return assistantModule?.CAPS ?? ASSISTANT_CAPS;
}

function assistantTrim(list, cap) {
  if (list.length > cap) list.splice(0, list.length - cap);
}

// At most one write per 2 s; a throttled save lands through a trailing timer,
// forced saves (message, reply, fix, quit) land now. CLI runs never write the
// file: a GUI instance may own it.
async function saveAssistant({ force = false } = {}) {
  if (!assistantState || CLI_MODE) return;
  const wait = 2000 - (Date.now() - assistantSavedAt);
  if (!force && wait > 0) {
    if (!assistantSaveTimer) {
      assistantSaveTimer = setTimeout(() => {
        assistantSaveTimer = null;
        saveAssistant({ force: true }).catch(() => {});
      }, wait);
      assistantSaveTimer.unref?.();
    }
    return;
  }
  if (assistantSaveTimer) clearTimeout(assistantSaveTimer);
  assistantSaveTimer = null;
  await assistantWrite();
}

// One writer at a time: a write asked for mid-write runs once more after it,
// so the newest state always lands and the file is never written twice at once.
function assistantWrite() {
  if (assistantWriting) {
    assistantWriteAgain = true;
    return assistantWriting;
  }
  assistantWriting = (async () => {
    do {
      assistantWriteAgain = false;
      assistantSavedAt = Date.now();
      try {
        const eyes = await getEyes();
        await eyes.writeJson(ASSISTANT_PATH, assistantState);
      } catch (error) {
        logLine(`[assistant] save failed: ${error.message}`);
      }
    } while (assistantWriteAgain);
  })().finally(() => {
    assistantWriting = null;
  });
  return assistantWriting;
}

// The journal: every job start and finish lands on disk at once, so a crash
// leaves the truth in the file for the next boot.
function assistantJournal(entry) {
  if (!assistantState) return;
  try {
    if (assistantModule?.applyWork) assistantState = assistantModule.applyWork(assistantState, entry, Date.now());
  } catch (error) {
    logLine(`[assistant] journal update failed: ${error.message}`);
  }
  if (!CLI_MODE) assistantWrite().catch(() => {});
}

function assistantJobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function assistantClip(value, max) {
  const line = String(value ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function assistantInFlight(id) {
  return pool.queue.some((entry) => entry.key === id || entry.work?.id === id) || [...pool.running.values()].some((entry) => entry.key === id || entry.work?.id === id);
}

const sessionTarget = (id) => ({ kind: "session", id });
const taskTarget = (id) => ({ kind: "task", id: `task:${id}` });

// A role's default targets from the current tree organization.
function assistantRoleTargets(role) {
  const organization = assistantState?.organization ?? {};
  const folded = (organization.counts?.folded ?? 0) > 0 ? [FOLDED_NODE] : [];
  if (role === "watcher") return [...(organization.order ?? []).map(sessionTarget), ...folded];
  if (role === "briefer") return (organization.active ?? []).length ? organization.active.map(sessionTarget) : [ASSISTANT_NODE];
  if (role === "machine" || role === "keeper" || role === "compactor" || role === "foreman") return [ROOT_NODE];
  if (role === "thinker") return [ASSISTANT_NODE];
  if (role === "grower") return folded.length ? folded : [ASSISTANT_NODE];
  return [ASSISTANT_NODE];
}

function assistantSessionTitle(id) {
  const session = (assistantCache.store?.sessions ?? []).find((row) => row.id === id);
  return assistantClip(session?.title || id, 40);
}

// The roster row keeps the pool's truth about where its agent is (the pure
// module's rows carry no target fields of their own).
function assistantRowTargets(role, { target = null, targets = [], progress = null } = {}) {
  const row = (assistantState?.agents ?? []).find((entry) => entry.role === role);
  if (row) Object.assign(row, { target, targets, progress });
}

// Roster label for a journaled job: "responder · replying to "…"".
function assistantJobLabel(role, work) {
  const verb = work?.kind === "analyzer" ? "analyzing" : ASSISTANT_ROLE_VERBS[role] ?? role;
  return `${role} · ${verb}${work?.text ? ` "${work.text}"` : ""}`;
}

// The module's own wording for a journal entry, for resume lines.
function assistantWorkLabel(job) {
  return job.kind === "responder" ? `reply to "${job.text}"` : `${job.kind}${job.text ? ` "${job.text}"` : ""}`;
}

// One hop: the agent's current target changes and a `running` event says so.
async function assistantHop(entry, target, { progress = null, label = null } = {}) {
  if (entry.settled) return;
  entry.target = target;
  entry.progress = progress;
  assistantRowTargets(entry.role, { target, targets: entry.targets, progress });
  if (progress !== 1 && Date.now() - (entry.lastHopAt || 0) < ASSISTANT_HOP_MS) return;
  entry.lastHopAt = Date.now();
  const text = `${entry.role} · ${label ?? `at ${target.kind} ${target.id}`}`;
  assistantApply({ role: entry.role, status: "running", at: entry.startedAt, text });
  assistantRowTargets(entry.role, { target, targets: entry.targets, progress });
  assistantAgentEvent(entry.role, "running", text, { target, targets: entry.targets, progress });
}

// Record the targets already visited by a local pass, without charging its
// pool slot a presentation delay for each node. The final target is emitted.
async function assistantVisit(entry, targets, label = () => null) {
  const list = targets.slice(0, 12);
  if (!list.length) return;
  entry.targets = list;
  for (const [index, target] of list.entries()) {
    await assistantHop(entry, target, { progress: (index + 1) / list.length, label: label(target, index, list.length) });
  }
}

// Cycle through the targets while a long call runs (the briefer over the
// active sessions), then hand back the call's result.
async function assistantVisitWhile(entry, promise, targets, label = () => null) {
  let settled = false;
  const list = targets.slice(0, 12);
  entry.targets = list;
  let index = 0;
  let timer = null;
  const visit = async () => {
    if (settled || !list.length || entry.settled) return;
    const target = list[index % list.length];
    await assistantHop(entry, target, { progress: null, label: label(target, index % list.length, list.length) });
    index += 1;
    if (!settled && !entry.settled) {
      timer = setTimeout(() => visit().catch(() => {}), ASSISTANT_HOP_MS);
      timer.unref?.();
    }
  };
  // Install the rejection handler immediately; animation never delays either
  // a fulfilled result or a failure and cannot leave a timer behind afterward.
  const outcome = Promise.resolve(promise).finally(() => {
    settled = true;
    if (timer) clearTimeout(timer);
  });
  visit().catch(() => {});
  return outcome;
}

// The session or task a message talks about, by title keyword overlap.
function assistantMentionTarget(text, facts) {
  const words = (value) => (String(value ?? "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !ASSISTANT_STOP_WORDS.has(word));
  const wanted = new Set(words(text));
  if (!wanted.size) return null;
  let best = null;
  const consider = (title, target) => {
    const hits = words(title).filter((word) => wanted.has(word)).length;
    if (hits && (!best || hits > best.hits)) best = { hits, target, title: assistantClip(title, 40) };
  };
  for (const session of facts?.sessions ?? []) consider(session.title, sessionTarget(session.id));
  for (const task of facts?.tasks ?? []) consider(task.title, taskTarget(task.id));
  return best;
}

// The node a tree click pointed at, as a {target, title} pair — the responder
// walks to it when the message text names nothing else. Session and task ids
// are checked against the facts so a stale click never flies the agent to a
// node that is gone.
function assistantFocusSubject(facts) {
  const focus = assistantState?.focus;
  if (!focus?.kind || !focus?.id) return null;
  if (focus.kind === "session" && facts?.sessions && !facts.sessions.some((session) => session.id === focus.id)) return null;
  if (focus.kind === "task" && facts?.tasks && !facts.tasks.some((task) => taskTarget(task.id).id === focus.id)) return null;
  return { target: { kind: focus.kind, id: focus.id }, title: assistantClip(focus.label || focus.id, 40) };
}

function saveAssistantSync() {
  if (!assistantState || CLI_MODE) return;
  const target = projectDataPath(ASSISTANT_PATH);
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    // Atomic like assistantWrite: a crash mid-write used to tear the store.
    writeFileSync(tmp, JSON.stringify(assistantState, null, 2));
    renameSync(tmp, target);
  } catch {
    rmSync(tmp, { force: true });
  }
}

function assistantLog(kind, text, extra = null) {
  if (!assistantState) return null;
  const entry = { at: Date.now(), kind, text: String(text).slice(0, 400) };
  assistantState.log.push(entry);
  assistantTrim(assistantState.log, assistantCaps().log);
  if (kind !== "tick" && kind !== "message" && kind !== "reply" && kind !== "think") logLine(`[assistant] ${entry.text}`);
  if (SMOKE) console.log(`[assistant] ${kind}: ${entry.text}`);
  // The log row stays {at, kind, text}; extras (a focus target, say) ride the
  // pushed event only, so renderers can point at the node it names.
  assistantEmit(extra ? { ...entry, ...extra } : entry);
  return entry;
}

// Live inner monologue in the assistant box. Does not bump unread and is not
// a log line — the thinker reads the log, it must not write itself into it
// on every refresh.
function assistantThink(text, role = "thinker") {
  if (!assistantState) return null;
  const next = { text: assistantClip(text, 280), at: Date.now(), role: String(role || "thinker").slice(0, 24) };
  if (!next.text) return assistantState.thinking;
  if (assistantState.thinking?.text === next.text && assistantState.thinking?.role === next.role) return assistantState.thinking;
  assistantState.thinking = next;
  assistantEmit({ kind: "think", text: next.text, role: next.role, at: next.at });
  return next;
}

function assistantCommitThought(text, role = "thinker") {
  if (!assistantState) return null;
  const at = Date.now();
  try {
    if (assistantModule?.applyThought) assistantState = assistantModule.applyThought(assistantState, { text, role, at }, at);
    else assistantThink(text, role);
  } catch {
    assistantThink(text, role);
  }
  const thought = assistantState?.thinking ?? null;
  if (thought?.text) assistantEmit({ kind: "think", text: thought.text, role: thought.role, at: thought.at });
  return thought;
}

function assistantThinkClear(role = null) {
  if (!assistantState?.thinking) return;
  if (role && assistantState.thinking.role !== role) return;
  assistantState.thinking = null;
  assistantEmit({ kind: "think", text: "" });
}

function assistantFix(kind, text, ok = true) {
  if (!assistantState) return;
  assistantState.fixes.push({ at: Date.now(), kind, text: String(text).slice(0, 300), ok });
  assistantTrim(assistantState.fixes, assistantCaps().fixes);
  assistantLog("fix", ok ? text : `${text} (failed)`);
}

// Coalesced push: the first event goes out at once, the rest of a 250 ms
// window collapses to its highest-ranked event (the state rides along fresh
// either way), so the renderer never sees more than ~4 pushes a second.
function assistantEmit(event) {
  if (assistantEmitTimer) {
    if (!assistantEmitPending || (ASSISTANT_EVENT_RANK[event.kind] ?? 1) >= (ASSISTANT_EVENT_RANK[assistantEmitPending.kind] ?? 1)) assistantEmitPending = event;
    return;
  }
  send("eyes:assistant", { state: assistantState, event });
  refreshTray();
  assistantEmitTimer = setTimeout(() => {
    assistantEmitTimer = null;
    const pending = assistantEmitPending;
    assistantEmitPending = null;
    if (pending) assistantEmit(pending);
  }, 250);
  assistantEmitTimer.unref?.();
}

function assistantAiOk() {
  const ai = assistantState.ai;
  ai.online = true;
  ai.failures = 0;
  ai.lastOkAt = Date.now();
  ai.lastError = null;
  ai.backoffUntil = 0;
}

function assistantAiFailed(error) {
  const ai = assistantState.ai;
  const now = Date.now();
  ai.online = false;
  ai.failures += 1;
  ai.lastError = String(error ?? "unknown error").slice(0, 200);
  ai.backoffUntil = now + (assistantModule?.nextBackoffMs?.(ai.failures) ?? Math.min(60, 5 * 2 ** (ai.failures - 1)) * 60000);
  const minutes = Math.max(1, Math.round((ai.backoffUntil - now) / 60000));
  assistantLog("error", `AI offline: ${ai.lastError} · retry in ${minutes}m`);
  return minutes;
}

function assistantAiUsable() {
  const ai = assistantState.ai;
  return Boolean(ai.keyPresent) && Date.now() >= (ai.backoffUntil ?? 0);
}

// Open problems are owned per role: a role replaces its own kinds when it
// finishes. `since` survives, and a problem is logged once, when it appears.
function assistantSetProblems(kinds, list) {
  const now = Date.now();
  const previous = new Map((assistantState.problems ?? []).map((problem) => [problem.kind, problem]));
  const kept = (assistantState.problems ?? []).filter((problem) => !kinds.includes(problem.kind));
  const next = list.map((problem) => ({ ...problem, since: previous.get(problem.kind)?.since ?? now }));
  for (const problem of next) if (!previous.has(problem.kind)) assistantLog("error", `problem: ${problem.text}`);
  assistantState.problems = [...kept, ...next];
}

// ---- the agent pool ---------------------------------------------------------
// Every start / finish / error goes through the module's applyAgentEvent
// (which returns a new state), then the true pool counts are written back:
// the roster has one row per role, but several responders may run at once.
const EXECUTOR_PARALLEL_MAX = 12;
// Hard cap while opencode's snapshot store cannot take concurrent writers.
// Every `opencode run` snapshots the tree into ONE shared git worktree
// (~/.local/share/opencode/snapshot); concurrent startups collide on that
// worktree's git index and wedge silently before printing a line, and a
// watchdog kill leaves the lock stale for every run after. On 2026-09-18,
// 117 consecutive concurrent runs wedged this way while every solo run
// finished. Raise this only when opencode serializes that store itself.
const EXECUTOR_PARALLEL_CAP = 1;
const AI_PARALLEL_MAX = 6;
function assistantPoolCounts() {
  if (!assistantState) return;
  const prefs = assistantState.prefs ?? {};
  assistantState.pool = {
    parallel: assistantParallel(prefs.parallel, EXECUTOR_PARALLEL_MAX, 8),
    aiParallel: assistantParallel(prefs.aiParallel, AI_PARALLEL_MAX, 4),
    running: pool.running.size,
    queued: pool.queue.length,
  };
}

function assistantParallel(value, max, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 1 ? Math.min(max, number) : fallback;
}

function assistantApply(event) {
  if (!assistantState) return;
  try {
    if (assistantModule?.applyAgentEvent) assistantState = assistantModule.applyAgentEvent(assistantState, { at: Date.now(), ...event });
  } catch (error) {
    logLine(`[assistant] roster update failed: ${error.message}`);
  }
  assistantPoolCounts();
}

function assistantAgentEvent(role, status, text, { target = null, targets = [], progress = null } = {}) {
  if (SMOKE) console.log(`[assistant] agent: ${text}${target ? ` → ${target.kind}:${target.id}` : ""}`);
  assistantEmit({ at: Date.now(), kind: "agent", role, status, text: String(text).slice(0, 200), target, targets, progress });
}

// A finished job hands its finding to the assistant node — the one main agent
// every scout answers to — so the plan and the dispatch that follow are built
// on what was just seen, not on a stale snapshot. `facts` are the role's own
// numbers (sessions, collisions, errors…); the one-line `text` is the finding.
function assistantReportIntel(role, text, facts = null) {
  const finding = String(text ?? "").trim();
  if (!finding || !assistantModule?.applyIntel) return;
  const safeFacts = facts && typeof facts === "object" ? facts : {};
  try {
    assistantState = assistantModule.applyIntel(assistantState, { role, at: Date.now(), text: finding, facts: safeFacts });
  } catch (error) {
    logLine(`[assistant] intel update failed: ${error.message}`);
  }
  assistantEmit({ at: Date.now(), kind: "intel", role, text: finding.slice(0, 200), facts: safeFacts });
}

// An executor run reports home while it is still on the board, so the
// Command view can pulse builder → assistant. The overseer thinks the
// finding through (a thought bubble, not unread) and wakes on failures.
function assistantHearBuilder(entry, job, ok) {
  if (!assistantState) return;
  const tail = (entry.outputTail ?? []).filter(Boolean).slice(-2).join(" · ");
  const handed = (entry.handoffs ?? []).length;
  const finding = ok
    ? `finished "${assistantClip(job.title, 50)}"${tail ? ` · ${assistantClip(tail, 70)}` : ""}`
    : `failed "${assistantClip(job.title, 50)}" · ${assistantClip(autopilot.lastError || tail || `no ${EXECUTOR_DONE_MARK}`, 80)}`;
  let heard = null;
  try {
    if (assistantModule?.hearReport) {
      heard = assistantModule.hearReport(
        assistantState,
        {
          role: "builder",
          ok,
          title: job.title,
          text: finding,
          error: ok ? "" : autopilot.lastError || tail || `no ${EXECUTOR_DONE_MARK}`,
          handed,
        },
        Date.now(),
      );
    }
  } catch (error) {
    logLine(`[assistant] hearReport failed: ${error.message}`);
  }
  if (heard?.state) assistantState = heard.state;
  else assistantReportIntel("builder", finding, { ok, title: job.title, handed });
  if (heard?.finding) {
    assistantEmit({ at: Date.now(), kind: "intel", role: "builder", text: heard.finding.slice(0, 200), facts: { ok, title: job.title }, title: job.title });
  }
  assistantLog(ok ? "fix" : "error", `builder ${heard?.finding || finding}`);
  if (!ok && heard?.reply && job.source !== "chat") {
    assistantAppendReply(heard.reply, "local", "overseer");
    saveAssistant({ force: true }).catch(() => {});
  } else {
    saveAssistant().catch(() => {});
  }
  return heard;
}

// A context entry lands on a node's folder — what an agent did there, what the
// chat settled, what the owner pinned. The module bounds the entry and the
// folder; the save is the usual throttled one and the push lets an open card
// refresh.
function assistantNodeContext(target, kind, text, role = null) {
  if (!assistantState || !assistantModule?.applyNodeContext) return;
  const clean = String(text ?? "").trim();
  if (!clean) return;
  try {
    assistantState = assistantModule.applyNodeContext(assistantState, { target, kind, role, text: clean, at: Date.now() });
  } catch (error) {
    logLine(`[assistant] node context failed: ${error.message}`);
    return;
  }
  assistantEmit({ at: Date.now(), kind: "context", target, text: clean.slice(0, 160) });
  saveAssistant().catch(() => {});
}

// A duplicate key while queued or running shares the job in flight. `work`
// is the journal entry for a resumable job (on-demand work and replies).
function enqueue(role, job, { ai = false, priority = ASSISTANT_PRIORITY.cadence, key = role, text = null, work = null, targets = null } = {}) {
  const existing = pool.queue.find((entry) => entry.key === key) ?? [...pool.running.values()].find((entry) => entry.key === key);
  if (existing) return existing.promise;
  const where = Array.isArray(targets) && targets.length ? targets : assistantRoleTargets(role);
  const journal = work ? { attempts: 1, ...work, id: work.id ?? assistantJobId(), role, text: work.text ?? "", target: where[0] ?? null, targets: where } : null;
  const entry = {
    id: ++pool.seq,
    project: projects.current(),
    role,
    key,
    ai,
    priority,
    job,
    work: journal,
    targets: where,
    target: where[0] ?? null,
    progress: null,
    lastHopAt: 0,
    queuedAt: Date.now(),
    startedAt: 0,
    settled: false,
    resolve: null,
    promise: null,
  };
  entry.promise = new Promise((resolve) => (entry.resolve = resolve));
  pool.queue.push(entry);
  if (journal) assistantJournal({ ...journal, status: "queued", startedAt: Date.now() });
  assistantApply({ role, status: "queued", text: journal ? assistantJobLabel(role, journal) : text ?? `${role} queued` });
  assistantRowTargets(role, { target: entry.target, targets: entry.targets, progress: null });
  assistantPump();
  return entry.promise;
}

// Worker loop: priority first, then arrival. A role never runs twice at once
// (responders excepted: one job per message, never held back by the caps so
// a reply is never blocked by a tick or a briefing). The foreman is the same
// — handing out work is the heartbeat; watcher/auditor ticks must not starve it.
function assistantPump() {
  if (!assistantState || projectSwitching) return;
  const parallel = assistantParallel(assistantState.prefs?.parallel, EXECUTOR_PARALLEL_MAX, 8);
  const aiParallel = assistantParallel(assistantState.prefs?.aiParallel, AI_PARALLEL_MAX, 4);
  pool.queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
  let started = true;
  while (started) {
    started = false;
    const runningRoles = new Set([...pool.running.values()].map((entry) => entry.role));
    const aiRunning = [...pool.running.values()].filter((entry) => entry.ai).length;
    for (let index = 0; index < pool.queue.length; index += 1) {
      const entry = pool.queue[index];
      if (entry.role !== "responder" && entry.role !== "foreman") {
        if (pool.running.size >= parallel || runningRoles.has(entry.role)) continue;
        if (entry.ai && aiRunning >= aiParallel) continue;
      } else if (runningRoles.has(entry.role) && entry.role === "foreman") {
        continue;
      }
      pool.queue.splice(index, 1);
      assistantStart(entry);
      started = true;
      break;
    }
  }
  if (!pool.queue.length && !pool.running.size) for (const resolve of pool.waiters.splice(0)) resolve();
}

function assistantStart(entry) {
  entry.startedAt = Date.now();
  pool.running.set(entry.id, entry);
  const label = entry.work ? assistantJobLabel(entry.role, entry.work) : `${entry.role} started`;
  if (entry.work) assistantJournal({ ...entry.work, status: "running", startedAt: entry.startedAt });
  else if (!CLI_MODE) assistantWrite().catch(() => {});
  entry.lastHopAt = entry.startedAt;
  assistantApply({ role: entry.role, status: "running", at: entry.startedAt, text: label });
  assistantRowTargets(entry.role, { target: entry.target, targets: entry.targets, progress: null });
  assistantAgentEvent(entry.role, "running", label, { target: entry.target, targets: entry.targets, progress: null });
  assistantThink(label, entry.role);
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ASSISTANT_JOB_TIMEOUT_MS);
  });
  projectAgentJobs += 1;
  const work = projects.run(entry.project, () => Promise.resolve().then(() => entry.job(entry)).finally(() => { projectAgentJobs -= 1; }));
  Promise.race([work, timeout])
    .then(
      (result) => assistantSettle(entry, result?.timedOut ? { error: "timed out" } : { result }),
      (error) => assistantSettle(entry, { error })
    )
    .finally(() => clearTimeout(timer));
}

// A late result after a timeout is ignored: the role was freed already.
function assistantSettle(entry, { result, error }) {
  if (entry.settled) return;
  entry.settled = true;
  pool.running.delete(entry.id);
  const ms = Date.now() - entry.startedAt;
  const seconds = `${(ms / 1000).toFixed(1)} s`;
  const failure = error !== undefined ? String(error?.message ?? error) : result && typeof result === "object" && result.ok === false ? String(result.error ?? "failed") : null;
  if (failure !== null) {
    const text = `${entry.role} failed · ${failure.slice(0, 200)}`;
    assistantState.lastError = { at: Date.now(), text };
    assistantApply({ role: entry.role, status: "error", error: failure.slice(0, 300), text, ms });
    assistantRowTargets(entry.role, { target: null, targets: entry.targets, progress: null });
    assistantLog("error", text);
    assistantAgentEvent(entry.role, "error", text, { target: null, targets: entry.targets, progress: null });
  } else {
    const summary = typeof result?.text === "string" ? result.text : "ok";
    const text = `${entry.role} done · ${summary.slice(0, 120)} · ${seconds}`;
    assistantApply({ role: entry.role, status: "done", text, ms });
    assistantRowTargets(entry.role, { target: null, targets: entry.targets, progress: 1 });
    assistantAgentEvent(entry.role, "done", text, { target: null, targets: entry.targets, progress: 1 });
    // A role that found something says so on the assistant's intel board: the
    // finding line when it wrote one, its summary otherwise.
    assistantReportIntel(entry.role, typeof result?.finding === "string" && result.finding.trim() ? result.finding : summary, result?.intel);
  }
  entry.resolve(error !== undefined ? { ok: false, error: failure } : result);
  if (entry.work) assistantJournal({ id: entry.work.id, done: true });
  else if (!CLI_MODE) assistantWrite().catch(() => {});
  assistantThinkClear(entry.role);
  assistantPump();
}

// Resolves once nothing is queued or running.
function assistantDrain() {
  if (!pool.queue.length && !pool.running.size) return Promise.resolve();
  return new Promise((resolve) => pool.waiters.push(resolve));
}

// Queued cadence work is dropped (pause, quit); running jobs finish on their
// own or are abandoned on quit. Responders stay: a message still gets a reply.
function assistantClearQueue({ abandonRunning = false, text = "dropped" } = {}) {
  const keep = [];
  for (const entry of pool.queue) {
    if ((entry.role === "responder" || entry.work) && !abandonRunning) {
      keep.push(entry);
      continue;
    }
    entry.settled = true;
    assistantApply({ role: entry.role, status: "idle", text });
    assistantRowTargets(entry.role);
    entry.resolve({ ok: false, error: text });
  }
  pool.queue = keep;
  if (abandonRunning) {
    for (const entry of pool.running.values()) {
      entry.settled = true;
      assistantApply({ role: entry.role, status: "idle", text });
      assistantRowTargets(entry.role);
      entry.resolve({ ok: false, error: text });
    }
    pool.running.clear();
  }
  assistantPoolCounts();
  if (!pool.queue.length && !pool.running.size) for (const resolve of pool.waiters.splice(0)) resolve();
}

// ---- role jobs: each returns { ok, text } for the roster ------------------
// Live facts from the OpenCode store; throws when the store is unavailable.
function readPorcelain(eyes) {
  const now = Date.now();
  if (assistantCache.porcelainAt && now - assistantCache.porcelainAt < 30_000 && typeof assistantCache.porcelain === "string") {
    return assistantCache.porcelain;
  }
  const text = typeof eyes.gitPorcelain === "function" ? eyes.gitPorcelain({ root: projectRoot() }) : "";
  assistantCache.porcelain = text;
  assistantCache.porcelainAt = now;
  return text;
}

async function assistantReadStore() {
  // Watcher, overseer and chat often arrive together. Share only the read in
  // progress; the next completed-read boundary always sees fresh store data.
  if (assistantStoreReadInFlight) return assistantStoreReadInFlight;
  assistantStoreReadInFlight = (async () => {
    const eyes = await getEyes();
    const sessions = eyes.listSessions({ limit: 40 });
    const porcelain = readPorcelain(eyes);
    const store = {
      sessions,
      todos: eyes.listTodos(),
      collisions: eyes.collisions({ root: projectRoot() }),
      presence: eyes.filePresence({ root: projectRoot() }),
      uncommitted: eyes.uncommittedOnly({
        porcelain,
        sessions,
        changes: eyes.listChanges({ limit: 80 }),
        root: projectRoot(),
      }),
      at: Date.now(),
    };
    assistantCache.store = store;
    assistantCache.storeError = null;
    // Every agent's recent conversation, refreshed at most once a minute — the
    // overseer reads these, and re-querying the store on every watcher pass would
    // cost more than the freshness is worth.
    if (Date.now() - assistantCache.chatsAt > MINUTE_MS) {
      try {
        assistantCache.chats = eyes
          .listChatTexts({ since: Date.now() - OVERSEER_CHAT_WINDOW_MS, limit: 400 })
          .slice(0, OVERSEER_CHAT_LIMIT)
          .map((row) => ({ sessionId: row.sessionId, at: row.at, text: String(row.text).slice(0, 200) }));
        assistantCache.chatsAt = Date.now();
      } catch (error) {
        assistantCache.chats = [];
        assistantCache.chatsAt = Date.now();
      }
    }
    return store;
  })().finally(() => {
    assistantStoreReadInFlight = null;
  });
  return assistantStoreReadInFlight;
}

async function assistantOrganize(now, store = assistantCache.store) {
  if (!store) return false;
  const assistant = await getAssistant();
  const next = assistant.organize({ sessions: store.sessions, todos: store.todos, now, policy: assistant.policyFromPrefs(assistantState.prefs) });
  if (assistant.sameOrganization(next, assistantState.organization)) return false;
  assistantState.organization = next;
  const counts = next.counts ?? {};
  assistantLog("organize", `organized the tree · ${counts.active ?? 0} active · ${counts.stale ?? 0} stale · ${counts.folded ?? 0} folded`);
  await saveAssistant();
  return true;
}

// Parallel-executor merges land as two copies of the same top-level binding.
// Always scan the host files; also scan whatever collisions/presence currently
// name, so a live session's patch is caught before a second copy is written.
async function executorScanFiles(store) {
  const files = new Set([
    path.join(projectRoot(), "main.cjs"),
    path.join(projectRoot(), "preload.cjs"),
  ]);
  // Uncommitted feature code is rarely only the host set: every helper module
  // and renderer script carries top-level bindings a second patch can double.
  for (const dir of ["scripts", "renderer"]) {
    try {
      for (const entry of await readdir(path.join(projectRoot(), dir))) {
        if (!/\.(?:js|mjs|cjs)$/i.test(entry)) continue;
        files.add(path.join(projectRoot(), dir, entry));
      }
    } catch {
      // A missing directory just means fewer files to scan.
    }
  }
  for (const row of store?.collisions ?? []) {
    for (const file of row.files ?? [row.file]) if (file) files.add(String(file));
  }
  for (const row of store?.presence ?? []) {
    if (row.file) files.add(String(row.file));
  }
  return [...files];
}

async function duplicateDeclarationRequests(eyes, store, known) {
  if (!eyes?.scanDuplicateDeclarations || !eyes?.requestsFromDuplicates) return [];
  const scanned = await executorScanFiles(store);
  const findings = await eyes.scanDuplicateDeclarations(scanned);
  assistantCache.duplicateScan = { scanned, findings };
  return eyes.requestsFromDuplicates(findings, known ?? []);
}

// watcher: store facts, collision requests, the tree organization, then a
// pass over every session on the tree (colliding ones first) and the cluster.
async function assistantWatcherJob(now, entry) {
  let store = null;
  try {
    store = await assistantReadStore();
  } catch (error) {
    assistantCache.storeError = String(error?.message ?? error).slice(0, 200);
  }
  try {
    const eyes = await getEyes();
    const known = await requestBaseline(eyes);
    if (store?.collisions.length) {
      const queued = await queueRequests(eyes.requestsFromCollisions(store.collisions, known));
      if (queued) assistantLog("collision", `${queued} collision request(s) queued`);
    }
    const duped = await queueRequests(await duplicateDeclarationRequests(eyes, store, known));
    if (duped) assistantLog("error", `${duped} duplicate-declaration request(s) queued`);
  } catch (error) {
    assistantLog("error", `watcher request scan failed: ${error.message}`);
  }
  const organized = store ? await assistantOrganize(now, store) : false;
  const problems = [];
  if (!store) problems.push({ kind: "store-unavailable", text: `OpenCode store unavailable: ${assistantCache.storeError}` });
  if (store?.collisions.length) {
    const files = store.collisions.slice(0, 3).map((collision) => path.basename(String(collision.file)));
    problems.push({ kind: "collision", text: `${store.collisions.length} file(s) edited by several sessions: ${files.join(", ")}` });
  }
  assistantSetProblems(["store-unavailable", "collision"], problems);
  const counts = assistantState.organization?.counts ?? {};
  // The finding the watcher reports home to the assistant: what is actually
  // moving, by name — the active sessions, what is mid-flight, what is being
  // double-touched — so the assistant plans (and answers) from the watcher's
  // read of the store, not just a count triple.
  const todoRows = store?.todos ?? [];
  const inProgress = todoRows.filter((todo) => todo && todo.status === "in_progress").length;
  const openTodos = todoRows.filter((todo) => todo && todo.status !== "completed" && todo.status !== "cancelled").length;
  const activeTitles = (assistantState.organization?.order ?? [])
    .slice(0, 3)
    .map((sessionId) => assistantSessionTitle(sessionId))
    .filter(Boolean);
  const finding = store
    ? `${counts.active ?? 0} active${activeTitles.length ? `: ${activeTitles.join(", ")}` : ""}` +
      `${inProgress ? ` · ${inProgress} todo(s) in progress` : ""}` +
      `${store.collisions.length ? ` · collision: ${store.collisions.slice(0, 2).map((collision) => path.basename(String(collision.file))).join(", ")}` : ""}` +
      `${counts.stale ? ` · ${counts.stale} stale` : ""}`
    : "store unavailable";
  if (store && entry) {
    const colliding = (store.collisions ?? []).flatMap((collision) => (collision.sessions ?? []).map((row) => row.sessionId));
    const order = [...new Set([...colliding, ...(assistantState.organization?.order ?? [])])].map(sessionTarget);
    const targets = [...order, ...((counts.folded ?? 0) > 0 ? [FOLDED_NODE] : [])];
    await assistantVisit(entry, targets, (target) => (target.kind === "folded" ? `visiting ${counts.folded} finished sessions` : `visiting "${assistantSessionTitle(target.id)}"`));
  }
  return {
    ok: true,
    text: store ? `${counts.sessions ?? 0} sessions · ${counts.folded ?? 0} folded${organized ? " · reorganized" : ""}` : "store unavailable",
    finding,
    intel: {
      sessions: counts.sessions ?? 0,
      active: counts.active ?? 0,
      stale: counts.stale ?? 0,
      folded: counts.folded ?? 0,
      collisions: store?.collisions.length ?? 0,
      inProgress,
      openTodos,
      ...(activeTitles.length ? { busy: activeTitles.join(", ").slice(0, 60) } : {}),
    },
  };
}

// machine: the resource manager pass; kills become fixes.
async function assistantMachineJob() {
  const settings = await readSettings();
  const status = await resourcePass({ kill: settings.machine?.autoKill ?? MACHINE_DEFAULTS.autoKill, reason: "assistant", withProcesses: true });
  assistantCache.machine = status;
  for (const action of status.actions ?? []) assistantFix("process", `killed ${action.label || "LOVE process"} pid ${action.pid} (${action.status})`);
  const killed = new Set((status.actions ?? []).map((action) => action.pid));
  const unhealthy = (status.processes ?? []).filter((entry) => entry.status !== "healthy" && entry.status !== "other" && !killed.has(entry.pid));
  assistantSetProblems(
    ["machine"],
    unhealthy.length
      ? [{ kind: "machine", text: `${unhealthy.length} unhealthy LOVE process(es): ${unhealthy.slice(0, 3).map((entry) => `pid ${entry.pid} ${entry.status}`).join(", ")}` }]
      : []
  );
  const running = (status.running ?? []).length;
  return { ok: true, text: `${running ? `${running} test run(s)` : "machine quiet"}${killed.size ? ` · ${killed.size} killed` : ""}`, intel: { running, killed: killed.size, unhealthy: unhealthy.length } };
}

// A torn store (crash or concurrent write mid-save) truncates the tail, not
// the head: recover the longest prefix that still parses. The eyes-tasks
// store that was reset to empty here once held a 3172-line history this walk
// would have kept. A null fallback (assistant state) is never salvaged — it
// is rebuilt from memory instead.
function salvageJson(text, fallback) {
  if (fallback === null || typeof text !== "string") return null;
  const wantArray = Array.isArray(fallback);
  const open = wantArray ? "[" : "{";
  const close = wantArray ? "]" : "}";
  // String-aware scan of the tear: the last index where the top-level
  // container was balanced (trailing-garbage case), and the last safe element
  // boundary — a depth-1 comma — to cut at before auto-closing the container
  // (torn-tail case, where the closer itself was lost).
  let depth = 0;
  let inStr = false;
  let esc = false;
  let balanced = -1;
  let boundary = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) balanced = i;
    } else if (ch === "," && depth === 1) boundary = i;
  }
  const candidates = [];
  if (balanced >= 0) candidates.push(text.slice(0, balanced + 1));
  if (boundary >= 0) candidates.push(`${text.slice(0, boundary)}${close}`);
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (Array.isArray(value) === wantArray && value && typeof value === "object") return value;
    } catch {}
  }
  return null;
}

// The fix pass: a data file that no longer parses is set aside and reset, and
// a held live update is reported (the updater retries on its own).
async function assistantFixPass() {
  const eyes = await getEyes();
  const dataDir = path.dirname(projectDataPath(TASKS_PATH));
  let count = 0;
  for (const [name, fallback] of Object.entries(ASSISTANT_DATA_FALLBACKS)) {
    const file = path.join(dataDir, name);
    if (!existsSync(file)) continue;
    const raw = await readFile(file, "utf8").catch(() => null);
    if (raw === null) continue;
    try {
      JSON.parse(raw);
      continue;
    } catch {}
    // With the board store enabled the three board files are exported VIEWS:
    // a torn view is quarantined and regenerated FROM the database. The old
    // salvage wrote its best guess through writeJson, which routed into the
    // store — valid database rows were replaced by whatever the broken file
    // still contained (or by nothing). Salvage only applies when the file IS
    // the authority (no store, or the store degraded to files).
    if (typeof eyes.repairBoardView === "function") {
      let repaired = null;
      try {
        repaired = await eyes.repairBoardView(file);
      } catch {}
      if (repaired?.handled) {
        try {
          if (ASSISTANT_DATA_EVENTS[name]) send(ASSISTANT_DATA_EVENTS[name], await eyes.readJson(file, fallback));
          assistantFix("data", `data/${name} view was torn · kept ${path.basename(repaired.quarantine)}, regenerated ${repaired.count} row(s) from the store`);
          count += 1;
        } catch (error) {
          assistantFix("data", `data/${name} view was torn but the store copy could not be re-exported: ${error.message}`, false);
        }
        continue;
      }
    }
    const broken = path.join(dataDir, name.replace(/\.json$/, `.broken-${Date.now()}.json`));
    const salvaged = salvageJson(raw, fallback);
    if (salvaged) {
      try {
        await copyFile(file, broken);
        await eyes.writeJson(file, salvaged);
        if (ASSISTANT_DATA_EVENTS[name]) send(ASSISTANT_DATA_EVENTS[name], salvaged);
        const recovered = Array.isArray(salvaged) ? `${salvaged.length} item(s)` : "state";
        assistantFix("data", `data/${name} was torn · kept ${path.basename(broken)}, salvaged ${recovered}`);
        count += 1;
      } catch (error) {
        assistantFix("data", `data/${name} was torn and could not be salvaged: ${error.message}`, false);
      }
      continue;
    }
    try {
      await rename(file, broken);
      if (fallback === null) await saveAssistant({ force: true });
      else await eyes.writeJson(file, fallback);
      if (ASSISTANT_DATA_EVENTS[name]) send(ASSISTANT_DATA_EVENTS[name], fallback);
      assistantFix("data", `data/${name} did not parse · moved to ${path.basename(broken)} and reset`);
      count += 1;
    } catch (error) {
      assistantFix("data", `data/${name} did not parse and could not be reset: ${error.message}`, false);
    }
  }
  const update = updater?.status();
  const problems = update?.phase === "held" ? [{ kind: "update-held", text: `live update held: ${update.reason ?? "unknown reason"}${update.error ? ` · ${update.error}` : ""}` }] : [];
  return { count, problems };
}

// auditor: the local audit, its requests, then the fix pass.
async function assistantAuditorJob() {
  const auditor = await getAuditor();
  const eyes = await getEyes();
  const result = await auditor.audit();
  if (result.skipped) return { ok: true, text: result.text };
  assistantCache.audit = result;
  const queued = await queueRequests(auditor.auditRequests(result, await requestBaseline(eyes)));
  assistantLog("audit", `audit: ${result.errors} error(s), ${result.warnings} warning(s)${queued ? ` · ${queued} request(s) queued` : ""}`);
  const fixes = await assistantFixPass();
  const problems = [...fixes.problems];
  if (result.errors) {
    const first = result.findings.find((finding) => finding.level === "error");
    problems.push({ kind: "audit", text: `${result.errors} audit error(s): ${first?.message ?? ""}`.trim() });
  }
  assistantSetProblems(["audit", "update-held"], problems);
  return {
    ok: true,
    text: `${result.errors} error(s) · ${result.warnings} warning(s)${fixes.count ? ` · ${fixes.count} fix(es)` : ""}`,
    intel: { errors: result.errors, warnings: result.warnings, fixes: fixes.count, queued: queued ?? 0 },
  };
}

// keeper: tidy over the real files, then a visit to each task it archived
// and the cluster. Store facts and the audit go in as null when they are not
// known: the module then leaves requests and checkpoints alone rather than
// pruning them against an empty world.
// The compactor: collapse the queue into the work that is actually left, then
// fire off whatever can run. The keeper prunes by age; this one works on shape
// (duplicates, requests already on the board, expired backoffs) and always ends
// by filling the executor's free slots, so a compacted queue starts moving in
// the same pass rather than waiting for the next autopilot tick.
// The foreman: the assistant's dispatcher, and the only thing that fills an
// executor slot. The auto builder files requests and owns the child processes;
// choosing what runs is the assistant's job, so every "start something" in this
// file goes through here rather than reaching into the executor directly.
async function assistantForemanJob(now, entry) {
  // No early return on `!autopilot.execute`: the cooldown re-arm lives inside
  // executeNextRequest, so a foreman that skipped the call also skipped every
  // recovery — a parked executor stayed parked until an unrelated code path
  // happened to run it. The gate below reports the post-call state instead.
  const before = autopilot.jobs.map((job) => job.id);
  await executeNextRequest();
  const started = autopilot.jobs.filter((job) => !before.includes(job.id));
  if (started.length) {
    // Ride along to what it just handed out, so the tree shows the assistant
    // placing the work rather than jobs appearing from nowhere.
    for (const job of started.slice(0, 3)) {
      const target = job.taskId ? taskTarget(job.taskId) : job.sessionId ? sessionTarget(job.sessionId) : ASSISTANT_NODE;
      await assistantHop(entry, target, { label: `handed out "${assistantClip(job.title, 34)}"` });
    }
    // The plan, not just the act: the findings this dispatch rode on — the
    // scouts reported home, the assistant planned from it, the builders went out.
    const drivers = assistantModule?.intelLines ? assistantModule.intelLines(assistantState, Date.now(), { limit: 2 }) : [];
    assistantLog(
      "tick",
      `foreman handed out ${started.length} job(s): ${started.map((job) => assistantClip(job.title, 40)).join(", ")}${drivers.length ? ` — on: ${drivers.join(" · ")}` : ""}`,
    );
  }
  const free = Math.max(0, Math.max(1, autopilot.parallel) - autopilot.jobs.length);
  // Nothing handed out, nothing building, nothing held: the assistant grows
  // work instead of idling. The compactor folds loose ideas into plans (and
  // asks for work again when a plan is runnable); the ideas agent tops the
  // inbox up from recent chats when its last scan has gone cold. The role
  // queue keeps either from stacking while a pass is still out.
  if (autopilot.execute && !started.length && !autopilot.jobs.length && !autopilot.waiting) {
    // A route failure can leave runnable work without starting a child. Do
    // not bounce foreman -> compactor -> foreman forever on that same queue.
    const compactor = assistantState?.agents?.find((agent) => agent?.role === "compactor");
    if (!compactor?.lastRunAt || now - compactor.lastRunAt >= MINUTE_MS) assistantEnqueueRole("compactor", ASSISTANT_PRIORITY.demand);
    // The ideas pass re-runs when cold — but a quiet store stays quiet: if the
    // last scan saw no new material, give it a half-hour before asking again.
    // Re-scanning old chats to fill slots is not progress; with the ingestion
    // cursor a no-op pass is cheap, it is just not worth a roster entry.
    const ideasRow = (assistantState?.agents ?? []).find((agent) => agent?.role === "ideas");
    const ingest = assistantCache.ingest;
    const scanCold = !ideasRow?.lastRunAt || now - ideasRow.lastRunAt > 15 * 60000;
    const materialPlausible = !ingest || ingest.newMaterial !== false || now - (ingest.at ?? 0) > 30 * 60000;
    if (scanCold && materialPlausible) assistantEnqueueRole("ideas", ASSISTANT_PRIORITY.demand);
  }
  const text = !autopilot.execute
    ? "executor off · nothing handed out"
    : started.length
      ? `handed out ${started.length} · ${autopilot.jobs.length} building`
      : autopilot.jobs.length >= Math.max(1, autopilot.parallel)
        ? `all ${autopilot.jobs.length} slots busy`
        : autopilot.waiting
          ? `held · ${autopilot.waiting}`
          : `nothing to hand out · ${free} slot(s) free`;
  return { ok: true, text, intel: { handedOut: started.length, building: autopilot.jobs.length, slotsFree: free } };
}

// The thinker: the assistant itself. It reshapes the node tree, reads the
// activity log, answers the overseer, then starts work when the board is
// idle and a real pick is waiting. Proactive off is a no-op so the Explorer
// checkbox still holds this loop.
async function assistantThinkerJob(now, entry) {
  if (!assistantState.prefs?.proactive) return { ok: true, text: "proactive off · not thinking" };
  let organized = false;
  try {
    const store = await assistantReadStore();
    if (store) organized = await assistantOrganize(now, store);
  } catch (error) {
    assistantLog("error", `thinker tree pass failed: ${error.message}`);
  }
  const facts = await assistantMessageFacts(now, "");
  const lastThought =
    [...(assistantState.messages ?? [])].reverse().find((message) => message?.role === "thinking")?.text ?? assistantState.thinking?.text ?? "";
  let plan = { thinking: "looking at the log", act: null };
  try {
    plan = (await getAssistant()).thinkPlan({
      log: facts.log ?? assistantState.log,
      suggestions: facts.suggestions ?? [],
      executor: facts.executor,
      lastThought,
      overseer: assistantState.overseer,
      organization: assistantState.organization,
      now,
    }) ?? plan;
  } catch (error) {
    plan = { thinking: `could not plan: ${error.message}`, act: null };
  }
  const organization = assistantState.organization ?? {};
  const hopTargets = [
    ...(organization.stale ?? []).slice(0, 2).map(sessionTarget),
    ...(organization.active ?? []).slice(0, 2).map(sessionTarget),
    ASSISTANT_NODE,
  ];
  if (entry) await assistantVisit(entry, hopTargets, (target) => (target.kind === "assistant" ? assistantClip(plan.thinking, 80) : `checking "${assistantSessionTitle(target.id)}"`));
  assistantThink(plan.thinking, "thinker");
  if (plan.act?.kind === "dispatch") {
    const title = plan.act.title;
    assistantCommitThought(`${plan.thinking} — starting work on "${title}".`, "thinker");
    assistantAskForWork(`thinker: ${title}`);
    assistantLog("think", `starting work on "${assistantClip(title, 60)}" — ${assistantClip(plan.act.reason, 80)}`);
    return { ok: true, text: `starting "${assistantClip(title, 40)}"`, intel: { pick: title, organized }, finding: `starting work on "${assistantClip(title, 40)}"` };
  }
  if (organized) assistantLog("think", `tree reshaped · ${assistantClip(plan.thinking, 120)}`);
  return { ok: true, text: assistantClip(plan.thinking, 80), intel: { organized } };
}

// Ask the assistant to hand work out. Never calls the executor directly: the
// foreman is a roster job, so the dispatch is visible, queued behind the pool,
// and attributable to the assistant like every other decision it makes.
function assistantAskForWork(reason) {
  if (SMOKE || CAPTURE || CLI_MODE) return;
  // The reason rides into the Auto Builder panel, so the card says why the
  // assistant reached for work rather than leaving the executor's state
  // unexplained.
  autopilot.lastAsk = { reason: reason ?? null, at: Date.now() };
  assistantEnqueueRole("foreman", ASSISTANT_PRIORITY.demand);
  if (reason) logLine(`[assistant] foreman asked to hand out work (${reason})`);
}

// What the assistant is doing about the build queue, for the Auto Builder card.
// The panel is a view of the assistant's dispatch, not of executor internals:
// the foreman is what decides, so its line is what the card shows.
function foremanStatus() {
  const row = (assistantState?.agents ?? []).find((agent) => agent.role === "foreman") ?? null;
  return {
    status: row?.status ?? "idle",
    text: row?.text ?? null,
    lastRunAt: row?.lastRunAt ?? 0,
    runs: row?.runs ?? 0,
    reason: autopilot.lastAsk?.reason ?? null,
    askedAt: autopilot.lastAsk?.at ?? 0,
  };
}

async function assistantCompactorJob(now, entry) {
  const assistant = await getAssistant();
  // A task the executor is holding right now must survive the pass whatever
  // the stores say, so live claims are stamped on before compaction reads
  // them (the claim write may still be in flight for a job pushed seconds
  // ago). The stamp is view-only: it is stripped before anything persists.
  const heldTasks = new Set(autopilot.jobs.map((job) => job.taskId).filter(Boolean));
  const result = await mutateBoard((board) => {
    const stamped = board.tasks.map((task) => (task && heldTasks.has(task.id) ? { ...task, runId: task.runId ?? "live" } : task));
    const out = assistant.compact({ requests: board.requests, tasks: stamped, ideas: board.ideas, collisions: assistantCache.store?.collisions, now });
    // Strip the view-only stamp from tasks that were held but carry no real
    // run id (their claim write had not landed when the board was read).
    const tasks = heldTasks.size
      ? out.tasks.map((task) => {
          if (!task || task.runId !== "live" || !heldTasks.has(task.id)) return task;
          const { runId, ...rest } = task;
          return rest;
        })
      : out.tasks;
    return { requests: out.requests, tasks, ideas: out.ideas, report: out.report, runnable: out.report?.runnable ?? 0, plans: out.report?.plans ?? [] };
  });
  const { report } = result;
  // Every pass is a review, changed or not: the feed names what the backlog
  // looks like now and which pick the executor would take next.
  const next = report.reviewed?.next ? ` · next "${assistantClip(report.reviewed.next, 50)}"` : "";
  if (result.written?.length) assistantLog("tidy", `compacted the queue: ${report.text}${next}`);
  else assistantLog("tidy", `backlog reviewed · ${report.reviewed?.queued ?? 0} queued · ${report.text}${next}`);
  // A plan is the assistant turning a drift of notes into something buildable —
  // worth its own line rather than being buried in the compaction summary.
  for (const title of report.plans ?? []) assistantLog("brief", `folded ideas into a plan: ${assistantClip(title, 90)}`);
  // Hand the shaped queue to the foreman. The compactor decides what is worth
  // running; the foreman decides what actually starts, and reports it.
  if (report.runnable) assistantAskForWork("compacted");
  await assistantHop(entry, ROOT_NODE, { progress: 1, label: report.runnable ? `${report.runnable} runnable` : "queue clear" });
  const held = !autopilot.execute ? " · executor off" : report.runnable ? " · handed to the foreman" : "";
  return { ok: true, text: `${report.text}${held}${next}`, intel: { queued: report.reviewed?.queued ?? 0, runnable: report.runnable ?? 0, plans: (report.plans ?? []).length } };
}

async function assistantKeeperJob(now, entry) {
  const assistant = await getAssistant();
  const store = assistantCache.store;
  // Checkpoints are a fourth store the gateway does not carry: read them
  // BEFORE the mutation — transactional mutators are synchronous, so nothing
  // may be awaited inside.
  const checkpoints = await (await getEyes()).readJson(CHECKPOINTS_PATH, {});
  const result = await mutateBoard((board) => {
    const tidy = assistant.tidy({
      tasks: board.tasks,
      ideas: board.ideas,
      requests: board.requests,
      checkpoints,
      nodeFolders: assistantState.nodeFolders ?? {},
      sessions: store?.sessions ?? null,
      collisions: store?.collisions ?? null,
      audit: assistantCache.audit ?? null,
      duplicates: assistantCache.duplicateScan ?? null,
      now,
      prefs: assistantState.prefs,
    });
    return {
      tasks: tidy.tasks,
      ideas: tidy.ideas,
      requests: tidy.requests,
      checkpoints: tidy.checkpoints,
      nodeFolders: tidy.nodeFolders,
      report: tidy.report,
      changed: tidy.changed,
    };
  });
  // Checkpoints are a fourth store the gateway does not carry; they were read
  // and compared inside the lock, so their write is serialized with the rest.
  if (result.checkpoints !== undefined) {
    const eyes = await getEyes();
    const before = await eyes.readJson(CHECKPOINTS_PATH, {});
    if (JSON.stringify(before) !== JSON.stringify(result.checkpoints)) {
      await eyes.writeJson(CHECKPOINTS_PATH, result.checkpoints);
      send("eyes:checkpoints", result.checkpoints);
    }
  }
  // The node folders live in the assistant state, not a data file: a cleaned
  // folder is a state change, not a store write.
  if (!same(assistantState.nodeFolders ?? {}, result.nodeFolders ?? {})) assistantState.nodeFolders = result.nodeFolders ?? {};
  const report = result.report ?? {};
  assistantState.housekeeping = {
    lastAt: now,
    tasksArchived: report.tasksArchived ?? 0,
    ideasPruned: report.ideasPruned ?? 0,
    requestsCleared: report.requestsCleared ?? 0,
    checkpointsDropped: report.checkpointsDropped ?? 0,
    foldersCleaned: report.foldersCleaned ?? 0,
    lastText: report.text || (result.written?.length ? "tidied" : "nothing to tidy"),
  };
  assistantLog("tidy", assistantState.housekeeping.lastText);
  if (entry && result.written?.length) {
    const archived = (Array.isArray(result.tasks) ? result.tasks : []).filter((task) => task && task.id && task.status === "archived");
    const folded = (assistantState.organization?.counts?.folded ?? 0) > 0 && (report.checkpointsDropped || report.requestsCleared) ? [FOLDED_NODE] : [];
    const targets = [...archived.map((task) => taskTarget(task.id)), ...folded];
    const titles = new Map(archived.map((task) => [taskTarget(task.id).id, assistantClip(task.title || task.id, 40)]));
    await assistantVisit(entry, targets, (target) => (target.kind === "folded" ? "tidying finished sessions" : `archived "${titles.get(target.id)}"`));
  }
  return {
    ok: true,
    text: assistantState.housekeeping.lastText,
    intel: { archived: report.tasksArchived ?? 0, pruned: report.ideasPruned ?? 0, cleared: report.requestsCleared ?? 0, dropped: report.checkpointsDropped ?? 0, folders: report.foldersCleaned ?? 0 },
  };
}

// Structural equality for plain JSON state — the keeper's folder bookkeeping.
function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// briefer: the AI brief and its fix requests, hovering over the active
// sessions while the call runs; failures back off.
async function assistantBrieferJob(now, entry) {
  if (assistantCache.storeError) return { ok: true, text: "skipped · store unavailable" };
  const result = await assistantBriefCall(entry, "brief", null, null);
  if (!result.ok) {
    const minutes = assistantAiFailed(result.error);
    assistantSetProblems(["ai-offline"], [{ kind: "ai-offline", text: `AI offline: ${assistantState.ai.lastError}` }]);
    return { ok: false, error: `${result.error} (backing off ${minutes}m)` };
  }
  assistantAiOk();
  assistantSetProblems(["ai-offline"], []);
  const briefing = result.briefing;
  assistantLog("brief", `brief: ${String(briefing.summary ?? "").slice(0, 160)}`);
  const eyes = await getEyes();
  const queued = await queueRequests(eyes.requestsFromBriefing(briefing, await requestBaseline(eyes)));
  if (queued) assistantLog("brief", `${queued} fix request(s) queued from the briefing`);
  return { ok: true, text: String(briefing.summary ?? "briefed").slice(0, 80) };
}

// The build half of the roster. `improve` reads the app's own inventory and
// `grow` reads the archive; both answer with briefing.expand[], which is the
// only thing on the roster that turns into executable work. Queueing it here
// (and kicking the executor) is what closes the loop — before this, both modes
// only ever ran from the autopilot's own timer, off-roster and unattributed.
async function assistantBuildJob(role, mode, entry) {
  if (assistantCache.storeError) return { ok: true, text: "skipped · store unavailable" };
  const result = await assistantBriefCall(entry, mode, null, null);
  if (!result.ok) {
    const minutes = assistantAiFailed(result.error);
    assistantSetProblems(["ai-offline"], [{ kind: "ai-offline", text: `AI offline: ${assistantState.ai.lastError}` }]);
    return { ok: false, error: `${result.error} (backing off ${minutes}m)` };
  }
  assistantAiOk();
  assistantSetProblems(["ai-offline"], []);
  const briefing = result.briefing;
  const eyes = await getEyes();
  const queued = await queueRequests(requestsFromExpand(briefing, await requestBaseline(eyes), role));
  const summary = String(briefing.summary ?? mode).slice(0, 160);
  assistantLog("brief", `${mode}: ${summary}${queued ? ` · ${queued} request(s) queued` : " · nothing new to queue"}`);
  // A queued request should start now, not wait for the foreman's own cadence.
  if (queued) assistantAskForWork("a build pass queued work");
  return { ok: true, text: `${queued ? `queued ${queued}` : "nothing new"} · ${summary.slice(0, 60)}` };
}

const assistantImproverJob = (now, entry) => assistantBuildJob("improver", "improve", entry);
const assistantGrowerJob = (now, entry) => assistantBuildJob("grower", "grow", entry);
// The ideas scan is keyless-capable, so it runs on cadence either way.
const assistantIdeasJob = (now, entry) => scanIdeasInternal(assistantAiUsable(), entry);

// What the overseer sends the model: the module's digest plus the playbook it
// keeps between passes and a recent-log tail for texture.
function overseerFacts(now) {
  const overseer = assistantState.overseer ?? {};
  return {
    generatedAt: new Date(now).toISOString(),
    digest: assistantModule?.overseerDigest?.(assistantState, now) ?? {},
    playbook: { lessons: (overseer.lessons ?? []).slice(0, 24), directives: (overseer.directives ?? []).slice(-16) },
    recentLog: (assistantState.log ?? [])
      .filter((entry) => entry.kind !== "tick")
      .slice(-30)
      .map((entry) => `${entry.kind}: ${entry.text}`),
    recentReplies: (assistantState.messages ?? [])
      .filter((entry) => entry.role === "assistant")
      .slice(-6)
      .map((entry) => `${entry.via}: ${String(entry.text).slice(0, 120)}`),
    // Its own thread in full, and what every other agent on this machine has
    // been saying. The overseer reviews how the work is going; the conversations
    // are where that shows up first.
    thread: (assistantState.messages ?? []).slice(-24).map((entry) => `${entry.role}: ${String(entry.text).slice(0, 160)}`),
    chats: assistantCache.chats ?? [],
    // The sessions the tree calls stale, by title, so the review can name the
    // work that slipped rather than count it.
    staleSessions: (assistantState.organization?.stale ?? []).slice(0, 4).map((id) => ({ id, title: assistantSessionTitle(id) })),
    intel: assistantModule?.intelLines?.(assistantState, now, { limit: 8 }) ?? [],
  };
}

// The overseer's repair pass: before it reviews, it puts things right. This is
// what the Oversee button is for — unstick the board, restart what was
// interrupted, file resume work for the stale sessions, and start anything
// that can run. Every step is idempotent, so it is safe on the 15 min cadence
// as well as on the button. Returns the human `fixed` list, `directives` for
// the playbook, and how many rescues were queued.
//
// Operator controls are honored: a breaker park is infrastructure and re-arms
// (immediately on the button, at cooldown on the cadence), but an executor or
// auto-filer the operator switched off is their call to undo — the cadence
// repair never silently flips those back on (it used to, fighting the operator
// every 15 minutes). Only an explicit Oversee click counts as operator consent.
let overseerManualUntil = 0;
async function assistantOverseerRepair(now, { manual = false } = {}) {
  const fixed = [];
  const directives = [];
  let rescued = 0;
  const eyes = await getEyes();

  // 1. The service itself. A paused assistant fixes nothing.
  if (assistantState.status === "paused") {
    await assistantResume();
    fixed.push("resumed the assistant");
  }

  // 2. The executor. Two different "off" states:
  //    a tripped breaker (parkedUntil set) is recoverable infrastructure —
  //    clear it and re-arm; a deliberate switch-off (execute/enabled false
  //    with no park) is the operator's — only the button may undo it.
  if (autopilot.parkedUntil) {
    autopilot.execute = true;
    autopilot.parkedUntil = 0;
    autopilot.infraFailures = 0;
    autopilot.consecutiveFailures = 0;
    autopilot.lastError = null;
    pushAutopilotHistory("resumed", "overseer cleared the breaker park");
    fixed.push("cleared the executor's breaker park");
  } else if (!autopilot.execute) {
    if (manual) {
      autopilot.execute = true;
      pushAutopilotHistory("resumed", "overseer re-enabled the executor (manual)");
      fixed.push("re-enabled the auto builder");
    } else {
      directives.push({ kind: "finding", text: "executor off by operator choice — not auto-resumed" });
    }
  }
  if (!autopilot.enabled) {
    if (manual) {
      autopilot.enabled = true;
      fixed.push("re-enabled the auto-filer");
    } else {
      directives.push({ kind: "finding", text: "auto-filer off by operator choice — not auto-resumed" });
    }
  }

  // 3. Stuck claims. A task left "active" by a run that died with the app holds
  //    a slot's worth of work hostage until something reopens it. Through the
  //    board gateway, so the reopen cannot overwrite a settlement landing in
  //    the same instant.
  let boardTasks = [];
  {
    const liveRuns = new Set(autopilot.jobs.map((job) => job.id));
    const patch = await mutateBoard((board) => {
      let stuck = 0;
      const tasks = board.tasks.map((task) => {
        if (task?.status !== "active" || !task.runId || liveRuns.has(task.runId)) return task;
        stuck += 1;
        return {
          ...task,
          status: "open",
          runId: undefined,
          updatedAt: now,
          logs: [...(task.logs ?? []), { at: now, kind: "status", text: "overseer reopened a stuck task" }].slice(-40),
        };
      });
      let stranded = 0;
      const requests = board.requests.map((request) => {
        if (request?.status !== "running" || liveRuns.has(request.runId)) return request;
        stranded += 1;
        const next = { ...request };
        delete next.status;
        delete next.runId;
        delete next.runningAt;
        return next;
      });
      return { tasks, requests, stuck, stranded };
    });
    if (patch.stuck) fixed.push(`reopened ${patch.stuck} stuck task(s)`);
    if (patch.stranded) fixed.push(`re-queued ${patch.stranded} stranded request(s)`);
    boardTasks = patch.tasks ?? [];
  }

  // 4. Work the assistant itself was in the middle of when it last stopped.
  try {
    const pending = (await getAssistant()).pendingWork(assistantState, now);
    const restarted = assistantRestartWork(pending);
    if (restarted.length) fixed.push(`restarted ${restarted.length} interrupted job(s)`);
  } catch (error) {
    assistantLog("error", `overseer restart failed: ${error.message}`);
  }

  // 5. Stale sessions. Work left in progress and quiet past the stale horizon
  //    is the tree's silent rot — the organisation dims it and nothing picks
  //    it back up. Each one becomes a resume request the executor can run
  //    (the module caps the pass and skips sessions already rescued), a note
  //    lands in the session's folder, and the staliest one takes the
  //    assistant's focus when nothing else holds it — so the next reply and
  //    the composer's "Work on …" are grounded in the work that slipped.
  let rescues = [];
  try {
    const store = await assistantReadStore();
    rescues = assistantModule.staleRescues({
      sessions: store.sessions,
      todos: store.todos,
      policy: assistantModule.policyFromPrefs(assistantState.prefs),
      existing: await requestBaseline(eyes),
      tasks: boardTasks,
      now,
    });
    if (rescues.length) {
      const queued = await queueRequests(rescues.map((rescue) => ({ ...rescue.request, source: "overseer" })));
      rescued = queued;
      for (const rescue of rescues) {
        directives.push({ kind: "request", text: rescue.request.title });
        assistantNodeContext(
          { kind: "session", id: rescue.id },
          "agent",
          `overseer rescue: "${rescue.todo}" · quiet ${Math.round(rescue.quietMinutes / 60)}h · resume work filed`,
          "overseer"
        );
      }
      if (queued) fixed.push(`filed resume work for ${queued} stale session(s)`);
      if (!assistantState.focus) {
        await assistantFocus({ kind: "session", id: rescues[0].id, label: rescues[0].title });
        fixed.push(`focused the assistant on "${assistantClip(rescues[0].title, 40)}"`);
      }
    }
  } catch (error) {
    assistantLog("error", `overseer stale rescue failed: ${error.message}`);
  }

  // 6. Reshape the queue and hand out whatever can run. The compactor clears
  //    duplicates and elapsed backoffs; the foreman fills the free slots —
  //    including the rescue requests this pass just filed.
  assistantEnqueueRole("compactor", ASSISTANT_PRIORITY.demand);
  assistantEnqueueRole("auditor", ASSISTANT_PRIORITY.demand);
  assistantAskForWork("overseer repair");
  if (fixed.length) {
    assistantLog("overseer", `repair: ${fixed.join(", ")}`);
    emitAutopilot();
    await saveAssistant({ force: true });
  }
  return { fixed, directives, rescued, staleCount: rescues.length };
}

// overseer: the R&D layer above the assistant. The local review always runs;
// when the AI is usable an AI pass sharpens it, bounded pref tunes apply, and
// upgrade requests land in the inbox under source "overseer". It never does
// the assistant's jobs — it reviews them and improves the way they run.
async function assistantOverseerJob(now, entry) {
  const assistant = await getAssistant();
  // A manual Oversee click is operator consent to switch things back on; the
  // 15-min cadence is not (see assistantOverseerRepair).
  const manual = Date.now() < overseerManualUntil;
  if (manual) overseerManualUntil = 0;
  // Put things right first, then review what is left. A review of a board that
  // is stuck is just a description of the stuckness.
  const repair = await assistantOverseerRepair(now, { manual }).catch((error) => {
    assistantLog("error", `overseer repair failed: ${error.message}`);
    return { fixed: [], directives: [], rescued: 0, staleCount: 0 };
  });
  const repaired = repair.fixed;
  const digest = assistant.overseerDigest(assistantState, now);
  let review = assistant.overseerReview(digest, assistantState.overseer);
  let via = "local";
  // Smoke runs get the local pass only — never an AI call.
  if (!SMOKE && assistantAiUsable()) {
    const call = await assistantFetch(ASSISTANT_OVERSEER_SYSTEM, JSON.stringify(overseerFacts(now)).slice(0, 14000), 6000, { role: "heavy" });
    if (call.ok) {
      assistantAiOk();
      assistantSetProblems(["ai-offline"], []);
      try {
        const text = call.text;
        const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        review = {
          summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary : review.summary,
          health: ["good", "fair", "poor"].includes(parsed.health) ? parsed.health : review.health,
          score: Number.isFinite(Number(parsed.score)) ? Math.min(100, Math.max(0, Math.round(Number(parsed.score)))) : review.score,
          findings: [...review.findings, ...(Array.isArray(parsed.findings) ? parsed.findings : [])].slice(0, 8),
          lessons: [...(review.lessons ?? []), ...(Array.isArray(parsed.lessons) ? parsed.lessons : [])],
          upgrades: (Array.isArray(parsed.upgrades) ? parsed.upgrades : review.upgrades).slice(0, 6),
          prefs: parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : review.prefs,
        };
        via = "ai";
      } catch {
        assistantLog("overseer", "AI review unparseable · kept the local pass");
      }
    } else {
      assistantAiFailed(call.error);
      assistantSetProblems(["ai-offline"], [{ kind: "ai-offline", text: `AI offline: ${assistantState.ai.lastError}` }]);
    }
  }
  // The repair pass already did things worth remembering (rescue requests
  // filed); the tune and the queued upgrades below join them.
  const directives = [...repair.directives];
  const tuned = assistant.overseerTune(assistantState.prefs, review.prefs);
  if (tuned.applied.length) {
    await assistantSetPrefs(tuned.prefs);
    for (const change of tuned.applied) directives.push({ kind: "pref", text: `${change.key} ${change.from}→${change.to}` });
  }
  for (const key of tuned.rejected) directives.push({ kind: "finding", text: `tune rejected: ${key}` });
  try {
    const eyes = await getEyes();
    const additions = requestsFromExpand(
      {
        // The overseer proposes changes to Studio's own implementation. Its
        // maintenance requests must never be dispatched into another project.
        expand: (isStudioProject() ? review.upgrades ?? [] : []).map((upgrade) => ({
          title: `Overseer: ${String(upgrade?.title ?? "").slice(0, 60)}`,
          prompt: `A-Eyes overseer directive — ${String(upgrade?.prompt ?? upgrade?.title ?? "")}`,
        })),
      },
      await requestBaseline(eyes),
      "overseer",
    );
    const queued = await queueRequests(additions);
    for (const request of additions) directives.push({ kind: "request", text: request.title });
    if (queued) {
      assistantLog("overseer", `${queued} upgrade request(s) queued to the inbox`);
      // Overseer upgrades are work orders: start them now rather than wait for
      // the next autopilot tick. The kick is a no-op while the executor is
      // off, busy or the machine is leased.
      assistantAskForWork("upgrade requests queued");
    }
  } catch (error) {
    assistantLog("error", `overseer requests failed: ${error.message}`);
  }
  assistantState.overseer = assistant.overseerMerge(assistantState.overseer, review, now, { digest, via, directives });
  const critical = (review.findings ?? []).filter((finding) => finding?.severity === "critical");
  assistantSetProblems(["overseer"], critical.map((finding) => ({ kind: "overseer", text: `overseer: ${assistantClip(`${finding.title} — ${finding.detail}`, 160)}` })));
  assistantLog(
    "overseer",
    `review #${assistantState.overseer.reviews} (${via}) · score ${assistantState.overseer.score ?? "?"} · ${assistantState.overseer.health} · ${(review.findings ?? []).length} finding(s) · ${assistantState.overseer.lessons.length} lesson(s)`,
  );
  // The overseer talks to the assistant: findings become a spoken brief, the
  // assistant answers, and the owning scouts actually go fix them. A quiet
  // healthy review stays off the thread.
  const talk = assistant.overseerTalk?.(review, { repaired, digest }) ?? { say: "", reply: "", roles: [], dispatch: false, organize: false, resumeUnanswered: false };
  if (talk.say) {
    assistantCommitThought(talk.say, "overseer");
    if (talk.reply) assistantCommitThought(talk.reply, "thinker");
    const serious = (review.findings ?? []).some((finding) => finding?.severity === "warn" || finding?.severity === "critical") || repaired.length;
    if (serious) assistantAppendReply(`Overseer: ${talk.say} ${talk.reply}`.trim(), "local", "overseer");
    assistantLog("overseer", `told the assistant: ${assistantClip(talk.say, 140)}`);
  }
  for (const role of talk.roles ?? []) assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand);
  if (talk.organize) assistantEnqueueRole("watcher", ASSISTANT_PRIORITY.demand);
  if (talk.resumeUnanswered) {
    try {
      const pending = assistant.pendingWork(assistantState, now);
      assistantRestartWork({ unanswered: pending.unanswered ?? [], jobs: [], interruptedRoles: [] });
    } catch (error) {
      assistantLog("error", `overseer resume unanswered failed: ${error.message}`);
    }
  }
  if (talk.dispatch) assistantAskForWork("overseer: fix what I found");
  if (entry && talk.say) await assistantHop(entry, ASSISTANT_NODE, { label: assistantClip(talk.say, 80) });
  await saveAssistant();
  const summary = assistantState.overseer.lastSummary || "reviewed";
  return {
    ok: true,
    text: repaired.length ? `fixed ${repaired.join(", ")} · ${summary}` : summary,
    intel: { repaired: repaired.length, rescued: repair.rescued, stale: repair.staleCount, told: Boolean(talk.say), sent: (talk.roles ?? []).length },
    finding: talk.say || summary,
  };
}

// An assistant call that hovers over the sessions it briefs (or the one it
// explores) while the network round trip runs.
function assistantBriefCall(entry, mode, sessionId, payload) {
  const call = runAssistant(mode, sessionId, payload);
  if (!entry) return call;
  const targets = sessionId ? [sessionTarget(sessionId)] : entry.targets.filter((target) => target.kind === "session");
  if (!targets.length) return call;
  return assistantVisitWhile(entry, call, targets, (target) => `${ASSISTANT_ROLE_VERBS[entry.role] ?? mode} "${assistantSessionTitle(target.id)}"`);
}

// assistant:run work as a pool job: brief-like modes hover over sessions.
function assistantRunJob(mode, sessionId, payload) {
  const role = ASSISTANT_RUN_ROLES[mode] ?? "briefer";
  return (entry) => (role === "briefer" ? assistantBriefCall(entry, mode, sessionId, payload) : runAssistant(mode, sessionId, payload));
}

function assistantRunTargets(mode, sessionId) {
  if (sessionId) return [sessionTarget(sessionId)];
  return assistantRoleTargets(ASSISTANT_RUN_ROLES[mode] ?? "briefer");
}

const ASSISTANT_ROLE_JOBS = {
  watcher: assistantWatcherJob,
  machine: assistantMachineJob,
  auditor: assistantAuditorJob,
  keeper: assistantKeeperJob,
  compactor: assistantCompactorJob,
  foreman: assistantForemanJob,
  thinker: assistantThinkerJob,
  briefer: assistantBrieferJob,
  overseer: assistantOverseerJob,
  improver: assistantImproverJob,
  grower: assistantGrowerJob,
  ideas: assistantIdeasJob,
};

function assistantEnqueueRole(role, priority = ASSISTANT_PRIORITY.cadence) {
  const job = ASSISTANT_ROLE_JOBS[role];
  if (!job) return Promise.resolve(null);
  // The overseer counts against the AI pool when it plans to spend a call;
  // keyless it still runs its local review on a normal slot.
  const spendsCall = role === "briefer" || role === "improver" || role === "grower" || ((role === "overseer" || role === "ideas") && assistantAiUsable());
  return enqueue(role, (entry) => job(Date.now(), entry), { ai: spendsCall, priority });
}

// On-demand roles (control buttons, message actions): the job result, or
// null when it is still running after `wait` ms (it carries on; pushes tell).
function assistantRunRole(role, wait = 5000) {
  let timer = null;
  return Promise.race([
    assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand),
    new Promise((resolve) => (timer = setTimeout(() => resolve(null), wait))),
  ]).finally(() => clearTimeout(timer));
}

// UI-driven work (assistant:run, auditor:run, ideas:scan, reference:gather)
// runs through the pool so the roster shows it.
async function assistantDemand(role, job, { ai = false, key = role, work = null, targets = null } = {}) {
  await ensureAssistant();
  return enqueue(role, job, { ai, priority: ASSISTANT_PRIORITY.demand, key, work, targets });
}

// A work instruction sends the whole roster out, not just a reply: cadence
// roles run on demand, the AI roles join when the key is usable, and the
// reference gatherer takes the message text. The responder that asked is
// already running, so it is not in the list. Returns the done-line for the
// reply; enqueue() dedupes a role that is already going.
async function assistantDispatchAgents(text) {
  const ai = assistantAiUsable();
  const now = Date.now();
  const sent = [];
  const skipped = [];
  const fresh = [];
  // A role that ran inside the last minute still holds fresh results; firing it
  // again on every instruction was churn, not coverage. The reference gatherer
  // and the ideas scan always go — they work on this message's text.
  const isFresh = (role) => {
    const row = assistantState.agents?.find((entry) => entry.role === role);
    const lastRunAt = Number(row?.lastRunAt) || 0;
    return lastRunAt > 0 && now - lastRunAt < 60000;
  };
  for (const role of ["watcher", "machine", "auditor", "keeper", "compactor", "foreman", "thinker"]) {
    if (role === "thinker" && assistantState.prefs?.proactive === false) {
      skipped.push(role);
      continue;
    }
    if (isFresh(role)) {
      fresh.push(role);
      continue;
    }
    assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand);
    sent.push(role);
  }
  if (assistantBrieferAllowed()) {
    if (isFresh("briefer")) fresh.push("briefer");
    else {
      assistantEnqueueRole("briefer", ASSISTANT_PRIORITY.demand);
      sent.push("briefer");
    }
  } else skipped.push("briefer");
  if (ai) {
    for (const [role, kind] of [["improver", "improve"], ["grower", "grow"]]) {
      if (isFresh(role)) {
        fresh.push(role);
        continue;
      }
      enqueue(role, assistantRunJob(kind, null, null), {
        ai: true,
        priority: ASSISTANT_PRIORITY.demand,
        work: { kind, sessionId: null, payload: { args: null }, text: assistantClip(text, 60) },
      });
      sent.push(role);
    }
  } else skipped.push("improver", "grower");
  enqueue("ideas", (entry) => scanIdeasInternal(ai, entry), {
    ai,
    priority: ASSISTANT_PRIORITY.demand,
    key: `ideas:${ai}`,
    work: { kind: "ideas", payload: { ai }, text: ai ? "with AI" : "" },
  });
  sent.push("ideas");
  enqueue("reference", () => gatherReferences({ text }), {
    priority: ASSISTANT_PRIORITY.demand,
    work: { kind: "reference", payload: { text }, text: assistantClip(text, 40) },
  });
  sent.push("reference");
  return `sent the roster out: ${sent.join(", ") || "nobody — every role is fresh"}${skipped.length ? ` (${skipped.join(", ")} held — AI key or Proactive off)` : ""}${fresh.length ? ` · ${fresh.join(", ")} ran <1m ago` : ""}`;
}

function assistantBrieferAllowed() {
  return !SMOKE && Boolean(assistantState.prefs?.proactive) && assistantAiUsable();
}

// ---- the work journal: restart what was interrupted ----------------------------
function assistantReplyWork(user) {
  return { id: `job_reply_${user.id}`, kind: "responder", payload: { messageId: user.id }, text: assistantClip(user.text, 40) };
}

// A journal entry back into a runnable job, by kind.
function assistantWorkJob(entry) {
  const kind = entry.kind;
  const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : {};
  if (kind === "responder") {
    const user = assistantState.messages.find((message) => message.id === payload.messageId && message.role === "user");
    return user ? { role: "responder", ai: assistantAiUsable(), targets: [ASSISTANT_NODE], run: (job) => assistantRespond(user, job) } : null;
  }
  if (kind === "ideas") return { role: "ideas", ai: Boolean(payload.ai), targets: [ASSISTANT_NODE], run: (job) => scanIdeasInternal(Boolean(payload.ai), job) };
  if (kind === "reference") {
    return {
      role: "reference",
      ai: false,
      targets: entry.taskId ? [taskTarget(entry.taskId)] : [ASSISTANT_NODE],
      run: async () => {
        const result = await gatherReferences(payload);
        if (result.ok && entry.taskId) await attachTaskRefs(entry.taskId, result.references);
        return result;
      },
    };
  }
  if (kind === "analyzer") {
    return {
      role: "reference",
      ai: true,
      targets: [ASSISTANT_NODE],
      run: async () => {
        const result = await analyzerAi(payload.kind, payload.payload);
        if (result.ok) assistantLog("brief", `analyzer (${payload.kind ?? "?"}): ${assistantClip(result.result?.summary ?? "done", 160)}`);
        return result;
      },
    };
  }
  if (ASSISTANT_RUN_KINDS.has(kind)) {
    const sessionId = entry.sessionId ?? null;
    return { role: ASSISTANT_RUN_ROLES[kind] ?? "briefer", ai: true, targets: assistantRunTargets(kind, sessionId), run: assistantRunJob(kind, sessionId, payload.args ?? null) };
  }
  return null;
}

// Re-enqueues everything in a pendingWork() result that is not already in
// flight: journal entries (3 attempts per job id), unanswered messages, then
// the roles that were mid-run. Returns the human labels of what restarted.
function assistantRestartWork(pending) {
  const restarted = [];
  const roles = new Set();
  for (const job of pending?.jobs ?? []) {
    if (assistantInFlight(job.id)) continue;
    const label = assistantWorkLabel(job);
    const attempts = (job.attempts ?? 1) + 1;
    if (attempts > 3) {
      assistantJournal({ id: job.id, done: true });
      assistantLog("error", `gave up after 3 attempts: ${label}`);
      continue;
    }
    const runnable = assistantWorkJob(job);
    if (!runnable) {
      assistantJournal({ id: job.id, done: true });
      continue;
    }
    enqueue(runnable.role, runnable.run, {
      ai: runnable.ai,
      priority: job.kind === "responder" ? ASSISTANT_PRIORITY.responder : ASSISTANT_PRIORITY.demand,
      key: job.id,
      work: { ...job, attempts },
      targets: runnable.targets,
    });
    roles.add(runnable.role);
    restarted.push(label);
  }
  for (const message of pending?.unanswered ?? []) {
    const user = assistantState.messages.find((entry) => entry.id === message.id && entry.role === "user");
    if (!user) continue;
    const work = assistantReplyWork(user);
    if (assistantInFlight(work.id)) continue;
    enqueue("responder", (job) => assistantRespond(user, job), { ai: assistantAiUsable(), priority: ASSISTANT_PRIORITY.responder, key: work.id, work });
    restarted.push(assistantWorkLabel(work));
  }
  for (const role of pending?.interruptedRoles ?? []) {
    if (!ASSISTANT_ROLE_JOBS[role] || roles.has(role) || assistantInFlight(role)) continue;
    assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand);
    restarted.push(role);
  }
  return restarted;
}

// Boot: what the previous process left running comes back, with a control
// line and a thread message saying so. A paused service still answers.
async function assistantResumeWork() {
  const pending = assistantPending;
  assistantPending = null;
  if (!pending) return;
  const now = Date.now();
  let summary = "";
  try {
    summary = (await getAssistant()).resumeSummary(pending);
  } catch (error) {
    summary = `resume summary unavailable (${error.message})`;
  }
  if (assistantState.status === "paused") pending.interruptedRoles = [];
  const restarted = assistantRestartWork(pending);
  assistantLog("control", `resume: ${summary}`);
  if (restarted.length) {
    assistantState.resumed = { at: now, jobs: restarted, closedForMs: pending.closedForMs ?? 0 };
    assistantAppendReply(summary, "local", "status");
  } else {
    assistantState.resumed = null;
  }
  await saveAssistant({ force: true });
}

// Every tick: a journal entry older than 10 min is a `work-stale` problem;
// one that is no longer in the pool is retried once, then dropped.
// The assistant owns the executor too, not just its own roster: every tick it
// looks at the jobs actually building the app and says what is wrong with them.
// Without this the two halves ran blind to each other — the roster could report
// "idle, no problems" while the executor sat parked with a full queue.
function assistantSuperviseJobs(now) {
  if (SMOKE || CAPTURE || CLI_MODE) return;
  const problems = [];
  const jobs = autopilot.jobs ?? [];
  if (!autopilot.execute) {
    problems.push({
      kind: "executor",
      text: autopilot.parkedUntil
        ? `executor parked until ~${new Date(autopilot.parkedUntil).toLocaleTimeString()} · ${assistantClip(autopilot.lastError ?? "opencode is not starting", 90)}`
        : "executor is off · nothing will be built until it is switched back on",
    });
  }
  // A run past the hard kill timeout is wedged: the taskkill should have taken
  // it, so if it is still on the board the claim is stuck with it. Reap so a
  // dead child cannot occupy a slot forever. Ghosts (claimed, never spawned)
  // get a much shorter leash — a hung store write must not park the pool.
  const wedged = jobs.filter((job) => now - job.startedAt > ASSISTANT_JOB_WEDGED_MS);
  const ghosts = jobs.filter((job) => !job.pid && now - job.startedAt > 120000);
  const reaped = [];
  for (const job of [...wedged, ...ghosts]) {
    if (job.finished || reaped.includes(job)) continue;
    reaped.push(job);
    if (job.child?.pid) spawn("taskkill", ["/pid", String(job.child.pid), "/t", "/f"], { windowsHide: true });
    if (typeof job.reap === "function") job.reap(1, job.pid ? "wedged — kill timed out" : "spawn never started").catch?.(() => {});
  }
  if (wedged.length) {
    problems.push({
      kind: "executor",
      text: `${wedged.length} job(s) running over ${Math.round(ASSISTANT_JOB_WEDGED_MS / 60000)} min: ${wedged.slice(0, 2).map((job) => assistantClip(job.title, 40)).join(", ")}`,
    });
  }
  // Idle with work waiting is the failure this whole loop exists to avoid.
  // "machine busy" used to suppress the kick, so a dropped exclusive lease
  // left the executor parked until the foreman happened to get a pool slot.
  const lastAskAt = autopilot.lastAsk?.at ?? 0;
  const slotsFree = autopilot.execute && jobs.length < Math.max(1, autopilot.parallel) && autopilot.queueDepth > 0;
  if (slotsFree && now - lastAskAt > 30000 && (autopilot.waiting === "machine busy" || !jobs.length)) {
    const why = autopilot.waiting === "machine busy" ? "lease dropped, retrying" : "queue waiting with nothing running";
    problems.push({ kind: "executor", text: `${autopilot.queueDepth} queued with ${jobs.length} running — kicking the executor` });
    assistantAskForWork(why);
  }
  assistantSetProblems(["executor"], problems);
}

function assistantStaleWork(now) {
  const staleMs = assistantModule?.WORK_STALE_MS ?? ASSISTANT_WORK_STALE_MS;
  const stale = (entries) => (Array.isArray(entries) ? entries : []).filter((entry) => now - (Number(entry.startedAt) || 0) > staleMs);
  for (const entry of stale(assistantState.work)) {
    if (assistantInFlight(entry.id)) continue;
    const label = assistantWorkLabel(entry);
    if ((entry.attempts ?? 1) >= 2) {
      assistantJournal({ id: entry.id, done: true });
      assistantLog("error", `dropped stale job after a retry: ${label}`);
      continue;
    }
    const runnable = assistantWorkJob(entry);
    if (!runnable) {
      assistantJournal({ id: entry.id, done: true });
      continue;
    }
    assistantLog("control", `retrying stale job: ${label}`);
    enqueue(runnable.role, runnable.run, { ai: runnable.ai, priority: ASSISTANT_PRIORITY.demand, key: entry.id, work: { ...entry, attempts: (entry.attempts ?? 1) + 1 }, targets: runnable.targets });
  }
  const still = stale(assistantState.work);
  assistantSetProblems(
    ["work-stale"],
    still.length ? [{ kind: "work-stale", text: `${still.length} job(s) in flight for over 10 min: ${still.slice(0, 3).map((entry) => entry.text || entry.kind).join(", ")}` }] : []
  );
}

// A resumed reference gather lands on its task the way the renderer does.
async function attachTaskRefs(taskId, references) {
  const at = Date.now();
  const found = await mutateBoard((board) => {
    const task = board.tasks.find((item) => item && item.id === taskId);
    if (!task) return { ok: false };
    task.refs = [
      ...(task.refs ?? []),
      ...(references.files ?? []).slice(0, 6).map((file) => ({ kind: "file", title: file, detail: "work tree" })),
      ...(references.sessions ?? []).slice(0, 4).map((session) => ({ kind: "session", title: session.title, detail: session.id })),
      ...(references.web ?? []).slice(0, 4).map((hit) => ({ kind: "web", title: hit.title, detail: hit.url })),
    ].slice(-40);
    task.logs = [
      ...(task.logs ?? []),
      { at, kind: "reference", text: `gathered ${(references.code ?? []).length} code hits, ${(references.sessions ?? []).length} sessions, ${(references.chats ?? []).length} chats` },
    ];
    task.updatedAt = at;
    return { tasks: board.tasks, ok: true };
  });
  if (!found.ok) return false;
  // What the gather found is saved in the task's folder, not just its log.
  assistantNodeContext(taskTarget(taskId), "agent", `gathered ${(references.code ?? []).length} code hits · ${(references.sessions ?? []).length} sessions · ${(references.web ?? []).length} web`, "reference");
  return true;
}

function assistantSchedule(ms = assistantState?.intervalMs ?? 30000) {
  if (assistantTimer) clearTimeout(assistantTimer);
  assistantTimer = null;
  if (!assistantLoop || assistantState?.status !== "running") return;
  assistantTimer = setTimeout(() => {
    projects.run(projects.active(), () => assistantTick("timer")).catch((error) => {
      logLine(`[assistant] tick failed: ${error?.message ?? error}`);
      assistantSchedule();
    });
  }, ms);
}

// One cadence check: the roles that are due are queued and the tick returns
// at once; the pool does the work. Anything but the timer queues every
// cadence role.
async function assistantTick(reason = "timer") {
  if (projectSwitching) return { skipped: "switching project", queued: [] };
  if (assistantTickInFlight) {
    if (reason === "timer") return assistantTickInFlight;
    // Keep an explicit run-once request that arrives during a timer pass.
    // Repeated clicks share one follow-up rather than overlapping the tick.
    if (!assistantTickDemand) {
      assistantTickDemand = assistantTickInFlight.catch(() => {}).then(() => {
        assistantTickDemand = null;
        return assistantTick(reason);
      });
    }
    return assistantTickDemand;
  }
  assistantTickInFlight = (async () => {
    await ensureAssistant();
    if (reason === "timer" && assistantState.status !== "running") return { skipped: "paused", queued: [] };
    const now = Date.now();
    assistantState.tickCount += 1;
    assistantState.heartbeatAt = now;
    assistantState.ai.keyPresent = await assistantKeyPresent();
    const first = assistantState.tickCount === 1 || !assistantFirstTickResolve.done;
    let roles = [];
    try {
      roles = reason === "timer" ? (await getAssistant()).dueRoles(assistantState, now, assistantState.prefs) : [...ASSISTANT_CADENCE_ROLES];
    } catch (error) {
      assistantLog("error", `cadence check failed: ${error.message}`);
      roles = reason === "timer" ? [] : [...ASSISTANT_CADENCE_ROLES];
    }
    // A pause can land while loading settings or the cadence module. It wins
    // over a timer already in flight, just as it does over the next timer.
    if (reason === "timer" && assistantState.status !== "running") return { skipped: "paused", queued: [] };
    // The briefer and the two build roles wait for the proactive switch and a
    // usable key — they each spend a call. The overseer never does: it reviews on
    // every cadence around the clock, keyless if it has to, and pause is its only
    // off switch. (dueRoles already applies this on a timer tick; the filter is
    // what keeps a forced tick from firing them keyless.)
    roles = roles.filter((role) => !ASSISTANT_AI_ROLES.has(role) || assistantBrieferAllowed());
    for (const role of roles) assistantEnqueueRole(role, reason === "timer" ? ASSISTANT_PRIORITY.cadence : ASSISTANT_PRIORITY.demand);
    try {
      assistantStaleWork(now);
    } catch (error) {
      assistantLog("error", `stale check failed: ${error.message}`);
    }
    try {
      assistantSuperviseJobs(now);
    } catch (error) {
      assistantLog("error", `job supervision failed: ${error.message}`);
    }
    const hidden = !window || window.isDestroyed() || window.isMinimized() || !window.isVisible();
    assistantState.intervalMs = hidden ? 120000 : 30000;
    assistantState.nextTickAt = assistantLoop && assistantState.status === "running" ? now + assistantState.intervalMs : 0;
    const counts = assistantState.organization?.counts ?? {};
    const problems = assistantState.problems.length;
    // The tick line is the one thing a human reads to know the loop is alive, so
    // it carries what is actually being built, not just what the roster is doing.
    const building = (autopilot.jobs ?? []).length;
    const jobs = building
      ? `building ${building}: ${autopilot.jobs.slice(0, 2).map((job) => assistantClip(job.title, 30)).join(", ")}`
      : autopilot.execute
        ? `executor idle (${autopilot.queueDepth ?? 0} queued)`
        : "executor off";
    const text =
      `tick ${assistantState.tickCount} · ${counts.sessions ?? 0} sessions · ${counts.folded ?? 0} folded · ${problems ? `${problems} problem(s)` : "no problems"}` +
      ` · ${jobs} · ${roles.length ? `queued ${roles.join(", ")}` : "nothing due"}`;
    assistantLog("tick", text);
    await saveAssistant();
    if (assistantLoop) assistantSchedule();
    if (first) {
      assistantFirstTickResolve.done = true;
      assistantDrain().then(() => assistantFirstTickResolve());
    }
    return { tick: assistantState.tickCount, reason, text, queued: roles, problems: assistantState.problems.map((problem) => problem.kind) };
  })().finally(() => {
    assistantTickInFlight = null;
  });
  return assistantTickInFlight;
}

async function startAssistant() {
  await ensureAssistant();
  if (assistantLoop) return { ok: true, running: assistantState.status === "running" };
  assistantLoop = true;
  assistantState.startedAt = Date.now();
  applyKeepAwake();
  applyTray();
  await assistantResumeWork().catch((error) => assistantLog("error", `resume failed: ${error.message}`));
  if (assistantState.status === "paused") {
    assistantLog("control", "assistant service loaded paused · resume from the Explorer or the tray");
    await saveAssistant();
    return { ok: true, running: false };
  }
  assistantState.status = "running";
  assistantLog("control", "assistant service started");
  assistantSchedule(0);
  return { ok: true, running: true };
}

// Quit path: stop the chain, abandon the pool, drop the blocker, write the
// state synchronously with every agent idle.
function stopAssistant() {
  assistantLoop = false;
  if (assistantTimer) clearTimeout(assistantTimer);
  assistantTimer = null;
  applyKeepAwake();
  if (assistantState) {
    assistantClearQueue({ abandonRunning: true, text: "abandoned · quit" });
    assistantState.nextTickAt = 0;
    saveAssistantSync();
  }
  return { ok: true, running: false };
}

async function assistantPause() {
  if (assistantTimer) clearTimeout(assistantTimer);
  assistantTimer = null;
  assistantState.status = "paused";
  assistantState.nextTickAt = 0;
  assistantClearQueue({ text: "dropped · paused" });
  applyKeepAwake();
  assistantLog("control", "assistant paused");
  await saveAssistant({ force: true });
}

async function assistantResume() {
  assistantState.status = "running";
  applyKeepAwake();
  assistantLog("control", "assistant resumed");
  await saveAssistant({ force: true });
  if (assistantLoop) assistantSchedule(0);
}

// ---- 24/7: keep-awake, tray, close-to-tray -------------------------------
function applyKeepAwake() {
  if (SMOKE || CAPTURE || CLI_MODE) return;
  const wanted = assistantLoop && assistantState?.status === "running" && Boolean(assistantState.prefs?.keepAwake);
  try {
    if (wanted && assistantBlocker === null) assistantBlocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!wanted && assistantBlocker !== null) {
      powerSaveBlocker.stop(assistantBlocker);
      assistantBlocker = null;
    }
  } catch (error) {
    logLine(`[assistant] keep-awake unavailable: ${error.message}`);
  }
}

function showWindow() {
  if (!window || window.isDestroyed()) {
    createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

// No tray on a headless box is fine: the window then closes for real.
function applyTray() {
  if (SMOKE || CAPTURE || CLI_MODE) return;
  const wanted = Boolean(assistantState?.prefs?.background);
  try {
    if (wanted && !tray) {
      const image = nativeImage.createFromPath(path.join(STUDIO_ROOT, "assets", "icon-256.png"));
      if (image.isEmpty()) return;
      tray = new Tray(image.resize({ width: 16, height: 16 }));
      tray.on("click", showWindow);
      tray.on("double-click", showWindow);
      trayPaused = null;
      refreshTray();
    } else if (!wanted && tray) {
      tray.destroy();
      tray = null;
    }
  } catch (error) {
    logLine(`[assistant] tray unavailable: ${error.message}`);
  }
}

function refreshTray() {
  if (!tray || !assistantState) return;
  try {
    const paused = assistantState.status === "paused";
    const summary = assistantModule?.summarizeForTree?.(assistantState, Date.now());
    tray.setToolTip(`Mefi's Studio AI+ · ${summary?.sublabel ?? (paused ? "assistant paused" : "assistant running")}`);
    if (trayPaused === paused) return;
    trayPaused = paused;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Studio", click: showWindow },
        { label: paused ? "Resume assistant" : "Pause assistant", click: () => (paused ? assistantResume() : assistantPause()).catch(() => {}) },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ])
    );
  } catch {}
}

// ---- the thread -------------------------------------------------------------
// Facts for a reply: every source guarded, null when it is not available,
// shaped by the module's own builder.
async function assistantMessageFacts(now, query = "") {
  const raw = { sessions: null, todos: null, collisions: null, presence: null, uncommitted: null, tasks: null, ideas: null, machine: null, audit: null, briefing: null, update: null, now };
  // Independent sources run together. A slow audit or unavailable OpenCode
  // store must neither serialize all the other reads nor discard their facts.
  await Promise.allSettled([
    (async () => {
      const store = await assistantReadStore();
      Object.assign(raw, { sessions: store.sessions, todos: store.todos, collisions: store.collisions, presence: store.presence, uncommitted: store.uncommitted });
    })(),
    (async () => {
      const eyes = await getEyes();
      await Promise.allSettled([
        eyes.readJson(TASKS_PATH, []).then((rows) => { raw.tasks = rows.slice(0, 40); }),
        eyes.readJson(IDEAS_PATH, []).then((rows) => { raw.ideas = rows.slice(0, 40); }),
        eyes.readJson(REQUESTS_PATH, []).then((rows) => { raw.requests = rows.slice(0, 30); }),
        eyes.readJson(BRIEFING_PATH, null).then((briefing) => {
          if (briefing?.summary) raw.briefing = { summary: briefing.summary, generatedAt: briefing.generatedAt, alerts: (briefing.alerts ?? []).slice(0, 6) };
        }),
      ]);
    })(),
    (async () => {
      const status = assistantCache.machine ?? (await resourcePass({ kill: false, reason: "assistant", withProcesses: false }));
      raw.machine = {
        wait: Boolean(status.wait),
        lines: String(status.lines ?? "").split(" · ").filter(Boolean),
        running: (status.running ?? []).map((entry) => ({ pid: entry.pid, status: entry.status, ageMinutes: entry.ageMinutes })),
      };
    })(),
    (async () => {
      const audit = assistantCache.audit ?? (await (await getAuditor()).audit());
      raw.audit = { errors: audit.errors, warnings: audit.warnings, findings: audit.findings.slice(0, 12) };
    })(),
  ]);
  try {
    const status = updater?.status();
    if (status) raw.update = { phase: status.phase, reason: status.reason ?? null };
  } catch {}
  raw.work = assistantState.work ?? [];
  raw.resumed = assistantState.resumed ?? null;
  raw.focus = assistantState.focus ?? null;
  raw.log = (assistantState.log ?? []).filter((entry) => entry && entry.kind !== "tick").slice(-20);
  // The focused node's folder rides the facts, so a reply can quote what has
  // been saved on that node instead of answering from the thread alone.
  raw.nodeFolders = assistantState.nodeFolders ?? null;
  // What the executor is actually building: the roster answers "what are the
  // agents doing", and without this a reply could only ever see itself. The
  // feed's own log rides along — running jobs with their age, why dispatch is
  // held, the last dispatch history — so "read the auto builder log" is a
  // question the assistant can answer from facts instead of guessing.
  try {
    raw.executor = {
      enabled: autopilot.execute !== false,
      queued: Math.max(0, Math.floor(Number(autopilot.queueDepth) || 0)),
      waiting: autopilot.waiting ?? null,
      parallel: Math.max(1, Math.floor(Number(autopilot.parallel) || 1)),
      lastAsk: autopilot.lastAsk?.reason ?? null,
      running: (autopilot.jobs ?? []).map((job) => ({ title: job.title, minutes: Math.max(0, (now - (job.startedAt ?? now)) / 60000) })),
      history: (autopilot.history ?? []).slice(0, 8).map((entry) => ({ kind: entry.kind, text: entry.text, at: entry.at })),
    };
  } catch {}
  try {
    const assistant = await getAssistant();
    const facts = assistant.buildFacts({ ...raw, query, lessons: assistantState?.overseer?.lessons });
    // Ranked next-work picks ride the facts so a reply — local or AI — can
    // offer real work instead of summarising the board flatly.
    facts.suggestions = assistant.suggestWork({ ...facts, now });
    return facts;
  } catch {
    return raw;
  }
}

function assistantMessageId() {
  return `msg_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function assistantAppendReply(text, via, intent) {
  const entry = { id: assistantMessageId(), projectId: projects.current().id, at: Date.now(), role: "assistant", text, via, intent };
  assistantState.messages.push(entry);
  assistantTrim(assistantState.messages, assistantCaps().messages);
  assistantState.unread += 1;
  assistantLog("reply", `${via}: ${text.slice(0, 160)}`);
  return entry;
}

// The responder job: intent, facts, the local reply, its actions, then the
// AI when it is usable. Always ends in a reply; state is read live because
// roster events replace the state object underneath a running job.
async function assistantRespond(user, entry = null) {
  const text = user.text;
  const now = Date.now();
  let intent = "chat";
  let local = null;
  let reply = null;
  let via = "local";
  // The node this exchange is about, hoisted so the folder write after the
  // reply survives any failure above it.
  let folderTarget = null;
  const done = [];
  try {
    try {
      intent = (await getAssistant()).classifyIntent(text) || "chat";
    } catch {}
    user.intent = intent;
    assistantThink(`reading the log for "${assistantClip(text, 40)}"`, "responder");
    const facts = await assistantMessageFacts(now, text);
    const logHint = (facts?.log ?? []).slice(-2).map((entry) => entry.text).filter(Boolean).join("; ");
    assistantThink(logHint ? `log: ${assistantClip(logHint, 120)} · answering "${assistantClip(text, 36)}"` : `answering "${assistantClip(text, 40)}"`, "responder");
    const mention = entry ? assistantMentionTarget(text, facts) : null;
    const focusSubject = intent === "chat" || intent === "request" ? assistantFocusSubject(facts) : null;
    if (mention) {
      await assistantHop(entry, mention.target, { label: `replying at "${mention.title}"` });
    } else if (entry && focusSubject) {
      await assistantHop(entry, focusSubject.target, { label: `focused on "${focusSubject.title}"` });
    }
    // The node this exchange is about — the reply lands in its folder too.
    folderTarget = mention?.target ?? focusSubject?.target ?? null;
    try {
      local = (await getAssistant()).localReply({ text, intent, facts, state: assistantState, now });
    } catch (error) {
      local = { text: `I kept your message in the thread. (assistant logic unavailable: ${error.message})`, actions: [] };
    }
    for (const action of local?.actions ?? []) {
      try {
        if (action === "tidy") {
          const result = await assistantRunRole("keeper", 20000);
          done.push(result?.text ?? "tidy queued; it reports in the activity list");
        } else if (action === "fix") {
          const before = assistantState.fixes.length;
          const result = await assistantRunRole("auditor", 20000);
          const owners = (assistantModule?.rolesForProblems?.(assistantState) ?? []).filter((role) => role !== "auditor");
          for (const role of owners) assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand);
          if (owners.length) assistantAskForWork("fix the problems");
          const fresh = assistantState.fixes.slice(before);
          done.push(!result ? "fix pass queued; it reports in the activity list" : fresh.length ? `fixed: ${fresh.map((fix) => fix.text).join("; ")}` : "fix pass ran, nothing to fix");
        } else if (action === "organize") {
          const result = await assistantRunRole("watcher", 20000);
          const counts = assistantState.organization?.counts ?? {};
          done.push(!result ? "organize queued; it reports in the activity list" : `organized the tree: ${counts.active ?? 0} active, ${counts.stale ?? 0} stale, ${counts.folded ?? 0} folded`);
        } else if (action === "pause") {
          await assistantPause();
          done.push("paused");
        } else if (action === "resume") {
          await assistantResume();
          done.push("resumed");
        } else if (action === "queue-request") {
          // Chat work becomes a board task, not an inbox entry: the task is
          // the thing the owner sees, tracks and can reopen, and with the
          // cross ranking it is also what the executor takes next. A focused
          // node rides along as claim context, exactly as it did for requests.
          const focused = assistantFocusSubject(facts);
          // A resolved follow-up ("yes", "work on it") carries the real title
          // the reply settled on; anything else is filed as the user wrote it.
          const wanted = local?.request && typeof local.request === "object" ? local.request : null;
          const created = await assistantCreateTask({
            title: String(wanted?.title || text).slice(0, 60),
            prompt: String(wanted?.prompt || text).slice(0, 1400),
            source: "chat",
            focused,
            pin: Boolean(wanted?.pin),
          });
          // A chat instruction should start now, not wait for the foreman's
          // own cadence. The assistant still decides whether it can.
          if (created) assistantAskForWork("chat instruction");
          const executorNote = autopilot.execute
            ? "put it on the task board as the next piece of work and kicked the executor"
            : autopilot.parkedUntil
              ? `put it on the task board (executor parked until ~${new Date(autopilot.parkedUntil).toLocaleTimeString()}: ${assistantClip(autopilot.lastError ?? "opencode is not starting", 90)})`
              : "put it on the task board (the autopilot executor is off)";
          done.push(created ? executorNote : "it is already on the task board");
        } else if (action === "compact") {
          // "Clean up the builder / the queue": one compactor pass on demand —
          // duplicates collapse, board-absorbed asks fold away, the cap cuts
          // the lowest-worth entries, and a runnable pick hands straight back
          // to the foreman.
          const result = await assistantRunRole("compactor", 20000);
          done.push(result ? `compactor: ${assistantClip(result.text ?? "compacted", 100)}` : "compaction queued; it reports in the activity list");
        } else if (action === "agents") {
          done.push(await assistantDispatchAgents(text));
        } else if (action === "overseer") {
          const result = await assistantRunRole("overseer", 30000);
          done.push(result ? `overseer: ${assistantClip(result.text ?? "reviewed", 100)}` : "overseer review queued; it reports in the activity list");
        } else if (action === "resume-work") {
          const pending = (await getAssistant()).pendingWork(assistantState, Date.now(), { exclude: [user.id, user.text] });
          const restarted = assistantRestartWork(pending);
          done.push(restarted.length ? `restarted ${restarted.length} job(s): ${restarted.slice(0, 4).join(", ")}` : "nothing interrupted to restart");
        }
      } catch (error) {
        assistantLog("error", `${action} failed: ${error.message}`);
        done.push(`${action} failed: ${error.message}`);
      }
    }
    if (assistantAiUsable()) {
      const thread = assistantState.messages
        .filter((entry) => entry.id !== user.id && entry.role !== "thinking")
        .slice(-12)
        .map(({ role, text: line }) => ({ role, text: line }));
      // The message and what was done lead the payload; facts fill the rest of
      // the budget. A fat store must never push the user's own text off the
      // end — a sliced tail was how replies lost the question entirely.
      const payload = { message: text, did: done, thread, facts };
      let body = JSON.stringify(payload);
      if (body.length > 14000) {
        // Shrink, never drop: nulled sections used to come back as "no
        // briefing or ideas data in the facts". Everything stays, just shorter.
        payload.facts = {
          ...(facts ?? {}),
          sessions: (facts?.sessions ?? []).slice(0, 6),
          collisions: (facts?.collisions ?? []).slice(0, 6),
          presence: (facts?.presence ?? []).slice(0, 8),
          tasks: (facts?.tasks ?? []).slice(0, 12),
          requests: (facts?.requests ?? []).slice(0, 8),
          ideas: (facts?.ideas ?? []).slice(0, 8),
          briefing: facts?.briefing ? { summary: facts.briefing.summary, generatedAt: facts.briefing.generatedAt } : null,
          log: (facts?.log ?? []).slice(0, 8),
        };
        body = JSON.stringify(payload);
      }
      if (body.length > 14000) {
        payload.thread = thread.slice(-4);
        body = JSON.stringify(payload);
      }
      let timer = null;
      const call = await Promise.race([
        assistantFetch(ASSISTANT_CHAT_SYSTEM, body.slice(0, 14000), 1200),
        new Promise((resolve) => (timer = setTimeout(() => resolve({ ok: false, error: "no reply within 45 s" }), 45000))),
      ]);
      clearTimeout(timer);
      if (call.ok && call.text.trim()) {
        const reasoning = String(call.reasoning ?? "").trim();
        if (reasoning) assistantCommitThought(assistantClip(reasoning, 400), "responder");
        reply = call.text.trim().slice(0, 1500);
        via = "ai";
        assistantAiOk();
      } else {
        assistantAiFailed(call.error ?? "empty reply");
      }
    }
  } catch (error) {
    assistantLog("error", `message handling failed: ${error.message}`);
  }
  if (!reply) {
    reply = local?.text || "I kept your message in the thread.";
  }
  // The action confirmations ride along on every reply, AI or local: an AI
  // text that only summarizes the facts must not hide that work happened.
  if (done.length) reply = `${reply} Done: ${done.join("; ")}.`;
  const replyEntry = assistantAppendReply(reply, via, intent);
  // The exchange is saved on the node it was about: the folder is what the
  // next reply — and the next agent on this node — reads back.
  if (folderTarget) assistantNodeContext(folderTarget, "chat", `asked "${assistantClip(text, 80)}" — ${assistantClip(reply, 90)}`, "responder");
  await saveAssistant({ force: true });
  return replyEntry;
}

// A message is appended and pushed at once, then answered by a responder job
// that starts immediately whatever else is running. It always gets a reply.
async function assistantMessage(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "empty" };
  await ensureAssistant();
  const user = { id: assistantMessageId(), projectId: projects.current().id, at: Date.now(), role: "user", text: text.slice(0, 2000), via: "local", intent: "chat" };
  assistantState.messages.push(user);
  assistantTrim(assistantState.messages, assistantCaps().messages);
  assistantLog("message", user.text.slice(0, 160));
  const work = assistantReplyWork(user);
  let reply = await enqueue("responder", (entry) => assistantRespond(user, entry), { ai: assistantAiUsable(), priority: ASSISTANT_PRIORITY.responder, key: work.id, work });
  if (!reply || reply.role !== "assistant") {
    reply = assistantAppendReply(`I kept your message in the thread. (${reply?.error ?? "the reply did not finish"})`, "local", user.intent ?? "chat");
    await saveAssistant({ force: true });
  }
  return { ok: true, reply, state: assistantState };
}

// The card's Work on it: the node becomes the assistant's NEXT piece of work.
// It is focused (follow-ups and the gold ring follow), pinned to the front of
// the queue — a board task is pinned in place, a session or todo is queued as
// a pinned chat request — the ask is threaded so the chat log shows it, and
// the foreman runs at demand priority so a free slot takes it on the spot.
// No responder pass in between: this path does the work directly.
async function assistantWorkOn(raw) {
  const kind = String(raw?.kind ?? "");
  const id = String(raw?.id ?? "");
  if (!id || !["session", "todo", "task"].includes(kind)) return { ok: false, error: "bad target" };
  await ensureAssistant();
  const label = String(raw?.label ?? id).slice(0, 80);
  await assistantFocus({ kind, id, label });
  const now = Date.now();
  const ask = `Work on "${label}"`;
  const lastUser = [...(assistantState.messages ?? [])].reverse().find((entry) => entry?.role === "user");
  const repeat = Boolean(lastUser && lastUser.text === ask && now - (lastUser.at ?? 0) < 8000);
  if (!repeat) {
    const user = { id: assistantMessageId(), at: now, role: "user", text: ask, via: "local", intent: "request" };
    assistantState.messages.push(user);
    assistantTrim(assistantState.messages, assistantCaps().messages);
  }
  let where = "";
  if (kind === "task") {
    const pinned = await mutateBoard((board) => {
      const task = board.tasks.find((item) => item && item.id === id);
      if (!task) return { hit: false };
      const wasFinished = task.status === "done" || task.status === "archived";
      // An explicit ask re-arms a task the autopilot had cooled down or given
      // up on — the same fresh start a manual reopen gets.
      if (wasFinished) {
        delete task.doneAt;
        delete task.runFailures;
        delete task.nextRunAt;
        delete task.lastRunError;
        delete task.verification;
        task.status = "open";
      }
      task.pin = true;
      task.pinAt = now;
      task.updatedAt = now;
      task.logs = [...(task.logs ?? []), { at: now, kind: "status", text: wasFinished ? "reopened — work on it" : "pinned — work on it" }].slice(-40);
      return { tasks: board.tasks, hit: true, wasFinished };
    });
    if (pinned.hit) {
      where = pinned.wasFinished ? `reopened and pinned "${label}" to the front of the board` : `pinned "${label}" to the front of the board`;
    } else {
      where = await assistantQueuePinnedWork({ kind, id, label, now });
    }
  } else {
    where = await assistantQueuePinnedWork({ kind, id, label, now });
  }
  assistantNodeContext({ kind, id }, "note", `work on it — ${where}`, "assistant");
  assistantLog("control", `work on it: ${kind} "${label}" — ${where}`);
  if (!repeat) assistantAppendReply(`${where}; the executor takes it before everything else.`, "local", "request");
  assistantAskForWork("work on it");
  await saveAssistant({ force: true });
  return { ok: true, where, state: assistantState };
}

// The pinned-request half of Work on it: session and todo nodes (and a task
// node that has left the board) queue a chat request that carries the node as
// its target — the blue work ring reads that target, and housekeeping claims
// the session while the job runs. A repeat click re-pins the standing entry
// instead of stacking a second one.
async function assistantQueuePinnedWork({ kind, id, label, now }) {
  const queued = await queueRequests([
    {
      title: `Work on "${label}"`.slice(0, 60),
      prompt: `Work on "${label}". Queued with Work on it — the user pointed at ${kind} (id: ${id}).`,
      source: "chat",
      at: now,
      pin: true,
      pinAt: now,
      target: { kind, id },
      ...(kind === "session" ? { sessions: [id] } : kind === "todo" && id.includes(":") ? { sessions: [id.split(":")[0]] } : {}),
    },
  ]);
  if (queued) return `queued "${label}" at the front of the inbox`;
  const repinned = await mutateBoard((board) => {
    const hit = board.requests.find(
      (item) => item && item.source === "chat" && item.status !== "running" && item.target?.kind === kind && item.target?.id === id,
    );
    if (!hit) return { hit: false };
    hit.pin = true;
    hit.pinAt = now;
    return { requests: board.requests, hit: true };
  });
  if (repinned.hit) return `kept "${label}" at the front of the inbox`;
  return `"${label}" is already queued`;
}

// A tree click hands the assistant a node to work on: the focus is persisted,
// logged, and pushed so the rail can ring the node and the responder can walk
// to it on the next message. Null clears it (clicking a selected node again).
async function assistantFocus(target) {
  await ensureAssistant();
  if (!target?.kind || !target?.id) {
    if (!assistantState.focus) return { ok: true, state: assistantState };
    assistantState.focus = null;
    assistantLog("focus", "focus cleared", { focus: null });
    await saveAssistant({ force: true });
    return { ok: true, state: assistantState };
  }
  const focus = {
    kind: String(target.kind).slice(0, 24),
    id: String(target.id).slice(0, 200),
    label: String(target.label ?? target.id).slice(0, 120),
    at: Date.now(),
  };
  const current = assistantState.focus;
  if (current && current.kind === focus.kind && current.id === focus.id) {
    assistantState.focus = { ...current, label: focus.label, at: focus.at };
    await saveAssistant({ force: true });
    return { ok: true, state: assistantState };
  }
  assistantState.focus = focus;
  assistantLog("focus", `focused on ${focus.kind} "${assistantClip(focus.label, 40)}"`, { focus });
  await saveAssistant({ force: true });
  return { ok: true, state: assistantState };
}

async function assistantControl(action) {
  await ensureAssistant();
  try {
    if (action === "pause") await assistantPause();
    else if (action === "resume") await assistantResume();
    else if (action === "tick") await assistantTick("control");
    else if (action === "tidy") await assistantRunRole("keeper");
    else if (action === "fix") {
      await assistantRunRole("auditor");
      for (const role of (assistantModule?.rolesForProblems?.(assistantState) ?? []).filter((name) => name !== "auditor")) {
        assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand);
      }
      assistantAskForWork("fix control");
    }
    else if (action === "organize") await assistantRunRole("watcher");
    else if (action === "overseer") {
      overseerManualUntil = Date.now() + 120000;
      await assistantRunRole("overseer", 30000);
    }
    else if (action === "seen") {
      assistantState.unread = 0;
      await saveAssistant();
    } else if (action === "clear-thread") {
      assistantState.messages = [];
      assistantState.unread = 0;
      assistantLog("control", "thread cleared");
      await saveAssistant({ force: true });
    } else return { ok: false, error: `unknown action: ${action}`, state: assistantState };
    return { ok: true, state: assistantState };
  } catch (error) {
    assistantLog("error", `${action} failed: ${error.message}`);
    return { ok: false, error: String(error.message ?? error), state: assistantState };
  }
}

async function assistantSetPrefs(patch = {}) {
  await ensureAssistant();
  const clean = {};
  for (const key of ["proactive", "keepAwake", "background"]) if (typeof patch?.[key] === "boolean") clean[key] = patch[key];
  for (const key of ["foldAfterMinutes", "staleAfterHours", "tidyDoneAfterHours"]) {
    const value = Number(patch?.[key]);
    if (patch?.[key] !== undefined && Number.isFinite(value) && value > 0) clean[key] = value;
  }
  if (patch?.parallel !== undefined) clean.parallel = assistantParallel(patch.parallel, EXECUTOR_PARALLEL_MAX, assistantState.prefs.parallel ?? 8);
  if (patch?.aiParallel !== undefined) clean.aiParallel = assistantParallel(patch.aiParallel, AI_PARALLEL_MAX, assistantState.prefs.aiParallel ?? 4);
  if (Object.keys(clean).length) {
    assistantState.prefs = { ...assistantState.prefs, ...clean };
    const settings = await readSettings();
    settings.assistant = { ...(settings.assistant ?? {}), ...clean };
    await writeSettings(settings);
    applyKeepAwake();
    applyTray();
    assistantPoolCounts();
    assistantPump();
    assistantLog("control", `prefs: ${Object.entries(clean).map(([key, value]) => `${key}=${value}`).join(", ")}`);
    await saveAssistant({ force: true });
  }
  return { ok: true, state: assistantState };
}

// CLI: one tick, the pool drained, then the state summary. The timer-driven
// pass this used to be is the service loop itself now.
async function proactivePass() {
  await ensureAssistant();
  const tick = await assistantTick("cli");
  await assistantDrain();
  const state = assistantState;
  return {
    ok: true,
    tick,
    state: {
      status: state.status,
      tickCount: state.tickCount,
      problems: state.problems,
      organization: { counts: state.organization?.counts ?? {} },
      pool: state.pool,
      agents: (state.agents ?? []).filter((row) => row.runs).map((row) => ({ role: row.role, status: row.status, runs: row.runs, lastMs: row.lastMs, text: row.text })),
      work: state.work ?? [],
      resumed: state.resumed ?? null,
    },
  };
}

let proactiveTimer = null;

// A-Eyes autopilot: the timer evaluates the session store, queues requests,
// promotes them into tasks, and executes the queue headlessly via
// `opencode run`. Everything it does is pushed to the renderer over
// "assistant:status" so a panel can watch it work.
const autopilot = {
  enabled: true, // evaluate on a timer (was "proactive")
  execute: true, // run queued requests via opencode
  minutes: 5,
  parallel: 8, // how many `opencode run` jobs may be in flight at once (1–12); boot replaces this with the machine default
  jobs: [], // in-flight runs: {id, kind, title, source, ref, child, pid, startedAt, sessionId, taskId, finished}
  consecutiveFailures: 0,
  infraFailures: 0, // spawn errors / instant exits — 3 in a row parks the executor for a cooldown
  parkedUntil: 0, // breaker trip timestamp + cooldown; the executor re-arms itself when it passes
  lastPassAt: 0,
  lastAdded: 0,
  lastError: null,
  tasksManaged: 0, // open+closed a-eyes task count, refreshed each pass
  queueDepth: 0, // waiting requests + open board tasks, refreshed on dispatch
  waiting: null, // why the executor is parked (e.g. "machine busy"); null while a job can spawn
  waitingEmittedAt: 0, // throttle marker for re-emitting an unchanged waiting reason
  lastAsk: null, // why the assistant last reached for work (shown on the card)
  history: [], // last 8: {at, kind, text}
};
let autopilotTicks = 0;
let autopilotJobSeq = 0;
// How long the executor sits out after three straight runs where opencode
// never really started. The breaker is a pause, not a power-off: the next
// pass after the cooldown tries again.
const AUTOPILOT_PARK_MS = 10 * 60 * 1000;

function pushAutopilotHistory(kind, text) {
  autopilot.history.unshift({ at: Date.now(), kind, text });
  autopilot.history = autopilot.history.slice(0, 8);
}

// The executor's durable work log: one JSON line per run start and finish, so
// a record of what the auto builder did survives the app — the studio log and
// autopilot history are memory-only, and "what happened to my work" used to
// die with the window. Logging never breaks a run: a failed append is dropped.
async function executorLog(record) {
  try {
    await mkdir(path.dirname(projectDataPath(EXECUTOR_LOG_PATH)), { recursive: true });
    await appendFile(projectDataPath(EXECUTOR_LOG_PATH), `${JSON.stringify({ at: Date.now(), ...record })}\n`, "utf8");
  } catch {}
}

// ---- the Policy Lab's observation-only recorder (build brief PR1) ---------------
// Appends decisions, attempts and verification outcomes to the experience
// store. PASSIVE by construction: the record is computed AFTER the pick (it
// never feeds it), enabling recording changes no selected work and emits no
// jobs, and every failure here is swallowed — the lab must never be able to
// wedge ordinary dispatch.
let policyRecordSeq = 0;
function policyRecord(kind, payload) {
  if (SMOKE || CAPTURE || CLI_MODE) return;
  getExperienceModule()
    .then((experience) => experience.appendEvent(EXPERIENCE_PATH, { schema: 1, at: Date.now(), seq: (policyRecordSeq += 1), kind, ...payload }))
    .catch(() => {});
}

// The active-policy pointer is OFFLINE state until controlled activation ships
// (build brief PR3): dispatch always runs the baseline (see compareWork), and
// this identity only annotates the record — every attempt stays attributable
// to the policy version that was named when it started. An unreadable or
// invalid pointer falls back to the baseline identity, never to a guess.
let activePolicyIdentityCache = null;
let activePolicyNoticeShown = false;
async function resolveActivePolicyIdentity() {
  if (activePolicyIdentityCache) return activePolicyIdentityCache;
  const policy = await getPolicyModule().catch(() => null);
  let identity = null;
  try {
    identity = policy?.policyIdentity?.(JSON.parse(await readFile(ACTIVE_POLICY_PATH, "utf8")).active);
  } catch {}
  if (!identity) identity = policy ? policy.policyIdentity(policy.BASELINE_POLICY) : { id: "baseline", version: 1, kind: "baseline", hash: null, config: {} };
  activePolicyIdentityCache = identity;
  if (identity.kind !== "baseline" && !activePolicyNoticeShown) {
    activePolicyNoticeShown = true;
    logLine(`[policy-lab] active-policy pointer names "${identity.id}" but live activation is disabled — dispatch stays on the baseline`);
  }
  return identity;
}

// What the policy layer may see about one ranked candidate: bounded, masked,
// no outcomes. The band and operator locks come from the SAME frozen rules
// the live ranking uses (workPriority), so a candidate policy can never learn
// around the operator's worth order.
function policyActionDescriptor(policyModule, candidate, index, nowMs) {
  const item = candidate?.ref ?? {};
  const title = String(item.title ?? "");
  const lastRunError = String(item.lastRunError ?? "");
  return {
    id: policyModule?.workActionId ? policyModule.workActionId(candidate.kind, item) : `${candidate.kind}_${index}`,
    intentKey: workTitleKey(title) || null,
    kind: candidate.kind === "request" ? "request" : "task",
    title: title.slice(0, 90),
    band: workPriority(item),
    operatorLocked: Boolean(item.pin),
    age: Math.max(0, nowMs - (item.at ?? item.createdAt ?? item.updatedAt ?? 0)),
    runFailures: Number(item.runFailures ?? 0) || 0,
    // Category is what the record can prove: a reopened verification names
    // itself; anything else with failures on it is the task's own miss. An
    // infra failure parks the executor, not the item, so it never shows here.
    failureCategory: lastRunError.startsWith("verification:") ? "verification" : (item.runFailures ?? 0) > 0 ? "task" : null,
    depth: Number(item.depth ?? 0) || 0,
    order: index,
    ...(item.pinAt ? { pinAt: item.pinAt } : {}),
  };
}

// A run killed mid-snapshot leaves git's index.lock in the shared snapshot
// worktree, and every later run then fails or hangs on the stale lock. A
// lock older than this is stale by definition: with the executor serialized
// (EXECUTOR_PARALLEL_CAP) no studio-owned git operation holds one this long,
// and a live lock from the user's own interactive sessions is never touched.
const SNAPSHOT_LOCK_STALE_MS = 10 * 60 * 1000;
async function sweepSnapshotLocks() {
  const root = path.join(os.homedir(), ".local", "share", "opencode", "snapshot");
  let top;
  try {
    top = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  for (const first of top) {
    if (!first.isDirectory()) continue;
    let second;
    try {
      second = await readdir(path.join(root, first.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of second) {
      if (!entry.isDirectory()) continue;
      const lockPath = path.join(root, first.name, second.name, "index.lock");
      try {
        const info = await stat(lockPath);
        if (now - info.mtimeMs > SNAPSHOT_LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          logLine(`[autopilot] removed stale snapshot lock (${Math.round((now - info.mtimeMs) / 60000)}m old)`);
        }
      } catch {}
    }
  }
}

function autopilotStatus() {
  return {
    enabled: autopilot.enabled,
    execute: autopilot.execute,
    minutes: autopilot.minutes,
    parallel: autopilot.parallel,
    // Pids stay main-side: the renderer gets labels, not handles. `progress`
    // is the run's own todo fraction (null until the session reports todos),
    // what the builder meters on the constellation show.
    running: autopilot.jobs.map((entry) => ({
      title: entry.title,
      projectId: entry.projectId,
      projectPath: entry.projectPath,
      source: entry.source,
      startedAt: entry.startedAt,
      sessionId: entry.sessionId ?? null,
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
      ...(typeof entry.progress === "number" ? { progress: entry.progress } : {}),
    })),
    lastPassAt: autopilot.lastPassAt,
    lastAdded: autopilot.lastAdded,
    lastError: autopilot.lastError,
    tasksManaged: autopilot.tasksManaged,
    queueDepth: autopilot.queueDepth,
    waiting: autopilot.waiting,
    consecutiveFailures: autopilot.consecutiveFailures,
    infraFailures: autopilot.infraFailures,
    // The assistant owns dispatch, so the card reads its foreman, not the queue.
    foreman: foremanStatus(),
    parkedUntil: autopilot.parkedUntil,
    history: autopilot.history,
  };
}

function emitAutopilot() {
  send("assistant:status", autopilotStatus());
}

// A transition always emits so the feed flips between waiting/running promptly;
// the same reason re-asserts at most once a minute so a renderer that mounted
// late still picks it up without a send storm.
function setAutopilotWaiting(reason) {
  const changed = autopilot.waiting !== reason;
  autopilot.waiting = reason;
  if (changed || Date.now() - autopilot.waitingEmittedAt > 60000) {
    autopilot.waitingEmittedAt = Date.now();
    emitAutopilot();
  }
}

// Waiting inbox entries plus open board tasks. Chat work now lands on the
// board, so a depth that only counted requests reported "idle, 0 queued"
// while the executor had real work sitting in front of it.
function queuedWorkCount(requests, tasks) {
  const waiting = (Array.isArray(requests) ? requests : []).filter((item) => item && item.status !== "running" && item.status !== "verifying").length;
  const open = (Array.isArray(tasks) ? tasks : []).filter((task) => task && task.status === "open").length;
  return waiting + open;
}

function workTitleKey(value) {
  return assistantModule?.compactKey
    ? assistantModule.compactKey(value)
    : String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// The shared theme keys from the pure module — the SAME keys the compactor
// and the promotion pass use, so "the same work" means one thing everywhere.
function workPlanTheme(value) {
  try {
    return assistantModule?.planThemeKey?.(value) ?? null;
  } catch {
    return null;
  }
}

function workFixTheme(item) {
  try {
    return assistantModule?.fixThemeKey?.(item) ?? null;
  } catch {
    return null;
  }
}

function isFixWork(item) {
  return item?.source === "fix" || Boolean(item?.alertTitle) || /^fix\s*:/i.test(String(item?.title ?? ""));
}

function liveFixShape(job) {
  return {
    title: job?.title,
    prompt: job?.ref?.prompt,
    alertTitle: job?.ref?.alertTitle,
    problemFamily: job?.ref?.problemFamily,
    problemFiles: job?.ref?.problemFiles,
    source: job?.source,
  };
}

function conflictsWithLiveFix(eyes, item) {
  if (!item || !isFixWork(item) || typeof eyes?.sameFixProblem !== "function") return false;
  return autopilot.jobs.some((job) => eyes.sameFixProblem(item, liveFixShape(job)));
}

async function refreshAutopilotQueue(eyes = null) {
  try {
    const reader = eyes ?? (await getEyes());
    const requests = await reader.readJson(REQUESTS_PATH, []);
    const tasks = await reader.readJson(TASKS_PATH, []);
    autopilot.queueDepth = queuedWorkCount(requests, tasks);
  } catch {
    // Keep the last known depth; a store read blip must not zero the kick.
  }
}

// The queue drains on dispatch, so a fix that already ran is invisible to a
// later pass. Fold recently dispatched requests back into the dedup baseline
// (they carry the sessions they claimed, see executeNextRequest) so one stall
// is diagnosed once — for the autopilot pass and for the assistant service's
// own briefer/watcher/auditor jobs alike.
async function requestBaseline(eyes) {
  const existing = await eyes.readJson(REQUESTS_PATH, []);
  const history = await eyes.readJson(ASSISTANT_HISTORY_PATH, []);
  const dispatched = history.filter((item) => (item?.finishedAt ?? 0) > Date.now() - 48 * 3600 * 1000);
  const known = [...existing, ...dispatched];
  return known;
}

async function autopilotProactivePass({ useAi = true } = {}) {
  const eyes = await getEyes();
  let briefing = null;
  let aiError = null;
  if (useAi) {
    const result = await runAssistant("brief", null);
    if (result.ok) briefing = result.briefing;
    else aiError = result.error;
  }
  const auditor = await getAuditor();
  let auditResult = null;
  try {
    auditResult = await auditor.audit();
  } catch (error) {
    logLine(`[auditor] failed: ${error.message}`);
  }
  const known = await requestBaseline(eyes);
  const store = {
    collisions: eyes.collisions({ root: projectRoot() }),
    presence: eyes.filePresence({ root: projectRoot() }),
  };
  const additions = [
    ...eyes.requestsFromCollisions(store.collisions, known),
    ...(await duplicateDeclarationRequests(eyes, store, known)),
    ...(briefing ? eyes.requestsFromBriefing(briefing, known) : []),
    ...(auditResult ? auditor.auditRequests(auditResult, known) : []),
  ];
  const queued = await queueRequests(additions);
  logLine(
    `[assistant] proactive: ${queued} new request(s)` +
      (aiError ? ` (AI unavailable: ${aiError})` : "") +
      (auditResult ? ` · audit ${auditResult.errors} error(s)/${auditResult.warnings} warning(s)` : "")
  );
  return {
    ok: true,
    added: queued,
    aiError,
    collisions: store.collisions.length,
    audit: auditResult ? { errors: auditResult.errors, warnings: auditResult.warnings } : null,
    briefing,
  };
}

// briefing.expand[] items become real queue entries here (eyes.mjs stays
// pure); each is deduped by title against the queue as it stands.
function requestsFromExpand(briefing, existing = [], source = "grow") {
  const requests = [];
  for (const item of briefing?.expand ?? []) {
    if (!item?.title) continue;
    const title = String(item.title).slice(0, 90);
    if (existing.some((request) => request.title === title)) continue;
    if (requests.some((request) => request.title === title)) continue;
    requests.push({ title, prompt: String(item.prompt ?? item.title), source, at: Date.now() });
  }
  return requests;
}

// Every queued request also becomes a task card (same field set the
// renderer's addTask writes) so the work is visible outside the inbox.
// Capped at 3 auto-added tasks per pass. Promotion is idempotent by identity,
// not wording: a request whose title key, plan theme, or scoped fix theme is
// already represented on the board (live OR done — a done card still means
// the work happened) never mints a second card. Reads and writes go through
// the board gateway, so a promotion racing the compactor lands as a delta on
// the compactor's own output instead of being overwritten by it (or vice
// versa).
async function promoteRequestsToTasks() {
  const patch = await mutateBoard((board, eyes) => {
    const requests = board.requests;
    if (!requests.length) return { added: 0 };
    let added = 0;
    const candidates = requests
      .filter((request) => request?.title && request.status !== "running" && request.status !== "verifying")
      .sort((a, b) => taskPriority(b) - taskPriority(a) || (a.at ?? 0) - (b.at ?? 0));
    const created = [];
    for (const request of candidates) {
      if (added >= 3) break;
      const title = String(request.title).slice(0, 90);
      // Worth first, oldest inside a band — the same pick the executor makes. A
      // request a run is already holding stays off the board: promoting it would
      // build the same job twice, once as the request and again as the task.
      if (board.tasks.some((task) => task && task.title === title && task.status === "active" && task.runId)) continue;
      const key = workTitleKey(title);
      if (key && board.tasks.some((task) => task && task.status !== "archived" && workTitleKey(task.title) === key)) continue;
      const theme = workPlanTheme(title);
      if (theme && board.tasks.some((task) => task && task.status !== "archived" && workPlanTheme(task.title) === theme)) continue;
      if (isFixWork(request)) {
        const fixTheme = workFixTheme(request);
        if (fixTheme && board.tasks.some((task) => task && task.status !== "archived" && workFixTheme(task) === fixTheme)) continue;
        if (typeof eyes?.sameFixProblem === "function" && board.tasks.some((task) => task && task.status !== "archived" && eyes.sameFixProblem(request, task))) continue;
      }
      created.push(request);
      added += 1;
    }
    if (!created.length) return { added: 0 };
    const now = Date.now();
    const rows = created.map((request) => {
      const title = String(request.title).slice(0, 90);
      return {
        id: "task_" + crypto.randomBytes(8).toString("hex"),
        title,
        prompt: request.prompt ?? "",
        status: "open",
        color: "#e6c98d",
        source: request.source === "collision" ? "collision" : "a-eyes",
        createdAt: now,
        updatedAt: now,
        logs: [{ at: now, kind: "status", text: "task created by A-Eyes" }],
        ideas: [],
        refs: [],
        // A handed-on request keeps its place in the chain through promotion, so
        // the depth guard still bites once it runs as a task.
        ...(Number(request.depth) ? { depth: Number(request.depth) } : {}),
        ...(request.parent ? { parent: String(request.parent).slice(0, 90) } : {}),
        ...(request.file ? { file: request.file } : {}),
        ...(Array.isArray(request.files) && request.files.length ? { files: request.files.filter((file) => typeof file === "string" && file) } : {}),
        ...(request.owner ? { owner: String(request.owner) } : {}),
        ...(Array.isArray(request.sessions) && request.sessions.length ? { sessions: request.sessions.filter((id) => typeof id === "string" && id) } : {}),
        ...(request.alertTitle ? { alertTitle: String(request.alertTitle).slice(0, 90) } : {}),
        ...(request.problemFamily ? { problemFamily: String(request.problemFamily).slice(0, 32) } : {}),
        ...(Array.isArray(request.problemFiles) && request.problemFiles.length ? { problemFiles: request.problemFiles.slice(0, 8) } : {}),
      };
    });
    board.tasks = [...rows.reverse(), ...board.tasks];
    return { tasks: board.tasks, added };
  });
  return patch.added ?? 0;
}

// Chat work lands straight on the task board. "Add …" in the thread, the
// Command composer or the board's own box is the assistant being told to work,
// so the task is created here — worth band "chat", above every auto-filed
// request — instead of waiting for the promotion pass. Returns null when a
// live task with the same title already stands, so a retried send cannot
// double the work. Titles match on the shared compact key, so "Fix the
// auditor" and "fix the auditor." are the same ask; a card mid-verification
// counts as live too. Written through the board gateway.
async function assistantCreateTask({ title, prompt = "", source = "chat", focused = null, pin = false } = {}) {
  const cleanTitle = String(title ?? "").trim().slice(0, 90);
  if (!cleanTitle) return null;
  const key = workTitleKey(cleanTitle);
  const now = Date.now();
  const task = {
    projectId: projects.current().id,
    projectPath: projectRoot(),
    id: "task_" + crypto.randomBytes(8).toString("hex"),
    title: cleanTitle,
    prompt: String(prompt ?? cleanTitle).slice(0, 1400),
    status: "open",
    color: "#e6c98d",
    source,
    createdAt: now,
    updatedAt: now,
    logs: [{ at: now, kind: "status", text: "task created by the assistant" }],
    ideas: [],
    refs: [],
  };
  if (pin) {
    task.pin = true;
    task.pinAt = now;
  }
  const target = focused?.target ?? null;
  if (target?.kind && target?.id) {
    task.target = { kind: target.kind, id: target.id };
    const claim = target.kind === "session" ? target.id : target.kind === "todo" ? target.id.split(":")[0] : null;
    if (claim) task.sessions = [claim];
    task.prompt = `${task.prompt}\n\nThe user pointed the assistant at ${target.kind} "${focused.title ?? target.id}" (id: ${target.id}) while asking for this.`.slice(0, 1400);
  }
  const created = await mutateBoard((board) => {
    if (board.tasks.some((task) => task && task.status !== "done" && task.status !== "archived" && workTitleKey(task.title) === key)) return { created: null };
    board.tasks = [task, ...board.tasks];
    return { tasks: board.tasks, created: task };
  });
  if (!created.created) return null;
  // Explicit work can enter straight through the task composer or chat,
  // bypassing the request inbox. Classify that admission once, without
  // delaying its task card or dispatch; request promotion has its own intake.
  jevShadowIntake([{ ...created.created, kind: "task", at: created.created.createdAt }]);
  await refreshAutopilotQueue();
  if (target?.kind && target?.id) assistantNodeContext(target, "note", `queued "${cleanTitle}" on the task board`, "assistant");
  assistantLog("control", `chat work on the board: "${cleanTitle}"${pin ? " (pinned next)" : ""}`);
  return task;
}

// The `opencode run` child registers a session in the OpenCode store a moment
// after spawn. Poll for it (3s x 20) so finish() can file a checkpoint against
// the real session id instead of only the assistant history — and so the
// wedged-start watchdog can tell a slow store from a stuck run.
function watchRunSession(eyes, startedAt, entry) {
  let tries = 0;
  const poll = () => {
    tries += 1;
    // A job that left the in-flight list already closed.
    if (!autopilot.jobs.includes(entry)) return;
    try {
      // A session already claimed by a sibling job is out: two runs starting
      // within the same seconds must not both grab the first new session.
      // Of the unclaimed candidates, the OLDEST session born after this run
      // spawned is the run's own — spawns are staggered, so a later
      // sibling's session must never be claimed by an earlier one.
      const session = eyes
        .listSessions({ limit: 24 })
        .filter((item) => item.timeCreated >= startedAt - 10000 && !autopilot.jobs.some((other) => other !== entry && other.sessionId === item.id))
        .sort((a, b) => a.timeCreated - b.timeCreated)[0];
      if (session) {
        entry.sessionId = session.id;
        emitAutopilot();
        return;
      }
    } catch {}
    if (tries < 20 && autopilot.jobs.includes(entry)) setTimeout(poll, 3000).unref?.();
  };
  setTimeout(poll, 3000).unref?.();
}

// A run's own todo list is the honest fraction done — the same done/total the
// session's node shows. Once the spawned session registers, poll it slowly and
// carry the fraction on the job; the renderer's builder meters read this. A
// push only goes out when the fraction moves, so the poll costs one cheap
// read and stays quiet the rest of the time.
function watchJobProgress(eyes, entry) {
  const poll = () => {
    if (!autopilot.jobs.includes(entry) || entry.finished) return;
    if (entry.sessionId) {
      try {
        const todos = eyes.listTodos({ sessionId: entry.sessionId });
        const done = todos.filter((todo) => todo && todo.status === "completed").length;
        const next = todos.length ? done / todos.length : null;
        if (next !== entry.progress) {
          entry.progress = next;
          emitAutopilot();
        }
      } catch {}
    }
    setTimeout(poll, EXECUTOR_PROGRESS_POLL_MS).unref?.();
  };
  setTimeout(poll, EXECUTOR_PROGRESS_POLL_MS).unref?.();
}

// Fills every free executor slot with a headless `opencode run` session in
// the repo root: pending requests first, then the oldest open tasks (a-eyes
// first). Each pick is claimed in the store before the next slot fills — a
// request flips to "running", a task to "active" — so two jobs never take the
// same work. Output streams to the studio log; on exit a request leaves the
// queue for data/assistant-history.json, while a task flips to done (exit 0)
// or back to open. Two failures in a row pause the executor until re-enabled.
let executorFillInFlight = null;
async function executeNextRequest() {
  if (SMOKE || CAPTURE || CLI_MODE) return;
  if (executorFillInFlight) return executorFillInFlight;
  executorFillInFlight = (async () => {
    if (!autopilot.execute) {
      // A tripped breaker re-arms once its cooldown passes — the park is a
      // pause, not a power-off, so one bad stretch can't stop the executor
      // for good.
      if (autopilot.parkedUntil && Date.now() >= autopilot.parkedUntil) {
        autopilot.execute = true;
        autopilot.parkedUntil = 0;
        autopilot.infraFailures = 0;
        autopilot.consecutiveFailures = 0;
        autopilot.lastError = null;
        pushAutopilotHistory("resumed", "executor resumed after cooldown");
        logLine("[autopilot] executor re-armed after the park cooldown");
      } else {
        setAutopilotWaiting(null);
        return;
      }
    }
    let stop = "empty";
    let lostTries = 0;
    while (autopilot.jobs.length < Math.max(1, autopilot.parallel)) {
      // Sequential awaits: each pick re-reads the store with the previous job's
      // claim already on it, so parallel slots can never grab the same work.
      try {
        stop = await spawnNextJob();
      } catch (error) {
        logLine(`[autopilot] spawn failed: ${error.message}`);
        stop = "empty";
        break;
      }
      // A lost claim means another fill (or a live session) took that title
      // between the pick and the lock. Try the next piece instead of parking.
      if (stop === "lost") {
        if (++lostTries > Math.max(1, autopilot.parallel) + 2) break;
        continue;
      }
      if (stop !== "spawned") break;
      // Pace the starts: a full pool launched in one sweep stampedes the
      // shared OpenCode store and its snapshot repo, and every run in the
      // sweep can wedge before it prints a line. A few seconds between
      // spawns costs nothing and keeps startup collisions from compounding.
      if (autopilot.execute && autopilot.jobs.length < Math.max(1, autopilot.parallel)) {
        await new Promise((resolve) => setTimeout(resolve, EXECUTOR_STAGGER_MS));
      }
    }
    setAutopilotWaiting(
      stop === "busy" ? "machine busy" : stop === "cooldown" ? "tasks cooling down" : stop === "deferred" ? "waiting on live editors" : null
    );
  })().finally(() => {
    executorFillInFlight = null;
  });
  return executorFillInFlight;
}

// Work the assistant does on its own plumbing: useful, but it must never crowd
// out the app itself. The overseer files these by the dozen once it warms up.
const SELF_MAINTENANCE = /^(?:overseer|assistant|a-eyes)\s*:/i;
// The live ranking lives behind the Policy Lab's BASELINE policy
// (scripts/policy.mjs) — extracted, not changed: the baseline is a line-for-
// line port of the ordering below, and tests pin the parity. The inline
// copies stay as the load-failure fallback so dispatch survives the lab's
// modules being absent, broken or mid-live-update. A candidate policy can
// never reach this path until controlled activation ships: the pointer file
// only annotates records (resolveActivePolicyIdentity), dispatch stays
// baseline. Operator rules (pins, bands, the pause) are inputs the policy
// layer cannot move.
let policyBaselinePort = null;
function warmPolicyBaseline(mod) {
  if (!mod?.baselineTaskPriority || !mod?.baselineWorkPriority || !mod?.baselineCompareWork) return;
  policyBaselinePort = { taskPriority: mod.baselineTaskPriority, workPriority: mod.baselineWorkPriority, compare: mod.baselineCompareWork };
}
function fallbackTaskPriority(task) {
  const title = String(task?.title ?? "");
  if (SELF_MAINTENANCE.test(title)) return 0; // the assistant's own upkeep, last
  if (task?.source === "chat") return 4; // the user asked for this by hand
  if (String(task?.id ?? "").startsWith("task_plan_")) return 3; // a folded plan is real, scoped work
  if (task?.source === "a-eyes" || task?.source === "collision") return 2; // briefed/audited/collision work
  return 1;
}
function fallbackWorkPriority(item) {
  if (item?.pin) return 5;
  return fallbackTaskPriority(item);
}
function fallbackCompareWork(a, b) {
  const ap = fallbackWorkPriority(a);
  const bp = fallbackWorkPriority(b);
  if (ap !== bp) return bp - ap;
  if (a?.pin && b?.pin) return (b.pinAt ?? 0) - (a.pinAt ?? 0);
  const aAge = a?.at ?? a?.createdAt ?? a?.updatedAt ?? 0;
  const bAge = b?.at ?? b?.createdAt ?? b?.updatedAt ?? 0;
  return aAge - bAge;
}
// What the executor should reach for first. Higher wins; ties fall back to the
// caller's age ordering, so within a band the oldest task still goes first.
function taskPriority(task) {
  return policyBaselinePort ? policyBaselinePort.taskPriority(task) : fallbackTaskPriority(task);
}
// The worth of one piece of queued work, inbox request or board task alike.
// A pin is the user's explicit "this one next" (Work on it): it outranks every
// band, and among pins the newest click wins — the last thing you pointed at
// is what should start when a slot frees.
function workPriority(item) {
  return policyBaselinePort ? policyBaselinePort.workPriority(item) : fallbackWorkPriority(item);
}
// One ordering across the inbox and the board: worth first, then — inside a
// band — the oldest piece of work, so auto-filed upkeep cannot starve. Pins
// break their tie by recency instead.
function compareWork(a, b) {
  return policyBaselinePort ? policyBaselinePort.compare(a, b) : fallbackCompareWork(a, b);
}

// One spawn. Returns "spawned", "busy" (machine leased — park the dispatcher),
// "lost" (the lease claim lost the race — try the next piece), "cooldown",
// or "empty" (no pending work).
let boardWriteChain = Promise.resolve();
function withBoardLock(fn) {
  projectBoardWrites += 1;
  const project = projects.current();
  const scoped = () => projects.run(project, fn);
  const run = boardWriteChain.then(scoped, scoped).finally(() => { projectBoardWrites -= 1; });
  boardWriteChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

// The board mutation gateway. Every writer of requests/tasks/ideas goes
// through here: the lock serializes read-modify-write across all three files
// at once, and a writer only ever persists arrays it produced from a read
// INSIDE the lock. This is the fix for the stale-snapshot writes that kept
// resurrecting promoted work — a compactor pass (or an idea scan returning
// from its AI call) can no longer overwrite a promotion, claim, or pin that
// landed while it was out. The mutator returns a patch: only keys whose
// array is a different object than the one read are written and broadcast.
//
// Mutators must be SYNCHRONOUS on both paths. The store transaction wraps
// DatabaseSync calls, so an async mutator's returned patch is a Promise whose
// replacement arrays are silently dropped while its in-place edits commit —
// partial application — and a rejected async mutator is not the rollback the
// caller meant. Gather awaited inputs before the gateway.
const isThenable = (value) => Boolean(value) && typeof value.then === "function";
async function mutateBoard(mutator) {
  const eyes = await getEyes();
  return withBoardLock(async () => {
    // Preferred path: the SQLite authority. boardMutate runs the read, the
    // mutator (on a working copy), the change detection, and the writes inside
    // one BEGIN IMMEDIATE transaction, then refreshes the JSON views. Its
    // return shape matches the file fallback below; the renderer broadcasts
    // ride the gateway either way. The gateway AWAITS it: the result is a
    // Promise, and broadcasting off `result.written` before resolution sent
    // no mutation events at all.
    if (typeof eyes.boardMutate === "function" && eyes.boardEnabled()) {
      const result = await eyes.boardMutate((board) => mutator(board, eyes));
      const events = { requests: "eyes:requests", tasks: "eyes:tasks", ideas: "eyes:ideas" };
      for (const key of result.written ?? []) send(events[key], result[key]);
      return result;
    }
    // File fallback (database unavailable): same contract, plain files. The
    // mutator works on a deep copy so in-place row edits (pins, refs, status
    // changes) compare against a pristine snapshot instead of erasing
    // themselves.
    const [requests, tasks, ideas] = await Promise.all([eyes.readJson(REQUESTS_PATH, []), eyes.readJson(TASKS_PATH, []), eyes.readJson(IDEAS_PATH, [])]);
    const original = {
      requests: Array.isArray(requests) ? requests : [],
      tasks: Array.isArray(tasks) ? tasks : [],
      ideas: Array.isArray(ideas) ? ideas : [],
    };
    const board = structuredClone(original);
    const returned = mutator(board, eyes);
    if (isThenable(returned)) {
      throw new TypeError("mutateBoard: mutator must be synchronous — await inputs before the gateway, not inside it");
    }
    const patch = returned ?? {};
    const result = {
      requests: patch.requests ?? board.requests,
      tasks: patch.tasks ?? board.tasks,
      ideas: patch.ideas ?? board.ideas,
    };
    const written = [];
    for (const [file, key, event] of [
      [REQUESTS_PATH, "requests", "eyes:requests"],
      [TASKS_PATH, "tasks", "eyes:tasks"],
      [IDEAS_PATH, "ideas", "eyes:ideas"],
    ]) {
      // Identical content (a mutator that changed nothing) is not a change:
      // skip the write and broadcast.
      if (JSON.stringify(result[key]) === JSON.stringify(original[key])) continue;
      await eyes.writeJson(file, result[key]);
      send(event, result[key]);
      written.push(key);
    }
    return { ...patch, requests: result.requests, tasks: result.tasks, ideas: result.ideas, written };
  });
}

// Drop a claim this run still owns. Used when an exclusive lease wins the
// race after we wrote the claim but before the child started — finish()
// would count that as a failed run. The read-check-write rides one
// transactional gateway mutation: a separate read, JS check, and
// whole-collection write is exactly the window a second process claims in.
async function releaseExecutorClaim(eyes, job, entry) {
  if (!eyes || !job || !entry) return;
  await mutateBoard((board) => {
    if (job.kind === "request") {
      let changed = false;
      const remaining = board.requests.map((item) => {
        if (!item || item.runId !== entry.id) return item;
        changed = true;
        const next = { ...item };
        delete next.status;
        delete next.runId;
        delete next.runningAt;
        delete next.lease;
        return next;
      });
      if (!changed) return null;
      board.requests = remaining;
      return {};
    }
    if (!job.ref?.id) return null;
    const task = board.tasks.find((item) => item && item.id === job.ref.id);
    if (!task || task.runId !== entry.id) return null;
    task.status = "open";
    delete task.runId;
    delete task.lease;
    task.updatedAt = Date.now();
    return {};
  });
}

async function spawnNextJob() {
  const runProject = projects.current();
  const runRoot = runProject.path;
  // The pause can land mid-fill (an infra breaker tripped on a sibling job),
  // so re-check instead of trusting the dispatcher's one-time gate.
  if (projectSwitching || !autopilot.execute) return "empty";
  let leases = null;
  try {
    const machine = await getMachine();
    leases = await machine.leaseStatus({ repoRoot: projectRoot() });
  } catch {}
  // An exclusive lease means another agent owns the machine; stay parked.
  // leaseStatus only — a full resourcePass wrote two JSON files per slot fill
  // and a OneDrive lock on those files hung dispatch with claimed work and no child.
  if (leases?.exclusive) return "busy";
  // Resolve the CLI/provider before claiming work. A missing `runRoute` used
  // to throw after the claim landed, leaving the task `active` with no child.
  const runRoute = await executorRunEnv().catch((error) => ({ error: error.message }));
  if (!runRoute || runRoute.error) {
    const reason = runRoute?.error || "executor route unavailable";
    autopilot.lastError = reason;
    logLine(`[autopilot] executor route failed: ${reason}`);
    return "empty";
  }
  const eyes = await getEyes();
  // Warm the frozen baseline port (policy.mjs is the extracted home of the
  // ranking; the inline fallback keeps dispatch alive if this load fails).
  const policyModule = await getPolicyModule().catch(() => null);
  warmPolicyBaseline(policyModule);
  const requests = await eyes.readJson(REQUESTS_PATH, []);
  const tasks = await eyes.readJson(TASKS_PATH, []);
  // Promotion copies inbox titles onto the board. Until the compactor absorbs
  // the original request, the two would otherwise spawn as two runs. Done
  // titles stay taken too: otherwise a leftover request re-runs work that
  // just succeeded the moment the task flips off "open".
  const liveBoard = new Set(
    tasks
      .filter((task) => task && task.status !== "archived")
      .map((task) => workTitleKey(task.title))
      .filter(Boolean)
  );
  // One ranking across the inbox and the board instead of "requests first":
  // the queue used to shadow the whole board, so a chat task waited behind
  // every auto-filed request whatever it was worth. The best request and the
  // best task now meet in compareWork — worth first (a pin above all), then
  // age inside a band.
  const liveTaskIds = new Set(autopilot.jobs.map((job) => job.taskId).filter(Boolean));
  const liveKeys = new Set(autopilot.jobs.map((job) => workTitleKey(job.title)).filter(Boolean));
  const waiting = requests.filter((item) => {
    if (!item || item.status === "running" || item.status === "verifying") return false;
    if ((item.runFailures ?? 0) >= 5) return false;
    if (item.nextRunAt && item.nextRunAt > Date.now()) return false;
    const key = workTitleKey(item.title) || workTitleKey(item.prompt);
    if (key && liveKeys.has(key)) return false;
    if (conflictsWithLiveFix(eyes, item)) return false;
    return !key || !liveBoard.has(key);
  });
  autopilot.queueDepth = queuedWorkCount(waiting, tasks);
  // Failure isolation lives here: a task on a failure backoff (or past 5
  // tries) is skipped, not parked — the rest of the board keeps running.
  const now = Date.now();
  const open = tasks
    .filter((task) => task && task.status === "open" && !liveTaskIds.has(task.id) && !liveKeys.has(workTitleKey(task.title)) && !conflictsWithLiveFix(eyes, task))
    .sort((a, b) => (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0));
  const runnable = open.filter((task) => (task.runFailures ?? 0) < 5 && !(task.nextRunAt && task.nextRunAt > now));
  // Pick by what the job is FOR, not just who filed it. Preferring
  // source === "a-eyes" meant the overseer's own upkeep chores ("Stamp digest
  // schema version", "Tag log errors by role") took every slot the moment it
  // got going — 20 of 34 tasks — while the actual app and game work sat
  // behind them. Self-maintenance is real work, but it goes last.
  const ranked = [
    ...waiting.map((ref) => ({ kind: "request", ref })),
    ...runnable.map((ref) => ({ kind: "task", ref })),
  ].sort((a, b) => compareWork(a.ref, b.ref));
  if (!ranked.length) {
    const cooling =
      open.length > runnable.length ||
      requests.some((item) => item && item.status !== "running" && (item.nextRunAt > now || (item.runFailures ?? 0) >= 5));
    return cooling || open.length ? "cooldown" : "empty";
  }
  let job = null;
  let claim = null;
  let deferred = 0;
  let selectedRank = -1;
  let entryPolicyDecisionId = null;
  let entryPolicyActions = [];
  for (let rank = 0; rank < ranked.length; rank += 1) {
    const candidate = ranked[rank];
    const next = {
      kind: candidate.kind,
      title: candidate.ref.title,
      prompt: candidate.ref.prompt ?? "",
      source: candidate.kind === "request" ? candidate.ref.source ?? "manual" : candidate.ref.source ?? "task",
      ref: candidate.ref,
    };
    let decision = { action: "proceed", files: [], advice: "" };
    try {
      if (assistantModule?.claimWork) {
        decision =
          assistantModule.claimWork({
            work: {
              title: next.title,
              prompt: next.prompt,
              file: next.ref?.file,
              files: next.ref?.files,
              refs: next.ref?.refs,
              source: next.source,
              pin: next.ref?.pin,
              ref: next.ref,
            },
            collisions: assistantCache.store?.collisions ?? [],
            presence: assistantCache.store?.presence ?? [],
            sessions: assistantCache.store?.sessions ?? [],
            todos: assistantCache.store?.todos ?? [],
            uncommitted: assistantCache.store?.uncommitted ?? [],
            jobs: autopilot.jobs,
          }) || decision;
      }
    } catch {}
    // A sibling job that already claimed the file always skips this pick.
    // Live editors skip too, except pins, chat asks, and collision jobs
    // (shouldHoldWork) so the pool is never parked on someone else's buffer.
    const skip =
      decision?.reason === "claimed" ||
      (assistantModule?.shouldHoldWork ? assistantModule.shouldHoldWork(decision, next) : decision?.action === "defer");
    if (skip) {
      if (!deferred) {
        const why = decision.reason === "claimed" ? "file claimed" : "live editor";
        logLine(`[autopilot] skip "${String(next.title).slice(0, 80)}": ${why}`);
      }
      deferred += 1;
      continue;
    }
    job = next;
    claim = decision;
    selectedRank = rank;
    break;
  }
  // Policy Lab PR1 — the decision record: the eligible set as the frozen
  // baseline saw it, what it recommended, and what the foreman actually took
  // after the claim gate. Computed after the pick and read by nothing below —
  // recording cannot change what is selected.
  if (ranked.length) {
    const policyIdentityNow = await resolveActivePolicyIdentity().catch(() => null);
    if (policyIdentityNow?.id && policyIdentityNow.hash) {
      const decisionAt = Date.now();
      const decisionId = `dec_${decisionAt}_${(policyRecordSeq += 1)}`;
      const policyActions = ranked.slice(0, 40).map((candidate, index) => policyActionDescriptor(policyModule, candidate, index, decisionAt));
      policyRecord("decision", {
        decisionId,
        policy: { id: policyIdentityNow.id, version: policyIdentityNow.version, kind: policyIdentityNow.kind, hash: policyIdentityNow.hash },
        observation: {
          actions: policyActions,
          limits: { maxConcurrency: Math.max(1, autopilot.parallel), paused: false, machineBusy: Boolean(leases?.exclusive) },
          eligibleCount: ranked.length,
        },
        recommended: policyActions.map((action) => action.id),
        selected: selectedRank >= 0 && selectedRank < policyActions.length ? policyActions[selectedRank].id : null,
        deferredCount: deferred,
        stopReason: job ? null : deferred ? "deferred" : "empty",
      });
      entryPolicyDecisionId = decisionId;
      entryPolicyActions = policyActions;
    }
  }
  if (!job) return deferred ? "deferred" : "empty";
  const startedAt = Date.now();
  const entry = {
    projectId: runProject.id,
    projectPath: runRoot,
    id: `run_${startedAt}_${(autopilotJobSeq += 1)}`,
    kind: job.kind,
    title: job.title,
    source: job.source,
    ref: job.ref,
    files: Array.isArray(claim?.files) ? claim.files : [],
    file: (Array.isArray(claim?.files) && claim.files[0]) || job.ref?.file || null,
    child: null,
    pid: null,
    startedAt,
    sessionId: null,
    taskId: job.kind === "task" ? job.ref.id : null,
    progress: null, // the run's own todo fraction — watchJobProgress keeps it fresh
    finished: false,
    outputTail: [], // last few stdout/stderr lines — a failure names its cause
    outputLog: [], // capped transcript for the durable run log (data/executor-log.jsonl)
    startKilled: false, // the wedged-start watchdog killed this run
    sawDone: false, // the run printed EXECUTOR_DONE_MARK — this, not the exit code, is the verdict
    resultNote: null, // MEFI_RESULT line, when the worker gives one: its own account of done/remaining
    spoke: false, // it wrote something at all; a silent run really is broken infrastructure
    handoffs: [], // MEFI_NEXT work this run passed to the next agent
    calls: new Set(), // MEFI_CALL roster roles it asked to follow up
    depth: Number(job.ref?.depth) || 0, // how far down a handoff chain this run sits
  };
  // The claim rides the job id: a run that dies with the app (or whose close
  // never landed) is re-queued by housekeeping once its id leaves the list.
  // Register before the claim lands on disk — housekeeping rescues claims
  // with no live run behind them, so the job must be visible first.
  autopilot.jobs.push(entry);
  let claimed = false;
  try {
    // The claim is one transactional mutation: the freshness re-read, the
    // eligibility check, and the claim write all happen inside the same
    // BEGIN IMMEDIATE (store mode) or the same board-lock read (file mode).
    // The old shape — read outside, re-check, whole-collection write — let a
    // second process claim the same open task between our read and our write;
    // SQLite serializes the writes but cannot make a separately performed
    // check atomic. The lease ({ pid, at }) rides the claim so housekeeping
    // can tell our own dead runs from another process's live ones.
    await mutateBoard((board) => {
      if (job.kind === "request") {
        const same = (item) => item && item.at === job.ref.at && item.prompt === job.ref.prompt;
        const current = board.requests.find(same);
        if (!current || current.status === "running" || current.status === "verifying" || (current.runId && current.runId !== entry.id)) return null;
        current.status = "running";
        current.runId = entry.id;
        current.runningAt = startedAt;
        current.lease = { pid: process.pid, at: startedAt };
        job.ref = current;
        claimed = true;
        return {};
      }
      const current = board.tasks.find((item) => item && item.id === job.ref.id);
      if (!current || current.status !== "open" || (current.runId && current.runId !== entry.id)) return null;
      current.status = "active";
      current.runId = entry.id;
      current.updatedAt = startedAt;
      current.lease = { pid: process.pid, at: startedAt };
      current.logs = [...(current.logs ?? []), { at: startedAt, kind: "status", text: "autopilot picked up task" }].slice(-40);
      job.ref = current;
      claimed = true;
      return {};
    });
  } catch (error) {
    autopilot.jobs = autopilot.jobs.filter((item) => item !== entry);
    throw error;
  }
  if (!claimed) {
    autopilot.jobs = autopilot.jobs.filter((item) => item !== entry);
    return "lost";
  }
  autopilot.queueDepth = queuedWorkCount(requests, tasks);
  // Race recheck of the machine lease after the claim lands — same
  // pattern as tools/lease.ps1 Assert-TestMachineLease. An exclusive
  // holder that arrived mid-claim wins; we drop the claim instead of
  // launching a child.
  try {
    const machine = await getMachine();
    leases = await machine.leaseStatus({ repoRoot: projectRoot() });
  } catch {}
  if (leases?.exclusive) {
    await releaseExecutorClaim(eyes, job, entry).catch(() => {});
    autopilot.jobs = autopilot.jobs.filter((item) => item !== entry);
    return "busy";
  }
  // Policy Lab PR1 — the attempt's identity: handoff lineage, the claim, the
  // route and the acceptance baseline it will be judged against. The prompt
  // is hashed, never stored — chat text stays out of the experiment record.
  policyRecord("attempt-start", {
    attemptId: entry.id,
    decisionId: entryPolicyDecisionId,
    parentAttemptId: job.ref?.fromRun ? String(job.ref.fromRun).slice(0, 80) : null,
    parentTitle: job.ref?.parent ? String(job.ref.parent).slice(0, 90) : null,
    intentKey: workTitleKey(job.title) || job.title.slice(0, 120),
    actionId: selectedRank >= 0 && selectedRank < entryPolicyActions.length ? entryPolicyActions[selectedRank].id : null,
    workItem: {
      kind: job.kind,
      id: job.kind === "task" ? job.ref?.id ?? null : null,
      title: String(job.title).slice(0, 160),
      promptSha256: crypto.createHash("sha256").update(String(job.prompt ?? "")).digest("hex"),
      promptChars: String(job.prompt ?? "").length,
    },
    depth: entry.depth,
    claim: { runId: entry.id, leaseAt: startedAt },
    route: { via: String(runRoute.via ?? "").slice(0, 80), cli: runRoute.grok === true ? "grok" : "opencode" },
  });
  // `opencode run` exits 1 even on a clean run, so the exit code cannot be the
  // success signal (every job looked failed: tasks never closed, the breaker
  // parked the executor). The prompt ends with a sentinel instead — the run
  // counts as done when that line comes back on stdout.
  const handoff =
    entry.depth < EXECUTOR_MAX_DEPTH
      ? ` If you find follow-up work you did not do, hand it on: print ${EXECUTOR_NEXT_MARK} <short title> :: <what the next agent should do> (at most ${EXECUTOR_MAX_HANDOFFS} of them), and print ${EXECUTOR_CALL_MARK} <auditor|reference|ideas|improver> to wake that agent on it.`
      : " Do not hand off any further work; this chain has run long enough.";
  // The tail carries the verdict sentinel, so it is budgeted first and the
  // task's own text is trimmed to fit around it. Slicing the whole string
  // instead dropped the sentinel off any job with a long prompt — a folded
  // plan listing eight ideas runs past 1000 characters on its own — and those
  // jobs would then be filed as failures however well they went.
  const budget =
    entry.depth < EXECUTOR_MAX_DEPTH
      ? ` You have about ${EXECUTOR_BUDGET_MINUTES} minutes. If the whole job will not fit, finish the most valuable piece, hand the rest on, and still print the line below — a run that is cut off reports nothing and counts as a failure.`
      : ` You have about ${EXECUTOR_BUDGET_MINUTES} minutes. If the whole job will not fit, finish the most valuable piece and still print the line below.`;
  // The run's identity, so the worker (and any structured result it prints)
  // names the attempt it belongs to instead of an unattributed success line.
  const identity = job.kind === "task" ? ` This dispatch is run ${entry.id} for task ${job.ref?.id}.` : ` This dispatch is run ${entry.id}.`;
  const tail = `${identity}${handoff}${budget} Optionally print one line "MEFI_RESULT: done: <what you finished>; remaining: <what is left>" naming your own account of the work. Print the exact line ${EXECUTOR_DONE_MARK} as the last thing you say.`;
  // Push memory: the builder gets a compiled mini-index of what the studio
  // already knows about this job. It does not have to remember to search.
  let memoryBit = "";
  try {
    const lessons = (assistantState?.overseer?.lessons ?? []).map((row) => (row && row.text) || row);
    const compiled = assistantModule?.compileMemory?.({
      query: `${job.title} ${job.prompt}`,
      folders: assistantState?.nodeFolders,
      lessons,
      focus: job.kind === "task" && job.ref?.id ? taskTarget(job.ref.id) : assistantState?.focus,
      now: startedAt,
      limit: 4,
    });
    if (compiled?.primer?.length) {
      memoryBit = ` Memory: ${compiled.primer.join("; ")}.${compiled.dig ? " DIG REQUIRED: a superseded fact is in that list, verify it before editing." : ""}`;
    }
  } catch {}
  const failBit = job.ref?.lastRunError
    ? ` Previous run failed (${String(job.ref.lastRunError).slice(0, 160)}). Diagnose and resolve that failure, then finish the original work.`
    : "";
  let collabBit = "";
  if (claim?.advice) collabBit = ` ${String(claim.advice).replace(/["\r\n]+/g, " ").slice(0, 420)}`;
  // File claims cover live editors; this catches a peer session that already
  // implemented the same feature under a different file set.
  try {
    const adopt = eyes.adoptAdvice?.({
      title: job.title,
      prompt: job.prompt,
      sessions: assistantCache.store?.sessions ?? [],
    });
    if (adopt && !/already looks like it implemented/.test(collabBit)) {
      collabBit += ` ${String(adopt).replace(/["\r\n]+/g, " ").slice(0, 220)}`;
    }
  } catch {}
  // Budget the prompt piecewise: the tail and instructions are fixed, memory
  // and collaboration advice are capped decorations, and the task's own text —
  // for a folded plan, the obligation list itself — gets whatever is left,
  // trimmed LAST. The old single slice kept the decorations and silently cut
  // the later obligations, so the run could declare success on a job it had
  // only partly read.
  const titleBit = `${job.title}. `.replace(/["\r\n]+/g, " ");
  const instructions = " Work in the repository at the current directory. Make the edits, do not just describe them. When done, run the narrowest relevant test.".replace(/["\r\n]+/g, " ");
  const failFlat = failBit.replace(/["\r\n]+/g, " ").slice(0, 240);
  const memoryFlat = memoryBit.replace(/["\r\n]+/g, " ").slice(0, 480);
  const collabFlat = collabBit.replace(/["\r\n]+/g, " ").slice(0, 320);
  const tailFlat = tail.replace(/["\r\n]+/g, " ");
  const promptBudget = Math.max(
    240,
    EXECUTOR_PROMPT_MAX - tailFlat.length - instructions.length - titleBit.length - failFlat.length - memoryFlat.length - collabFlat.length - 8,
  );
  const body = String(job.prompt ?? "").replace(/["\r\n]+/g, " ").slice(0, promptBudget);
  const head = `${titleBit}${body}${failFlat}${memoryFlat}${collabFlat}${instructions}`;
  const prompt = `${head}${tailFlat}`;
  // finish() sits above the spawn so a synchronous spawn failure (argument
  // rejects, resource exhaustion — 'error' is the normal channel) still
  // unclaims through the same path a dead process would take.
  let timeout = null;
  let startWatchdog = null;
  const finish = async (code, errorMessage = null) => {
    if (entry.finished) return;
    entry.finished = true;
    if (timeout) clearTimeout(timeout);
    if (startWatchdog) clearTimeout(startWatchdog);
    const sessionId = entry.sessionId ?? null;
    // The verdict: the sentinel the run was asked to print, or a genuine exit 0.
    // A spawn error is always a failure, whatever came back on the stream.
    // `ok` means the run REPORTED success — the task settles to
    // awaiting_verification, and only the evidence-checked verification pass
    // (autopilotHousekeeping) marks it done.
    const ok = errorMessage == null && (entry.sawDone || code === 0);
    if (!ok && errorMessage) autopilot.lastError = errorMessage;
    // The durable record: what ran, how it ended, and the tail of what it
    // said — the work log that survives the app.
    executorLog({
      event: "finish",
      runId: entry.id,
      kind: job.kind,
      task: job.kind === "task" ? job.ref?.id ?? null : null,
      title: String(job.title ?? "").slice(0, 160),
      ok,
      code: code ?? null,
      error: errorMessage ? String(errorMessage).slice(0, 200) : null,
      sawDone: entry.sawDone === true,
      spoke: entry.spoke === true,
      startKilled: entry.startKilled === true,
      sessionId,
      result: entry.resultNote?.raw ?? null,
      seconds: Math.round((Date.now() - entry.startedAt) / 1000),
      tail: (entry.outputLog ?? []).slice(-40),
    }).catch(() => {});
    // Policy Lab PR1 — the outcome half of the attempt. A finish report is
    // not a verification result: `outcome` records what the run CLAIMED; a
    // positive learning label can only come later, from a runner-produced
    // receipt (autopilotHousekeeping). Unknown costs stay null, never zero.
    const attemptDurationMs = Date.now() - entry.startedAt;
    policyRecord("attempt-finish", {
      attemptId: entry.id,
      intentKey: workTitleKey(job.title) || job.title.slice(0, 120),
      outcome: ok ? "reported-done" : "failed",
      exitCode: code ?? null,
      sawDone: entry.sawDone === true,
      spoke: entry.spoke === true,
      sessionId,
      durationMs: attemptDurationMs,
      handoffs: entry.handoffs.slice(0, EXECUTOR_MAX_HANDOFFS).map((item) => ({ title: String(item.title ?? "").slice(0, 90), intentKey: workTitleKey(item.title) || null })),
      result: entry.resultNote?.parts
        ? {
            done: String(entry.resultNote.parts.done ?? "").slice(0, 200) || null,
            remaining: String(entry.resultNote.parts.remaining ?? "").slice(0, 200) || null,
            tests: String(entry.resultNote.parts.tests ?? entry.resultNote.parts.ran ?? "").slice(0, 200) || null,
          }
        : null,
      cost: { durationMs: attemptDurationMs, modelCalls: null, tokens: null, providerCost: null, testExecutions: null },
    });
    // Report home while the builder node is still on the board so the
    // Command view can pulse it back to the assistant. The overseer is
    // woken after the store write so it does not reopen the claim we are
    // about to settle.
    let heard = null;
    try {
      heard = assistantHearBuilder(entry, job, ok);
    } catch (error) {
      logLine(`[assistant] builder report failed: ${error.message}`);
    }
    const attempt = {
      runId: entry.id,
      code: code ?? null,
      sawDone: entry.sawDone === true,
      spoke: entry.spoke === true,
      sessionId,
      at: Date.now(),
      tail: (entry.outputTail ?? []).slice(-1)[0] ?? null,
      ...(entry.resultNote ? { result: entry.resultNote } : {}),
    };
    // Settlement rides ONE transactional mutation for the board stores: the
    // ownership re-read, the fence check, and the write are the same atomic
    // step, not a read then a separate whole-collection write.
    try {
      await mutateBoard((board) => {
      const fence = (record, requireOwner = true) =>
        assistantModule?.ownershipFence ? assistantModule.ownershipFence(record, entry.id, { requireOwner }) : record ? record.runId === entry.id : false;
      if (job.kind === "request") {
        const same = (item) => item && item.at === job.ref.at && item.prompt === job.ref.prompt;
        if (ok) {
          // Reported success: the row stays as "verifying" with the attempt's
          // evidence — the housekeeping pass settles it with the same
          // acceptance-contract check tasks get. Unclaimed duplicates of the
          // finished work drop idempotently; a row another attempt owns is
          // untouched.
          board.requests = board.requests.flatMap((item) => {
            if (!same(item)) return [item];
            if (item.runId === entry.id) return [{ ...item, status: "verifying", runningAt: job.ref.runningAt ?? null, lastAttempt: attempt }];
            if (!item.runId) return [];
            return [item];
          });
        } else {
          // A failed request used to vanish, so unique handoffs (source
          // "agent") were gone forever. Restore it with the same backoff
          // a failed task gets so the queue keeps retrying — but only if
          // this run still owns the claim; a re-queued row belongs to the
          // next attempt now.
          let touched = false;
          const remaining = board.requests.map((item) => {
            if (!same(item)) return item;
            if (!fence(item)) return item;
            touched = true;
            const failures = (item.runFailures ?? 0) + 1;
            const next = { ...item };
            delete next.status;
            delete next.runId;
            delete next.runningAt;
            delete next.lease;
            next.runFailures = failures;
            next.lastRunError = (entry.outputTail ?? []).slice(-1)[0] || `exit ${code ?? "?"}`;
            if (failures < 5) next.nextRunAt = Date.now() + (failures <= 1 ? 60 * 1000 : Math.min(2 * 3600 * 1000, (2 ** failures) * 5 * 60000));
            else delete next.nextRunAt;
            return next;
          });
          if (touched) {
            board.requests = remaining;
          } else if (!board.requests.some(same)) {
            const restored = { ...job.ref };
            delete restored.status;
            delete restored.runId;
            delete restored.runningAt;
            delete restored.lease;
            restored.runFailures = 1;
            restored.nextRunAt = Date.now() + 60 * 1000;
            restored.lastRunError = (entry.outputTail ?? []).slice(-1)[0] || `exit ${code ?? "?"}`;
            board.requests = [restored, ...board.requests];
          } else {
            board.requests = remaining;
          }
        }
        return {};
      }
      const task = board.tasks.find((item) => item.id === job.ref.id);
      // Ownership fence: settle only what this run still owns. If the claim
      // was re-queued by housekeeping/overseer (or the record vanished), a
      // stale completion must not close or fail someone else's attempt.
      if (!task || !fence(task)) {
        logLine(`[autopilot] settlement skipped — "${String(job.title).slice(0, 60)}" is no longer owned by ${entry.id}`);
        return null;
      }
      task.updatedAt = Date.now();
      // A pin is a one-shot: the run it asked for has now happened, so
      // the next pick goes back to the ordinary worth order.
      delete task.pin;
      delete task.pinAt;
      if (ok) {
        // Not "done" — the run SAID it finished. The card goes to
        // awaiting_verification with the attempt's structured evidence
        // attached; the housekeeping verification pass settles it. A fresh
        // attempt restarts the bounded verification budget.
        task.status = "awaiting_verification";
        delete task.lastRunError;
        delete task.runFailures;
        delete task.nextRunAt;
        delete task.verification;
        delete task.verifyAttempts;
        task.lastAttempt = attempt;
        // Follow-ups this run handed on are remaining obligations, kept
        // visible on the card; they are queued as requests right after
        // (runExecutorHandoffs), so nothing silently disappears with the
        // parent. They also gate verification: a card with outstanding
        // obligations is never marked verified.
        if (entry.handoffs.length) task.remaining = entry.handoffs.slice(0, EXECUTOR_MAX_HANDOFFS).map((item) => item.title);
        else delete task.remaining;
        task.logs = [...(task.logs ?? []), { at: Date.now(), kind: "status", text: `run finished (${attempt.sawDone ? "sentinel seen" : "exit 0"}) — awaiting verification${Array.isArray(task.remaining) ? ` · ${task.remaining.length} follow-up(s) handed on` : ""}` }].slice(-40);
        // The worker's own account of the attempt, kept out of the
        // bookkeeping line so the Done digest shows what was actually done.
        if (entry.resultNote?.raw) {
          task.logs = [...(task.logs ?? []), { at: Date.now(), kind: "result", text: String(entry.resultNote.raw).slice(0, 300) }].slice(-40);
        }
      } else {
        // Failure isolation: the task cools down on its own backoff
        // (10m, 20m, 40m… capped at 2h) while the pool keeps running —
        // after 5 tries it sits out until a manual reopen resets it.
        task.status = "open";
        delete task.runId;
        delete task.lease;
        delete task.doneAt;
        task.runFailures = (task.runFailures ?? 0) + 1;
        // First miss retries in a minute with the error in the prompt so
        // the next agent works on resolving it; later misses back off.
        if (task.runFailures < 5) task.nextRunAt = Date.now() + (task.runFailures <= 1 ? 60 * 1000 : Math.min(2 * 3600 * 1000, (2 ** task.runFailures) * 5 * 60000));
        else delete task.nextRunAt;
        const failTail = entry.startKilled ? errorMessage : (entry.outputTail ?? []).slice(-1)[0];
        task.lastRunError = failTail ? String(failTail).slice(0, 160) : `exit ${code ?? "?"}`;
        task.logs = [...(task.logs ?? []), {
          at: Date.now(),
          kind: "status",
          text: `autopilot run failed (exit ${code ?? "?"})${task.lastRunError && task.lastRunError !== `exit ${code ?? "?"}` ? ` · ${task.lastRunError}` : ""} · ${task.runFailures < 5 ? `retry ${task.runFailures}/5` : "gave up after 5 tries"}`,
        }].slice(-40);
      }
      if (ok) {
        const key = workTitleKey(task.title);
        if (key) {
          board.requests = board.requests.filter((item) => {
            if (!item || item.status === "running" || item.status === "verifying") return true;
            const itemKey = workTitleKey(item.title) || workTitleKey(item.prompt);
            return !itemKey || itemKey !== key;
          });
        }
      }
      // The outcome lands in the task's folder: the node remembers what its
      // last build did, and the keeper cleans it out once the task is gone.
      assistantNodeContext(taskTarget(task.id), "run", `autopilot "${assistantClip(job.title, 60)}" — ${ok ? "finished, verifying" : "failed"} (exit ${code ?? "?"})`, "executor");
      return {};
      });
    } catch (error) {
      logLine(`[autopilot] store update failed: ${error.message}`);
    }
    // History and checkpoints are not board stores: they update serialized by
    // the same board lock, after the transactional settlement above.
    try {
      await withBoardLock(async () => {
        if (job.kind === "request") {
          const history = await eyes.readJson(ASSISTANT_HISTORY_PATH, []);
          // Keep the sessions this fix claimed (the alerted ones plus the session
          // it spawned) on the record. The queue forgets a request the moment it
          // is dispatched, so without these claims the next briefing pass
          // re-diagnoses the same stall and chains another overlapping fix.
          const claimed = [
            ...(Array.isArray(job.ref.sessions) ? job.ref.sessions : []),
            ...(sessionId ? [sessionId] : []),
          ];
          const record = {
            title: job.title,
            prompt: job.prompt,
            source: job.source,
            at: job.ref.at ?? null,
            finishedAt: Date.now(),
            code,
            ok,
            verifying: Boolean(ok),
            sessions: [...new Set(claimed)],
          };
          if (job.ref.alertTitle) record.alertTitle = job.ref.alertTitle;
          if (job.ref.file) record.file = job.ref.file;
          if (job.ref.problemFamily) record.problemFamily = job.ref.problemFamily;
          if (Array.isArray(job.ref.problemFiles) && job.ref.problemFiles.length) record.problemFiles = job.ref.problemFiles;
          history.unshift(record);
          await eyes.writeJson(ASSISTANT_HISTORY_PATH, history.slice(0, 40));
        }
        // The spawned session gets a checkpoint so the session card shows what
        // the autopilot asked it to do and how the run ended.
        if (sessionId) {
          const store = await eyes.readJson(CHECKPOINTS_PATH, {});
          const list = store[sessionId] ?? [];
          list.unshift({
            note: `autopilot: ${String(job.title).slice(0, 120)} — ${ok ? "done" : "failed"} (code ${code ?? "?"})`,
            at: Date.now(),
            source: "autopilot",
            files: [],
          });
          store[sessionId] = list.slice(0, 50);
          await eyes.writeJson(CHECKPOINTS_PATH, store);
          send("eyes:checkpoints", store);
          // The spawned session's folder carries the same verdict, next to the
          // checkpoint — the node and its context stay one thing.
          assistantNodeContext(sessionTarget(sessionId), "run", `autopilot "${assistantClip(job.title, 60)}" — ${ok ? "done" : "failed"} (exit ${code ?? "?"})`, "executor");
        }
      });
    } catch (error) {
      logLine(`[autopilot] run record update failed: ${error.message}`);
    }
    // The in-flight list is released only after the store write: before, a
    // housekeeping/overseer pass running in the window between the two saw a
    // "stuck" claim (no live run behind the runId) and re-queued work this
    // very function was about to settle.
    autopilot.jobs = autopilot.jobs.filter((item) => item !== entry);
    // Per-job failure isolation: a failed run after real runtime is the task's
    // problem — it cools down via runFailures above and the pool keeps working.
    // The only pause left is for infrastructure: a spawn error, or a run that
    // died inside 15s *without saying anything*, means opencode itself cannot
    // start. A run that talked is not an infra failure however it exited —
    // that false positive is what used to park the executor on a healthy CLI.
    const infraFail = errorMessage != null || (!ok && !entry.spoke && Date.now() - entry.startedAt < 15000);
    if (ok) {
      autopilot.consecutiveFailures = 0;
      autopilot.infraFailures = 0;
      autopilot.lastError = null;
      pushAutopilotHistory("done", `done: ${job.title}`);
      await runExecutorHandoffs(entry, job).catch((error) => logLine(`[autopilot] handoff failed: ${error.message}`));
    } else {
      autopilot.consecutiveFailures += 1;
      // The last output line usually says what actually went wrong — keep it
      // so the feed and the chat reply can name the issue, not just "exit 1".
      const tail = (entry.outputTail ?? []).slice(-1)[0];
      autopilot.lastError = errorMessage ?? (tail ? `${tail.slice(0, 160)}` : `no ${EXECUTOR_DONE_MARK} (exit ${code})`);
      pushAutopilotHistory("failed", `failed: ${job.title} (code ${code ?? "?"})${tail ? ` — ${tail.slice(0, 100)}` : ""}`);
      if (infraFail) {
        autopilot.infraFailures += 1;
        if (autopilot.infraFailures >= 3 && autopilot.execute) {
          autopilot.execute = false;
          autopilot.parkedUntil = Date.now() + AUTOPILOT_PARK_MS;
          pushAutopilotHistory("paused", `executor paused ~${Math.round(AUTOPILOT_PARK_MS / 60000)}m — ${autopilot.lastError}`);
          logLine(`[autopilot] executor parked for ${AUTOPILOT_PARK_MS / 60000}m: ${autopilot.lastError}`);
        }
      } else {
        autopilot.infraFailures = 0; // the job ran — the infrastructure works
      }
    }
    // A request the user dropped in chat gets its result back in the thread —
    // "starting work on X" only means something if "finished X" follows.
    // Chat work is a board task now, so kind no longer gates the report.
    // "Finished" stays honest: the run reported success, verification still
    // has to confirm it before the card reads done.
    if (job.source === "chat") {
      assistantAppendReply(`${ok ? "Finished (verifying)" : "Failed"}: ${assistantClip(job.title, 80)}.`, "local", "request");
      saveAssistant({ force: true }).catch(() => {});
    }
    emitAutopilot();
    // The assistant tidies up behind every finished job: the task just closed
    // (or bounced back to open with a fresh backoff), so the queue's shape has
    // changed and the compactor is what turns that into the next thing to run.
    // It ends by filling the freed slot, so this replaces the bare kick.
    assistantEnqueueRole("compactor", ASSISTANT_PRIORITY.demand);
    assistantAskForWork("a slot came free");
    if (heard?.wakeOverseer) assistantEnqueueRole("overseer", ASSISTANT_PRIORITY.demand);
    refreshAutopilotQueue(eyes).catch(() => {});
  };
  entry.reap = finish;
  // Provider route for this run: a saved z.ai key puts the job on the
  // mefi-zai provider (GLM 5.3 Flash on the owner's coding plan, billed to
  // z.ai — never the OpenCode balance) unless routing was pinned to
  // "opencode". "zai"-only routing with no key fails the job loudly rather
  // than quietly spending OpenCode credit. executorCli "grok" hands the run
  // to the Grok CLI instead — same prompt, same sentinel protocol, the CLI's
  // own login, tools auto-approved because nobody is at the keyboard.
  let runLabel = runRoute.cli === "grok" ? "grok" : "opencode";
  // Same line-buffering as streamChild, but the autopilot children are tracked
  // separately: activeChild belongs to the Love2D studio launcher. Shared by
  // every attach() below — the first attempt and any grok fallback alike.
  const wire = (stream) => {
    if (!stream) return;
    stream.setEncoding("utf8");
    let buffer = "";
    const take = (line) => {
      logLine(`[${runLabel}] ${line}`);
      entry.spoke = true;
      // Strict verdict match: the line must BE the sentinel (a short trailing
      // note allowed). A run that quotes the protocol back in prose must not
      // flip its own job to done.
      if (assistantModule?.isDoneMarkerLine ? assistantModule.isDoneMarkerLine(line, EXECUTOR_DONE_MARK) : line.trim() === EXECUTOR_DONE_MARK) entry.sawDone = true;
      // The worker's structured account of the attempt, when it gives one.
      if (!entry.resultNote) {
        const resultLine = assistantModule?.parseExecutorResult ? assistantModule.parseExecutorResult(line) : null;
        if (resultLine) entry.resultNote = resultLine;
      }
      const handoff = parseExecutorHandoff(line);
      if (handoff?.kind === "next" && entry.handoffs.length < EXECUTOR_MAX_HANDOFFS) entry.handoffs.push(handoff);
      if (handoff?.kind === "call") entry.calls.add(handoff.role);
      entry.outputTail.push(line.trim().slice(0, 200));
      if (entry.outputTail.length > 8) entry.outputTail.splice(0, entry.outputTail.length - 8);
      entry.outputLog.push(line.trim().slice(0, 200));
      if (entry.outputLog.length > 200) entry.outputLog.splice(0, entry.outputLog.length - 200);
    };
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) take(line);
    });
    stream.on("end", () => {
      if (buffer.trim()) take(buffer);
    });
  };
  // Grok is a choice, not a single point of failure: `runRoute.opencode`
  // carries the route the run would have taken without grok (mefi-zai when a
  // z.ai key is saved), so a grok attempt that dies before saying anything
  // — spawn failure, wedged start, silent exit — retries the same job, on the
  // same claim, through opencode once. A grok run that TALKED and then exited
  // nonzero is the job's own failure and counts as one.
  const fallbackRoute = runRoute.grok && runRoute.opencode && !runRoute.opencode.error ? runRoute.opencode : null;
  const spawnAttempt = (route, useGrok) => {
    if (useGrok) {
      // Build jobs need a headless agentic session: positional prompt, tools
      // auto-approved, plain stdout, a turn cap so a wedged run cannot
      // outlive the kill timer.
      const grokArgs = ["--output-format", "plain", "--always-approve", "--max-turns", "60", "--no-alt-screen", "--verbatim"];
      if (route.model) grokArgs.push("-m", route.model);
      grokArgs.push(prompt);
      return spawn("grok", grokArgs, {
        cwd: runRoot,
        env: { ...process.env, ...route.env },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    // --auto: nobody is at the keyboard to answer a permission prompt, so a
    // headless run without it stops at the first edit and reports back prose.
    // The prompt rides STDIN, never the command line, for two proven reasons:
    // `opencode run` reads piped stdin as its message, so an open, never-ended
    // stdin pipe leaves it waiting silently for a prompt that never comes
    // (this exact shape wedged every executor run on 2026-09-18); and cmd's
    // quoting/percent-expansion silently mangles long prompt bodies, dropping
    // the positional entirely — the CLI then prints help and exits 1.
    // Write + end gives a clean prompt and a clean EOF, no wedge, no mangling.
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `opencode run --auto${route.modelArgs}`], {
      cwd: runRoot,
      env: { ...process.env, ...route.env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(prompt);
    child.stdin.end();
    return child;
  };
  let child = null;
  let attemptStartedAt = startedAt;
  const attach = (nextChild, label, route, allowFallback) => {
    child = nextChild;
    entry.child = child;
    entry.pid = child.pid ?? null;
    autopilot.waiting = null; // a job actually spawned — the emit below carries it
    runLabel = label;
    wire(child.stdout);
    wire(child.stderr);
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      setTimeout(() => {
        if (!entry.finished) finish(1, "killed after budget").catch(() => {});
      }, 45000).unref?.();
    }, EXECUTOR_KILL_MS);
    timeout.unref?.();
    if (startWatchdog) clearTimeout(startWatchdog);
    // Wedged-start watchdog. A run that has neither registered an OpenCode
    // session nor printed a line within the start budget is not slow, it is
    // stuck — twelve same-second startups once sat silent like that for the
    // whole kill budget, stalling every slot cycle after cycle. Kill it as the
    // infrastructure failure it is; a grok run gets one opencode retry first.
    // The budget scales with how many siblings are already running: a full
    // pool of CLI agents starting against one shared OpenCode store takes
    // minutes to first output, and killing a slow-but-healthy start just
    // feeds the retry loop and the failure feed.
    const startBudgetMs = EXECUTOR_START_BUDGET_MS + Math.max(0, autopilot.jobs.length - 4) * 45000;
    attemptStartedAt = Date.now();
    startWatchdog = setTimeout(() => {
      if (entry.finished) return;
      const wedged = assistantModule?.isWedgedStart
        ? assistantModule.isWedgedStart({ spoke: entry.spoke, sessionId: entry.sessionId, ageMs: Date.now() - attemptStartedAt, budgetMs: startBudgetMs })
        : !entry.spoke && !entry.sessionId;
      if (!wedged) return;
      entry.startKilled = true;
      logLine(`[autopilot] ${runLabel} run wedged (no session, no output in ${Math.round(startBudgetMs / 60000)}m) — killing: ${job.title}`);
      if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      // The kill may leave git locks in the shared snapshot worktree; aged-out
      // ones are swept so they cannot poison later runs.
      sweepSnapshotLocks().catch(() => {});
      // The machine just said it cannot start this many CLI agents at once.
      // Narrow the pool (and persist it) instead of refilling every slot
      // into the same stampede — a wedged start is a width signal, not a
      // task problem. The floor is EXECUTOR_PARALLEL_CAP: even two
      // concurrent startups collide on the shared snapshot store's git
      // index (observed 21:27), so only a serialized pool completes.
      if (autopilot.parallel > EXECUTOR_PARALLEL_CAP) {
        const narrowed = Math.max(EXECUTOR_PARALLEL_CAP, autopilot.parallel - 2);
        autopilot.parallel = narrowed;
        pushAutopilotHistory("narrowed", `pool narrowed to ${narrowed} — wedged start under load`);
        logLine(`[autopilot] pool narrowed to ${narrowed} after a wedged start`);
        readSettings().then((settings) => writeSettings({ ...settings, ui: { ...(settings.ui ?? {}), autopilot: { ...(settings.ui?.autopilot ?? {}), parallel: narrowed } } })).catch(() => {});
        emitAutopilot();
      }
      if (allowFallback && fallbackToOpencode("wedged start")) return;
      finish(1, `no session and no output for ${Math.round(startBudgetMs / 60000)}m after spawn — killed as a wedged start`).catch(() => {});
    }, startBudgetMs);
    startWatchdog.unref?.();
    child.on("close", (code) => {
      // A silent nonzero grok exit is the CLI failing, not the job: fall back
      // once before calling it a failure.
      if (allowFallback && code !== 0 && !entry.spoke && !entry.finished && fallbackToOpencode(`silent exit ${code ?? "?"}`)) return;
      finish(code).catch((error) => logLine(`[autopilot] finish failed: ${error.message}`));
    });
    child.on("error", (error) => {
      logLine(`[autopilot] ${runLabel} failed: ${error.message}`);
      if (allowFallback && fallbackToOpencode(`spawn failed: ${error.message}`)) return;
      finish(1, error.message).catch(() => {});
    });
  };
  const fallbackToOpencode = (reason) => {
    if (entry.finished || entry.fallbackTried || !fallbackRoute) return false;
    entry.fallbackTried = true;
    logLine(`[autopilot] grok failed (${reason}) — retrying "${assistantClip(job.title, 60)}" on opencode`);
    pushAutopilotHistory("fallback", `grok ${reason} — retried on opencode: ${assistantClip(job.title, 40)}`);
    executorLog({
      event: "fallback",
      runId: entry.id,
      kind: job.kind,
      task: job.kind === "task" ? job.ref?.id ?? null : null,
      title: String(job.title ?? "").slice(0, 160),
      reason: String(reason).slice(0, 120),
    }).catch(() => {});
    attach(spawnAttempt(fallbackRoute, false), "opencode", fallbackRoute, false);
    emitAutopilot();
    return true;
  };
  try {
    child = spawnAttempt(runRoute, runRoute.grok === true);
  } catch (error) {
    logLine(`[autopilot] ${runLabel} spawn failed: ${error.message}`);
    if (fallbackToOpencode(`spawn failed: ${error.message}`)) return "spawned";
    await finish(1, error.message);
    return "empty";
  }
  attach(child, runLabel, runRoute, runRoute.grok === true);
  pushAutopilotHistory("run", `started: ${job.title}`);
  executorLog({
    event: "start",
    runId: entry.id,
    kind: job.kind,
    task: job.kind === "task" ? job.ref?.id ?? null : null,
    title: String(job.title ?? "").slice(0, 160),
    via: String(runRoute.via ?? "").slice(0, 80),
    pid: entry.pid,
  }).catch(() => {});
  logLine(`[autopilot] ${runLabel} run via ${runRoute.via} (${job.kind}): ${job.title}`);
  emitAutopilot();
  watchRunSession(eyes, startedAt, entry);
  watchJobProgress(eyes, entry);
  return "spawned";
}

// A finished run's handoffs: the work it passed to the next executor agent and
// the roster agents it asked to follow up. This is what keeps the loop going —
// without it every job was a dead end and the board only ever shrank.
// The chain is bounded by EXECUTOR_MAX_DEPTH, and queueRequests dedupes by
// prompt, so a pair of agents cannot hand the same job back and forth.
async function runExecutorHandoffs(entry, job) {
  const handed = [];
  if (entry.depth < EXECUTOR_MAX_DEPTH && entry.handoffs.length) {
    const queued = await queueRequests(
      entry.handoffs.slice(0, EXECUTOR_MAX_HANDOFFS).map((item) => ({
        title: item.title,
        prompt: item.prompt,
        source: "agent",
        at: Date.now(),
        depth: entry.depth + 1,
        // Where it came from, so the chain is readable on the board — and the
        // attempt that minted it, so a retried run's duplicate handoff is
        // traceable to its origin instead of looking like fresh work.
        parent: String(job.title).slice(0, 90),
        fromRun: entry.id,
      }))
    );
    if (queued) handed.push(`${queued} follow-up request(s)`);
  }
  for (const role of entry.calls) {
    // An agent may only wake a role, never hand it a payload — the role reads
    // the same stores everything else does, so there is nothing to smuggle in.
    assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand);
    handed.push(`woke ${role}`);
  }
  if (!handed.length) return;
  const line = `${assistantClip(job.title, 60)} handed on: ${handed.join(", ")}`;
  pushAutopilotHistory("handoff", line);
  logLine(`[autopilot] ${line}`);
  assistantLog("fix", line);
  emitAutopilot();
  // The follow-up should start now, not wait for the next autopilot tick.
  assistantAskForWork("an agent handed work on");
}

// Housekeeping runs every pass: requests that sat untouched for 48h rotted,
// claims whose job is gone (quit, crash, a close that never landed) go back on
// the pile, done tasks older than the tidy horizon are dropped, duplicate titles
// collapse — the claimed copy wins — and the a-eyes open backlog is capped so the
// board stays readable. The decision rules live in the pure module
// (assistant.housekeepingSweep) so tests can exercise them; here they are
// applied under the board lock, then awaiting_verification cards get their
// completion evidence checked. Each store is written (and broadcast) only when
// it changed.
const VERIFY_DWELL_MS = 10 * 60 * 1000; // let the dust settle before judging an attempt
const LEASE_REFRESH_MS = 10 * 60 * 1000; // how often a live owner re-stamps its claims
async function autopilotHousekeeping() {
  const historyModule = await loadModule("scripts/task-history.mjs");
  const now = Date.now();
  const assistant = await getAssistant();
  const eyes = await getEyes();
  const verify = assistantModule?.verifyCompletion;
  const verifyMax = Number(assistantModule?.VERIFY_MAX_ATTEMPTS) || 3;
  // Policy Lab PR0 — the verification pass is the trusted runner: as it
  // settles cards it also emits runner-produced receipts (what IT observed,
  // never what the worker claimed). The evaluator is versioned by its source
  // hash so a changed verifier is a new experimental condition, never silent.
  const receiptsModule = await getReceiptsModule().catch(() => null);
  let evaluatorIdentity = null;
  try {
    evaluatorIdentity = verify
      ? { name: "verifyCompletion", version: String(verifyMax), sourceSha256: crypto.createHash("sha256").update(String(verify)).digest("hex") }
      : null;
  } catch {}
  const policyReceipts = [];
  const result = await mutateBoard((board) => {
    const liveRuns = new Set(autopilot.jobs.map((entry) => entry.id));
    // A live owner keeps its claims' leases fresh: a claim whose run id is
    // missing from THIS process's live set still belongs to another process
    // while its lease is recent, so the pure sweep will not requeue it.
    const refreshLease = (row) => {
      if (!row || !row.runId || !liveRuns.has(row.runId)) return;
      if (!row.lease || !Number.isFinite(row.lease.at) || now - row.lease.at >= LEASE_REFRESH_MS) row.lease = { pid: process.pid, at: now };
    };
    const sweep = assistant.housekeepingSweep({ requests: board.requests, tasks: board.tasks, liveRuns, now, prefs: assistantState?.prefs, pid: process.pid });
    const patch = { requests: sweep.requests, tasks: sweep.tasks, sweeps: sweep.report };
    board.requests = patch.requests;
    board.tasks = patch.tasks;
    for (const row of board.tasks) refreshLease(row);
    for (const row of board.requests) refreshLease(row);
    // Verification: a completed-looking card is settled by its acceptance
    // contract, not by the sentinel and not by "did a file change?".
    // Partial work (remaining obligations), unattributed edits, missing
    // sessions, and reported check failures all stay unverified; retries are
    // bounded (verifyAttempts) so an unprovable job cannot loop forever.
    let changedByVerify = false;
    const verifyNotes = [];
    if (typeof verify === "function") {
      const tasks = [...board.tasks];
      for (const task of tasks) {
        if (task?.status !== "awaiting_verification") continue;
        const attempt = task.lastAttempt ?? {};
        if (!attempt.at || now - attempt.at < VERIFY_DWELL_MS) continue;
        const files = attempt.sessionId ? eyes.listChanges({ sessionId: attempt.sessionId, limit: 50 }) : [];
        const verdict = verify({
          verdictOk: attempt.sawDone === true || attempt.code === 0,
          changedFiles: Array.isArray(files) ? files.length : 0,
          hasSession: Boolean(attempt.sessionId),
          remaining: Array.isArray(task.remaining) ? task.remaining : [],
          resultNote: attempt.result ?? null,
          priorAttempts: Number(task.verifyAttempts) || 0,
        });
        // Policy Lab PR0 — the receipt for this settlement. The board keeps
        // settling by the verdict exactly as before; the receipt records what
        // the runner observed, and learning labels derive from its trust
        // (runner-observed evidence) rather than from the verdict alone.
        const taskReceipt = receiptsModule?.buildReceipt
          ? receiptsModule.buildReceipt({
              attemptId: attempt.runId,
              workItem: { kind: "task", id: task.id ?? null, title: task.title, prompt: task.prompt ?? "" },
              contract: "implementation",
              attempt,
              verdict,
              changedFiles: Array.isArray(files) ? files.length : 0,
              remaining: Array.isArray(task.remaining) ? task.remaining : [],
              evaluator: evaluatorIdentity,
              now,
            })
          : null;
        if (taskReceipt) {
          task.verificationReceiptId = taskReceipt.id;
          policyReceipts.push(taskReceipt);
        }
        const evidenceText = `${attempt.sawDone ? "sentinel seen" : `exit ${attempt.code ?? "?"}`}, ${files.length} changed file(s)${attempt.sessionId ? "" : ", no session"}`;
        if (verdict.state === "verified") {
          task.status = "done";
          task.doneAt = now;
          delete task.runId;
          delete task.lease;
          delete task.verifyAttempts;
          task.verification = { state: "verified", at: now, reason: verdict.reason, sentinel: attempt.sawDone === true, exit: attempt.code ?? null, changedFiles: files.length };
          task.logs = [
            ...(task.logs ?? []),
            { at: now, kind: "status", text: `verified — ${evidenceText}${Array.isArray(task.remaining) && task.remaining.length ? `, ${task.remaining.length} follow-up(s) handed on` : ""}` },
          ].slice(-40);
          verifyNotes.push(`verified "${assistantClip(task.title, 60)}"`);
        } else {
          task.verifyAttempts = verdict.attemptNo;
          task.status = "open";
          delete task.runId;
          delete task.doneAt;
          delete task.lease;
          if (verdict.state === "failed") {
            // Out of verification budget: parked like a 5x-failed task, for a
            // manual reopen — not another blind attempt.
            delete task.nextRunAt;
          } else {
            task.nextRunAt = now + 60 * 1000;
          }
          task.verification = { state: verdict.state, at: now, reason: verdict.reason, sentinel: attempt.sawDone === true, exit: attempt.code ?? null, changedFiles: files.length };
          task.logs = [
            ...(task.logs ?? []),
            { at: now, kind: "status", text: `verification could not confirm completion (${evidenceText}) — ${verdict.reason}${verdict.state === "failed" ? " · parked for manual review" : `, retry ${verdict.attemptNo}/${verifyMax}`}` },
          ].slice(-40);
          verifyNotes.push(`reopened "${assistantClip(task.title, 60)}" — ${verdict.reason}`);
        }
        changedByVerify = true;
      }
      // Directly executed requests go through the same gate: a run-level ok
      // only stamps "verifying" with the attempt's evidence; this pass settles
      // the row — drop it when the work is evidenced, else back it off like a
      // failed run.
      const requests = [...board.requests];
      const settled = [];
      for (const request of requests) {
        if (request?.status !== "verifying") continue;
        const attempt = request.lastAttempt ?? {};
        if (!attempt.at || now - attempt.at < VERIFY_DWELL_MS) continue;
        const files = attempt.sessionId ? eyes.listChanges({ sessionId: attempt.sessionId, limit: 50 }) : [];
        const verdict = verify({
          verdictOk: attempt.sawDone === true || attempt.code === 0,
          changedFiles: Array.isArray(files) ? files.length : 0,
          hasSession: Boolean(attempt.sessionId),
          remaining: [],
          resultNote: attempt.result ?? null,
          priorAttempts: Number(request.verifyAttempts) || 0,
        });
        // Policy Lab PR0 — settled inbox rows get receipts too, so directly
        // executed requests carry the same runner-observed evidence tasks do.
        const requestReceipt = receiptsModule?.buildReceipt
          ? receiptsModule.buildReceipt({
              attemptId: attempt.runId,
              workItem: { kind: "request", id: null, title: request.title, prompt: request.prompt ?? "" },
              contract: "implementation",
              attempt,
              verdict,
              changedFiles: Array.isArray(files) ? files.length : 0,
              remaining: [],
              evaluator: evaluatorIdentity,
              now,
            })
          : null;
        if (requestReceipt) policyReceipts.push(requestReceipt);
        settled.push({ request, verdict, changedFiles: Array.isArray(files) ? files.length : 0, receiptId: requestReceipt?.id });
      }
      if (settled.length) {
        patch.requests = requests.filter((request) => {
          const hit = settled.find((row) => row.request === request);
          if (!hit) return true;
          const { request: item, verdict } = hit;
          if (verdict.state === "verified") {
            const completed = historyModule.completedRequestTask(item, verdict, { now, changedFiles: hit.changedFiles, receiptId: hit.receiptId });
            if (completed && !tasks.some((task) => task.id === completed.id || (task.lastAttempt?.runId && task.lastAttempt.runId === completed.lastAttempt?.runId))) tasks.push(completed);
            verifyNotes.push(`verified request "${assistantClip(item.title, 60)}"`);
            return false; // evidenced: the inbox row has done its job
          }
          item.verifyAttempts = verdict.attemptNo;
          delete item.status;
          delete item.runId;
          delete item.runningAt;
          delete item.lease;
          item.lastRunError = `verification: ${verdict.reason}`;
          if (verdict.state === "failed") delete item.nextRunAt;
          else item.nextRunAt = now + 60 * 1000;
          verifyNotes.push(`reopened request "${assistantClip(item.title, 60)}" — ${verdict.reason}`);
          return true;
        });
        changedByVerify = true;
      }
      if (changedByVerify) patch.tasks = tasks;
    }
    patch.verifyNotes = verifyNotes;
    patch.policyReceipts = policyReceipts;
    return patch;
  });
  // Policy Lab PR0 — receipts land in the append-only store and a
  // verification event links each attempt to its receipt in the experience
  // log. Fire-and-forget on purpose: a failed append must never fail
  // housekeeping.
  for (const receipt of result.policyReceipts ?? []) {
    if (receiptsModule) receiptsModule.appendReceipt(RECEIPTS_PATH, receipt).catch(() => {});
    policyRecord("verification", {
      attemptId: receipt.attemptId,
      intentKey: receipt.workItem.intentKey,
      receiptId: receipt.id,
      state: receipt.result,
      trust: receipt.trust,
      remaining: receipt.acceptance.remaining,
    });
  }
  const sweep = result.sweeps ?? {};
  for (const note of result.verifyNotes ?? []) logLine(`[autopilot] ${note}`);
  if (sweep.requestsRequeued) logLine(`[autopilot] re-queued ${sweep.requestsRequeued} request(s) whose run was lost`);
  if (sweep.requestsPruned) logLine(`[autopilot] pruned ${sweep.requestsPruned} stale auto request(s)`);
  if (sweep.tasksReopened) logLine(`[autopilot] reopened ${sweep.tasksReopened} task(s) whose run was lost`);
  if (sweep.absorbedRestored || sweep.absorbedArchived) {
    logLine(`[autopilot] groupings: ${sweep.absorbedRestored ?? 0} member(s) restored, ${sweep.absorbedArchived ?? 0} archived`);
  }
  if (result.written?.length) {
    logLine(`[autopilot] housekeeping: ${[`${sweep.tasksReopened ?? 0} reopened`, `${sweep.tasksArchived ?? 0} aged out`, `${sweep.backlogCapped ?? 0} capped`, `${sweep.duplicateTasks ?? 0} duplicate title(s)`, `${sweep.requestsPruned ?? 0} stale request(s)`].join(", ")}`);
  }
  await refreshAutopilotQueue(eyes);
}

// One autopilot tick: proactive pass (brief + audit + collision/fix
// requests), periodic grow/improve expansion, housekeeping, request->task
// promotion, then the executor. A failing pass logs and the timer lives on.
let autopilotPassInFlight = null;
async function autopilotPass() {
  if (projectSwitching) return { ok: true, skipped: "switching project" };
  if (SMOKE || CAPTURE || CLI_MODE || !autopilot.enabled) return;
  if (autopilotPassInFlight) return autopilotPassInFlight;
  autopilotPassInFlight = (async () => {
    try {
      const eyes = await getEyes();
      autopilotTicks += 1;
      let added = 0;
      const pass = await autopilotProactivePass({ useAi: true });
      added += pass?.added ?? 0;
      if (autopilotTicks % 6 === 0) {
        const result = await runAssistant("grow", null);
        if (result.ok) added += await queueRequests(requestsFromExpand(result.briefing, await eyes.readJson(REQUESTS_PATH, []), "grow"));
      }
      if (autopilotTicks % 12 === 0) {
        const result = await runAssistant("improve", null);
        if (result.ok) added += await queueRequests(requestsFromExpand(result.briefing, await eyes.readJson(REQUESTS_PATH, []), "improver"));
      }
      await autopilotHousekeeping();
      await promoteRequestsToTasks();
      const tasks = await eyes.readJson(TASKS_PATH, []);
      autopilot.tasksManaged = tasks.filter((task) => task?.source === "a-eyes").length;
      await refreshAutopilotQueue(eyes);
      autopilot.lastPassAt = Date.now();
      autopilot.lastAdded = added;
      autopilot.lastError = pass?.aiError ?? null;
      pushAutopilotHistory("pass", `${added} queued`);
      emitAutopilot();
      // The pass files requests; the assistant is what hands them out.
      assistantAskForWork("auto builder pass");
    } catch (error) {
      autopilot.lastError = String(error.message ?? error);
      logLine(`[autopilot] pass failed: ${autopilot.lastError}`);
      emitAutopilot();
    }
  })().finally(() => {
    autopilotPassInFlight = null;
  });
  return autopilotPassInFlight;
}

async function setAutopilot(prefs = {}) {
  if (prefs.enabled !== undefined) autopilot.enabled = Boolean(prefs.enabled);
  if (prefs.execute !== undefined) {
    const resuming = !autopilot.execute && prefs.execute;
    autopilot.execute = Boolean(prefs.execute);
    // A manual resume clears the tallies so a tripped breaker starts clean.
    if (resuming) {
      autopilot.consecutiveFailures = 0;
      autopilot.infraFailures = 0;
      autopilot.parkedUntil = 0;
      autopilot.lastError = null;
    }
  }
  if (prefs.minutes !== undefined) autopilot.minutes = Math.max(1, Number(prefs.minutes) || autopilot.minutes);
  if (prefs.parallel !== undefined) autopilot.parallel = Math.min(EXECUTOR_PARALLEL_MAX, Math.max(1, Math.round(Number(prefs.parallel) || autopilot.parallel)));
  // Machine cap (see EXECUTOR_PARALLEL_CAP): a saved 8 or the 4-core floor
  // still collapses into the snapshot-lock wedge on this setup, so the cap
  // applies to every width source, saved preference included.
  autopilot.parallel = Math.min(autopilot.parallel, EXECUTOR_PARALLEL_CAP);
  const settings = await readSettings();
  settings.ui = {
    ...(settings.ui ?? {}),
    autopilot: { enabled: autopilot.enabled, execute: autopilot.execute, minutes: autopilot.minutes, parallel: autopilot.parallel },
  };
  await writeSettings(settings);
  if (proactiveTimer) clearInterval(proactiveTimer);
  proactiveTimer = null;
  if (autopilot.enabled) {
    proactiveTimer = setInterval(() => projects.run(projects.active(), () => autopilotPass()), autopilot.minutes * 60000);
    proactiveTimer.unref?.();
  }
  emitAutopilot();
  // A widened pool has free slots right now — fill them instead of waiting
  // for the next tick or a job to end.
  if (autopilot.enabled && autopilot.execute && autopilot.jobs.length < autopilot.parallel) {
    assistantAskForWork("the pool was widened");
  }
  return { ok: true, ...autopilotStatus() };
}

// The old proactive toggle is the same switch with the executor untouched, so
// the Explorer checkbox and the assistant:proactive IPC keep working.
function setProactive(enabled, minutes = 5) {
  return setAutopilot({ enabled, minutes });
}

// How many build agents the machine can carry at once: one per logical core,
// at least 4, capped at EXECUTOR_PARALLEL_MAX. The old default of 3 was a
// throttle; we want the queue draining as wide as the host can take.
function machineParallelDefault() {
  const cores = Number.isFinite(os?.cpus?.()?.length) && os.cpus().length > 0 ? os.cpus().length : 8;
  return Math.min(EXECUTOR_PARALLEL_MAX, Math.max(4, cores));
}

// Settings may override the defaults (on/on/5m); the first pass runs ~15s
// after the call so the window and watchers settle first. A saved parallel
// width — narrow included — is the operator's setting: the machine default
// only fills an unset value.
async function bootAutopilot() {
  try {
    getPolicyModule().then(warmPolicyBaseline).catch(() => {});
    const settings = await readSettings();
    const saved = settings.ui?.autopilot ?? {};
    const savedWidth = Math.round(Number(saved.parallel));
    await setAutopilot({
      enabled: saved.enabled ?? true,
      execute: saved.execute ?? true,
      minutes: saved.minutes ?? autopilot.minutes,
      parallel: Number.isFinite(savedWidth) && savedWidth >= 1 ? savedWidth : machineParallelDefault(),
    });
    setTimeout(() => projects.run(projects.active(), () => autopilotPass()), 15000).unref?.();
    // A previous session's kills may have left stale snapshot locks; clear
    // aged-out ones before the first run of this session reaches the store.
    sweepSnapshotLocks().catch(() => {});
  } catch (error) {
    logLine(`[autopilot] boot failed: ${error.message}`);
  }
}

async function readSettings() {
  try {
    return JSON.parse(await readFile(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeSettings(next) {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  // Atomic rename so a reader never sees a torn settings document.
  const payload = JSON.stringify({ ...next, projects: projects.saved() }, null, 2);
  const tmp = `${SETTINGS_PATH}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, payload);
    try {
      await rename(tmp, SETTINGS_PATH);
    } catch {
      await writeFile(SETTINGS_PATH, payload);
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

function send(channel, payload) {
  if (projects.current().id !== projects.active().id && (channel.startsWith("eyes:") || channel === "assistant:status")) return;
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function logLine(line) {
  send("studio:log", String(line).replace(/\r?\n$/, ""));
}

function streamChild(child, label) {
  activeChild = child;
  logLine(`[${label}] started pid ${child.pid}`);
  const wire = (stream) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) logLine(line);
    });
    stream.on("end", () => {
      if (buffer.trim()) logLine(buffer);
    });
  };
  if (child.stdout) wire(child.stdout);
  if (child.stderr) wire(child.stderr);
  child.on("close", (code) => {
    logLine(`[${label}] exited with code ${code}`);
    send("studio:exit", { code });
    if (activeChild === child) activeChild = null;
  });
  child.on("error", (error) => logLine(`[${label}] failed: ${error.message}`));
}

function runLove(label, args) {
  if (!GAME_ROOT) return { ok: false, error: "Set MEFI_STUDIO_GAME_ROOT to a Ruins Runner checkout to use the LÖVE launcher." };
  if (!existsSync(LOVE_EXE)) {
    logLine(`LÖVE runtime missing at ${LOVE_EXE}. Run: powershell -ExecutionPolicy Bypass -File "${path.join(GAME_ROOT, "tools", "build-windows.ps1")}"`);
    return { ok: false, error: "love runtime missing" };
  }
  const child = spawn(LOVE_EXE, args, { cwd: GAME_ROOT, windowsHide: false });
  streamChild(child, label);
  return { ok: true };
}

function runCmd(label, command) {
  const child = spawn("cmd.exe", ["/d", "/s", "/c", command], { cwd: GAME_ROOT, windowsHide: false });
  streamChild(child, label);
  return { ok: true };
}

function runGameScript(label, name, args = "") {
  if (!GAME_ROOT) return { ok: false, error: "Set MEFI_STUDIO_GAME_ROOT to a Ruins Runner checkout to use the game launcher." };
  const script = path.join(GAME_ROOT, name);
  if (!existsSync(script)) return { ok: false, error: `game launcher missing at ${script}` };
  return runCmd(label, `"${script}"${args ? ` ${args}` : ""}`);
}

async function runSpeedProbe(modelId) {
  const settings = await readSettings();
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  if (String(modelId).startsWith("glm-")) {
    const zaiKey = decryptKey(settings, "zaiApiKeyEncrypted");
    if (!zaiKey) return { ok: false, error: "no z.ai key saved" };
    env.ZAI_API_KEY = zaiKey;
  } else {
    const goKey = decryptKey(settings, "apiKeyEncrypted");
    if (!goKey) return { ok: false, error: "no API key saved" };
    env.OPENCODE_GO_API_KEY = goKey;
    env.OPENCODE_GO_SESSION = await assistantSessionId();
  }
  const script = path.join(STUDIO_ROOT, "scripts", "measure-speed.mjs");
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--model", modelId], { cwd: STUDIO_ROOT, env });    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", async (code) => {
      for (const line of output.split(/\r?\n/)) if (line.trim()) logLine(`[speed] ${line}`);
      if (code === 0) {
        try {
          const measurement = JSON.parse(output.slice(output.indexOf("{")));
          const measurementsPath = path.join(STUDIO_ROOT, "data", "speed-measurements.json");
          let all = {};
          try {
            all = JSON.parse(await readFile(measurementsPath, "utf8"));
          } catch {}
          all[modelId] = measurement;
          await writeFile(measurementsPath, JSON.stringify(all, null, 2));
        } catch (error) {
          logLine(`[speed] could not persist measurement: ${error.message}`);
        }
      }
      resolve({ ok: code === 0, output });
    });
  });
}

// The ideas pass is an incremental ingestion stage, not a re-creation stage.
// A durable cursor (data/eyes-ingest.json) records how far chat material has
// been consumed: each scan reads only rows newer than the cursor, and the
// cursor advances only after the pass fully succeeded — a failed AI call
// leaves the window for the next pass to retry (harmless: the delta merge
// dedupes reprocessing). It also reads the store once to learn what already
// exists, collects only ADDITIONS, and then — after the AI call, which can
// take a while — re-reads the store inside the board lock and applies the
// validated delta (assistant.mergeIdeas). The old version held the whole
// array across the model call and wrote its stale copy back afterwards,
// wiping any `planned` stamp the compactor had landed in the meantime: the
// same ideas became fresh, promotable work again on the next pass.
//
// The AI review (ai=true) is also a board pass: inside the same locked write
// it runs the compactor's rules over the tasks it just reviewed — duplicate
// tasks collapse, loose ideas fold into plans — and hands the model's
// taskGroups to compact(), which folds near-duplicate open tasks into plan
// tasks the local title keys could never see. A quiet store does not skip the
// review: the button's whole point is tidying the pile that is already there.
const INGEST_PATH = path.join(STUDIO_ROOT, "data", "eyes-ingest.json");
async function scanIdeasInternal(ai = false, entry = null) {
  const eyes = await getEyes();
  const reference = await getReference();
  const cursorStore = await eyes.readJson(INGEST_PATH, { chat: { lastAt: 0 } }).catch(() => ({ chat: { lastAt: 0 } }));
  const chatCursor = Math.max(0, Number(cursorStore?.chat?.lastAt) || 0);
  const chatCursorId = chatCursor > 0 ? String(cursorStore?.chat?.lastId ?? "") : "";
  let chats = [];
  let listError = null;
  try {
    // Keyset continuation, oldest-first: the cursor is the (timestamp, part
    // id) of the last consumed row, so a page never skips the rows below it
    // the way the old newest-first `> maxTimestamp` read did.
    chats = eyes.listChatTexts({ after: { at: chatCursor > 0 ? chatCursor : Date.now() - 48 * 3600 * 1000, id: chatCursorId }, order: "asc" });
  } catch (error) {
    // No OpenCode store: a plain scan has nothing to ingest, but an AI review
    // goes on to the board pass, which never needed the store.
    listError = String(error.message ?? error);
  }
  // Fresh material only — a quiet store means the ingestion is a no-op and the
  // loop stays idle instead of rediscovering old notes to fill slots.
  const newMaterial = chats.length > 0;
  assistantCache.ingest = { at: Date.now(), scanned: chats.length, newMaterial };
  if (!newMaterial && !ai) {
    const store = await eyes.readJson(IDEAS_PATH, []);
    if (listError) return { ok: false, error: listError, added: 0, aiError: null, scanned: 0, ideas: store };
    return { ok: true, added: 0, aiError: null, scanned: 0, newMaterial: false, ideas: store.slice(0, 400), text: "no new chat material since the last scan" };
  }
  const found = listError ? [] : reference.scanIdeas(chats);
  // The model sees the existing registry (titles), so it can suppress
  // paraphrases of known ideas instead of re-minting them.
  const knownTitles = (await eyes.readJson(IDEAS_PATH, [])).map((idea) => String(idea?.title ?? "")).filter(Boolean).slice(0, 60);
  const additions = [];
  const sourceKeyOf = (idea) =>
    String(idea?.sourceKey ?? idea?.detail ?? idea?.title ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 140) || null;
  const pushAddition = (idea, source) => {
    if (!idea || !String(idea.title ?? "").trim()) return;
    const sourceKey = sourceKeyOf(idea);
    additions.push({
      id: `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: String(idea.title).slice(0, 90),
      detail: String(idea.detail ?? "").slice(0, 300),
      tags: Array.isArray(idea.tags) ? idea.tags.slice(0, 4) : [],
      source,
      ...(sourceKey ? { sourceKey } : {}),
      sessionId: idea.sessionId ?? null,
      sourceAt: idea.at ?? null,
      extraction: 2,
      at: idea.at ?? Date.now(),
      read: false,
      status: "new",
    });
  };
  for (const idea of found) pushAddition(idea, "chat");
  let aiError = listError;
  let taskGroups = [];
  if (ai) {
    // The review also sees the live board, so it can group open tasks into
    // plans. Only what the model may fold goes out: open, unclaimed, not
    // already a plan.
    const openTasks = (await eyes.readJson(TASKS_PATH, []))
      .filter((task) => task && task.status === "open" && !task.runId && !String(task.id ?? "").startsWith("task_plan_"))
      .slice(0, 40)
      .map((task) => ({ title: String(task.title ?? "").slice(0, 90), detail: String(task.prompt ?? "").slice(0, 120) }));
    const payload = JSON.stringify({ candidates: found.slice(0, 40), existingTitles: knownTitles, openTasks }).slice(0, 12000);
    const call = await assistantFetch(ASSISTANT_IDEAS_SYSTEM, payload, 6000);
    if (!call.ok) aiError = call.error || aiError;
    else {
      try {
        const start = call.text.indexOf("{");
        const end = call.text.lastIndexOf("}");
        const parsed = JSON.parse(call.text.slice(start, end + 1));
        for (const idea of parsed.ideas ?? []) pushAddition(idea, "ai");
        if (!Array.isArray(parsed.ideas) || !parsed.ideas.length) assistantLog("ideas", "AI scan: nothing new worth recording");
        taskGroups = Array.isArray(parsed.taskGroups) ? parsed.taskGroups.filter((group) => group && typeof group === "object") : [];
        if (taskGroups.length) assistantLog("ideas", `AI review: ${taskGroups.length} task group(s) to fold into plans`);
      } catch {
        aiError = "could not parse AI ideas";
      }
    }
  }
  // Apply the additions as a delta on the LATEST store — never as a whole-file
  // overwrite with a snapshot taken before the AI call. The AI review then
  // compacts the board in the SAME locked write, held tasks stamped first
  // exactly like the compactor role does, so a live claim never becomes a
  // casualty; a failed AI call still gets the local compaction, only the
  // model's grouping is lost.
  const result = await mutateBoard((board) => {
    const merged = assistantModule?.mergeIdeas
      ? assistantModule.mergeIdeas(board.ideas, additions)
      : { ideas: [...additions, ...board.ideas], added: additions.length };
    board.ideas = merged.ideas;
    let report = null;
    if (ai && assistantModule?.compact) {
      const heldTasks = new Set(autopilot.jobs.map((job) => job.taskId).filter(Boolean));
      const stamped = board.tasks.map((task) => (task && heldTasks.has(task.id) ? { ...task, runId: task.runId ?? "live" } : task));
      const out = assistantModule.compact({ requests: board.requests, tasks: stamped, ideas: board.ideas, collisions: assistantCache.store?.collisions, now: Date.now(), taskGroups });
      board.requests = out.requests;
      board.ideas = out.ideas;
      // Strip the view-only stamp from tasks that were held but carry no real
      // run id (their claim write had not landed when the board was read).
      board.tasks = heldTasks.size
        ? out.tasks.map((task) => {
            if (!task || task.runId !== "live" || !heldTasks.has(task.id)) return task;
            const { runId, ...rest } = task;
            return rest;
          })
        : out.tasks;
      report = out.report ?? null;
    }
    return { ideas: board.ideas, added: merged.added, report };
  });
  const added = result.added ?? 0;
  // The window is consumed only once the pass fully landed: an AI failure
  // keeps the cursor where it was so the next pass retries the same material.
  // "Source ingested" and "AI extraction completed" are deliberately the same
  // gate here — the cursor never advances past material the pass did not
  // finish reviewing.
  if (!aiError) {
    const nextCursor = assistantModule?.advanceCursor
      ? assistantModule.advanceCursor(chats, { at: chatCursor, id: chatCursorId })
      : {
          at: Math.max(chatCursor, ...chats.map((row) => row?.at ?? 0)),
          id: chatCursorId,
        };
    if (nextCursor.at > chatCursor || (nextCursor.at === chatCursor && nextCursor.id !== chatCursorId && nextCursor.at > 0)) {
      await eyes
        .writeJson(INGEST_PATH, { chat: { lastAt: nextCursor.at, lastId: nextCursor.id ?? "", extraction: 2, at: Date.now() } })
        .catch(() => {});
    }
  }
  const store = result.ideas;
  if (entry) {
    const scanned = [...new Set(found.map((idea) => idea.sessionId).filter(Boolean))];
    try {
      if (!assistantCache.store) assistantCache.store = { sessions: eyes.listSessions({ limit: 40 }), todos: [], collisions: [], presence: [], uncommitted: [], at: Date.now() };
    } catch {}
    await assistantVisit(entry, scanned.map(sessionTarget), (target) => `scanned "${assistantSessionTitle(target.id)}"`);
  }
  const ingestText = added
    ? `${added} new idea(s) from ${found.length} candidate(s)`
    : newMaterial
      ? "no new ideas worth recording"
      : "no new chat material since the last scan";
  const reportText = result.report?.text ?? null;
  const text = ai && reportText ? `${ingestText} · board: ${reportText}` : ingestText;
  return { ok: true, added, aiError, scanned: found.length, newMaterial, ideas: store.slice(0, 400), text };
}

async function analyzerAi(kind, payload) {
  const user = JSON.stringify({ kind, payload }).slice(0, 14000);
  const call = await assistantFetch(ASSISTANT_ANALYZER_SYSTEM, user, 6000, { role: "heavy" });
  if (!call.ok) return { ok: false, error: call.error };
  try {
    const start = call.text.indexOf("{");
    const end = call.text.lastIndexOf("}");
    return { ok: true, result: JSON.parse(call.text.slice(start, end + 1)) };
  } catch {
    return { ok: true, result: { summary: call.text.slice(0, 300), features: [], ideas: [], content: [], gaps: [] } };
  }
}

async function gatherReferences({ text, useWeb = false, useTree = true, useIdeas = true }) {
  try {
    const eyes = await getEyes();
    const analyzer = await getAnalyzer();
    const reference = await getReference();
    const analysis = await analyzer.verifyIdea(text, { root: projectRoot() });
    const sessions = eyes.listSessions();
    const chats = useTree ? eyes.listChatTexts({ limit: 200 }) : [];
    const pngs = await eyes.listPngs({ roots: [path.join(projectRoot(), "tools", "logs")], limit: 10 });
    const web = useWeb ? await reference.webSearch(text) : [];
    const ideas = useIdeas ? await eyes.readJson(IDEAS_PATH, []) : [];
    const references = reference.referencesFor({ text, analysis, sessions, chats, pngs, web, ideas });
    return { ok: true, references, text: `${Array.isArray(references) ? references.length : 0} reference(s)` };
  } catch (error) {
    return { ok: false, error: String(error.message ?? error) };
  }
}

function projectBusyReason() {
  if (projectSwitching) return "A project switch is already in progress.";
  if (autopilot.jobs.length) return `Finish or stop the ${autopilot.jobs.length} running build(s) before switching projects.`;
  if (projectOperations || projectAgentJobs || pool.running.size || pool.queue.length || assistantTickInFlight || assistantTickDemand || autopilotPassInFlight || executorFillInFlight) return "The assistant is finishing work in this project. Pause it, let the current work finish, then switch.";
  if (projectBoardWrites || assistantWriting || assistantLoading || machineReadInFlight) return "Saving this project's work. Try switching again in a moment.";
  return null;
}

async function selectProject(id) {
  if (id === projects.active().id) return projects.list();
  const busy = projectBusyReason();
  if (busy) return { ...projects.list(), ok: false, error: busy };
  const next = projects.find(id);
  if (!next) return { ...projects.list(), ok: false, error: "Choose a project from your project list." };
  try { if (!statSync(next.path).isDirectory()) throw new Error(); }
  catch { return { ...projects.list(), ok: false, error: "That project folder is unavailable. Reconnect it before switching." }; }
  projectSwitching = true;
  const previous = projects.active();
  const previousState = assistantState;
  try {
    if (assistantTimer) clearTimeout(assistantTimer);
    if (assistantSaveTimer) clearTimeout(assistantSaveTimer);
    if (assistantEmitTimer) clearTimeout(assistantEmitTimer);
    assistantTimer = assistantSaveTimer = assistantEmitTimer = null;
    assistantEmitPending = null;
    if (assistantState) await projects.run(previous, () => assistantWrite());
    await mkdir(path.dirname(projects.dataPath(TASKS_PATH, next)), { recursive: true });
    projects.select(id);
    assistantState = null;
    assistantPending = null;
    assistantSavedAt = 0;
    machineReadCache = null;
    eyesLastTs = Date.now();
    for (const key of Object.keys(assistantCache)) delete assistantCache[key];
    Object.assign(assistantCache, { store: null, storeError: null, machine: null, audit: null, chats: [], chatsAt: 0, porcelain: "", porcelainAt: 0 });
    await projects.run(next, () => ensureAssistant());
    assistantState.projectId = next.id;
    assistantState.projectPath = next.path;
    autopilot.queueDepth = 0;
    autopilot.tasksManaged = 0;
    autopilot.history = [];
    autopilot.lastAsk = null;
    autopilot.waiting = null;
    autopilot.lastError = null;
    autopilot.consecutiveFailures = autopilot.infraFailures = autopilot.parkedUntil = 0;
    await writeSettings(await readSettings());
    const eyes = await getEyes();
    const [tasks, requests, ideas] = await Promise.all([eyes.readJson(TASKS_PATH, []), eyes.readJson(REQUESTS_PATH, []), eyes.readJson(IDEAS_PATH, [])]);
    send("projects:changed", projects.list());
    send("eyes:tasks", tasks);
    send("eyes:requests", requests);
    send("eyes:ideas", ideas);
    send("eyes:assistant", { state: assistantState, event: { kind: "project", text: `Ready in ${next.name}.`, projectId: next.id } });
    emitAutopilot();
    return projects.list();
  } catch (error) {
    projects.select(previous.id);
    assistantState = previousState;
    return { ...projects.list(), ok: false, error: `Could not switch projects: ${error.message}` };
  } finally {
    projectSwitching = false;
    if (assistantLoop) projects.run(projects.active(), () => assistantSchedule());
  }
}

function registerIpc() {
  ipcMain.handle("projects:list", () => projects.list());
  ipcMain.handle("projects:add", async () => {
    try {
      const picked = await dialog.showOpenDialog(window, { title: "Add a project folder", properties: ["openDirectory"] });
      if (picked.canceled || !picked.filePaths?.[0]) return { ...projects.list(), canceled: true };
      const added = projects.add(picked.filePaths[0]);
      await writeSettings(await readSettings());
      const result = { ...projects.list(), addedId: added.id };
      send("projects:changed", result);
      return result;
    } catch (error) { return { ...projects.list(), ok: false, error: error.message }; }
  });
  ipcMain.handle("projects:select", (_event, id) => selectProject(id));
  ipcMain.handle("tasks:create", async (_event, { title, prompt, projectId } = {}) => {
    if (projectId && projectId !== projects.current().id) return { ok: false, error: "The selected project changed. Add this task again in its intended project." };
    if (!String(title ?? "").trim()) return { ok: false, error: "Give your task a title." };
    await ensureAssistant();
    const task = await assistantCreateTask({ title, prompt: prompt ?? title, source: "chat", pin: true });
    const eyes = await getEyes();
    const tasks = await eyes.readJson(TASKS_PATH, []);
    if (!task) return { ok: false, error: "An unfinished task with this title already exists.", tasks, projectId: projects.current().id };
    assistantAskForWork("you added a task");
    return { ok: true, task, tasks, projectId: projects.current().id };
  });
  ipcMain.handle("catalog:read", async () => {
    const dataDir = path.join(STUDIO_ROOT, "data");
    // The catalog is committed, so a fresh clone already has it. If it is ever
    // deleted or torn, `npm run data` regenerates it from curated + the roster.
    return JSON.parse(await readFile(path.join(dataDir, "models.json"), "utf8"));
  });

  ipcMain.handle("catalog:refresh", async () => {
    const script = path.join(STUDIO_ROOT, "scripts", "refresh-models.mjs");
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [script], {
        cwd: STUDIO_ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.on("close", (code) => {
        for (const line of output.split(/\r?\n/)) if (line.trim()) logLine(`[refresh] ${line}`);
        resolve({ ok: code === 0, code, output });
      });
    });
  });

  ipcMain.handle("studio:launch", () => {
    if (!GAME_ROOT) return { ok: false, error: "Set MEFI_STUDIO_GAME_ROOT to a Ruins Runner checkout to use the LÖVE launcher." };
    if (!existsSync(path.join(DEV_PROJECT, "main.lua"))) {
      return { ok: false, error: `dev tool project missing at ${DEV_PROJECT}` };
    }
    return runLove("studio", [DEV_PROJECT]);
  });

  ipcMain.handle("studio:smoke", () => runGameScript("smoke", "Run Dev Tool (LOVE2D).cmd", "--smoke"));

  // ---- Coding CLIs ---------------------------------------------------------
  // OpenCode, Codex and Claude Code are the owner's installed tools; Codex and
  // Claude launch on their own existing accounts. OpenCode additionally gets a
  // Studio-managed "mefi-zai" provider (config injected per process via env,
  // key never written to disk) so GLM work bills the z.ai plan, not OpenCode.
  const CODING_CLIS = [
    { id: "opencode", name: "OpenCode", cmd: "opencode" },
    { id: "grok", name: "Grok", cmd: "grok" },
    { id: "codex", name: "Codex", cmd: "codex" },
    { id: "claude", name: "Claude Code", cmd: "claude" },
  ];

  ipcMain.handle("studio:cli-status", async () =>
    Promise.all(
      CODING_CLIS.map(
        (cli) =>
          new Promise((resolve) => {
            const child = spawn("where.exe", [cli.cmd], { windowsHide: true });
            let first = null;
            child.stdout.on("data", (chunk) => {
              if (!first) first = String(chunk).split(/\r?\n/)[0];
            });
            child.on("error", () => resolve({ id: cli.id, name: cli.name, installed: false, source: null }));
            child.on("close", (code) => resolve({ id: cli.id, name: cli.name, installed: code === 0 && Boolean(first), source: first }));
          })
      )
    )
  );

  ipcMain.handle("studio:launch-cli", async (_event, id) => {
    const cli = CODING_CLIS.find((item) => item.id === id);
    if (!cli) return { ok: false, error: `unknown cli: ${id}` };
    const env = { ...process.env };
    if (cli.id === "opencode") {
      const zaiEnv = await zaiOpencodeEnv();
      if (zaiEnv) {
        Object.assign(env, zaiEnv);
        logLine("[opencode] mefi-zai provider active (z.ai GLM on your coding plan)");
      } else {
        logLine("[opencode] no z.ai key saved — launching without the mefi-zai provider");
      }
    }
    const child = spawn("cmd.exe", ["/d", "/s", "/c", "start", `Mefi ${cli.name}`, "cmd", "/k", cli.cmd], {
      cwd: projectRoot(),
      env,
      windowsHide: false,
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (error) => logLine(`[${cli.id}] launch failed: ${error.message}`));
    child.unref();
    logLine(`[${cli.id}] opened in a new terminal window (${projectRoot()})`);
    return { ok: true };
  });

  ipcMain.handle("studio:test-zai", async () => {
    const zaiEnv = await zaiOpencodeEnv();
    if (!zaiEnv) {
      logLine("[zai] no z.ai key saved - add one in the Studio tab first");
      return { ok: false, error: "no z.ai key saved" };
    }
    const output = await new Promise((resolve) => {
      const child = spawn("cmd.exe", ["/d", "/s", "/c", "opencode models mefi-zai"], {
        cwd: projectRoot(),
        env: { ...process.env, ...zaiEnv },
        windowsHide: true,
      });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      child.on("error", (error) => resolve(`spawn failed: ${error.message}`));
      child.on("close", (code) => resolve(`${out.trim()}\n[exit ${code}]`));
    });
    for (const line of output.split(/\r?\n/)) if (line.trim()) logLine(`[zai] ${line}`);
    return { ok: true, output };
  });

  ipcMain.handle("studio:game", () => runGameScript("game", "Run Game (LOVE2D).cmd"));

  ipcMain.handle("studio:stop", () => {
    if (!activeChild) return { ok: true, stopped: false };
    spawn("taskkill", ["/pid", String(activeChild.pid), "/t", "/f"]);
    logLine("stop requested");
    return { ok: true, stopped: true };
  });

  const keyFieldFor = (which) => (which === "zai" ? "zaiApiKeyEncrypted" : which === "gateway" ? "gatewayApiKeyEncrypted" : "apiKeyEncrypted");

  ipcMain.handle("settings:get-key", async (_event, which = "opencode") => {
    const settings = await readSettings();
    // Status only — a saved key never crosses IPC back to the renderer.
    return { saved: Boolean(decryptKey(settings, keyFieldFor(which))), encrypted: safeStorage.isEncryptionAvailable() };
  });

  ipcMain.handle("settings:set-key", async (_event, apiKey, which = "opencode") => {
    const settings = await readSettings();
    const field = keyFieldFor(which);
    if (!apiKey) delete settings[field];
    else if (safeStorage.isEncryptionAvailable()) settings[field] = safeStorage.encryptString(apiKey).toString("base64");
    else return { ok: false, error: "OS encryption unavailable" };
    await writeSettings(settings);
    if (which === "gateway") (await getJevQueue()).wake();
    return { ok: true };
  });

  ipcMain.handle("jev:status", () => jevStatus());
  ipcMain.handle("jev:probe", () => probeJev());
  ipcMain.handle("jev:set-enabled", async (_event, enabled) => {
    const settings = await readSettings();
    settings.jevShadow = enabled === true;
    await writeSettings(settings);
    (await getJevQueue()).wake();
    return jevStatus();
  });

  ipcMain.handle("settings:get-ai-routing", async () => {
    const settings = await readSettings();
    return {
      provider: AI_PROVIDERS.includes(settings.aiProvider) ? settings.aiProvider : "auto",
      fallbackOpenCode: settings.aiFallbackOpenCode === true,
      hasZai: Boolean(settings.zaiApiKeyEncrypted),
      hasOpenCode: Boolean(settings.apiKeyEncrypted),
      // The assistant's own model, per role — empty means the route default.
      models: {
        routine: String(settings.aiModels?.routine ?? ""),
        heavy: String(settings.aiModels?.heavy ?? ""),
      },
      // Who runs the executor's build jobs (opencode, or the grok CLI).
      executorCli: settings.executorCli === "grok" ? "grok" : "opencode",
      executorModel: String(settings.executorModel ?? ""),
    };
  });

  ipcMain.handle("settings:set-ai-routing", async (_event, patch = {}) => {
    const settings = await readSettings();
    if (patch.provider !== undefined) {
      if (!AI_PROVIDERS.includes(patch.provider)) return { ok: false, error: `unknown provider: ${patch.provider}` };
      settings.aiProvider = patch.provider;
    }
    if (patch.fallbackOpenCode !== undefined) settings.aiFallbackOpenCode = Boolean(patch.fallbackOpenCode);
    // Model overrides: free-text ids, trimmed; empty string resets to the
    // route default. The models list drifts weekly, so nothing is validated
    // against a closed set.
    if (patch.models !== undefined && typeof patch.models === "object") {
      const models = settings.aiModels && typeof settings.aiModels === "object" ? settings.aiModels : {};
      for (const role of ["routine", "heavy"]) {
        if (patch.models[role] !== undefined) models[role] = String(patch.models[role] ?? "").trim().slice(0, 120);
      }
      settings.aiModels = models;
    }
    if (patch.executorCli !== undefined) {
      if (!["opencode", "grok"].includes(patch.executorCli)) return { ok: false, error: `unknown executor cli: ${patch.executorCli}` };
      settings.executorCli = patch.executorCli;
    }
    if (patch.executorModel !== undefined) settings.executorModel = String(patch.executorModel ?? "").trim().slice(0, 120);
    await writeSettings(settings);
    return { ok: true };
  });

  ipcMain.handle("speed:probe", async (_event, { modelId }) => runSpeedProbe(modelId));

  ipcMain.handle("speed:measurements-read", async () => {
    try {
      return { ok: true, measurements: JSON.parse(await readFile(path.join(STUDIO_ROOT, "data", "speed-measurements.json"), "utf8")) };
    } catch {
      return { ok: true, measurements: {} };
    }
  });

  ipcMain.handle("eyes:pick-png", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Open evidence PNG",
      properties: ["openFile"],
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle("shell:open", (_event, url) => shell.openExternal(url));
  ipcMain.handle("shell:reveal", (_event, filePath) => {
    if (filePath) shell.showItemInFolder(String(filePath));
    return { ok: true };
  });
  ipcMain.handle("shell:copy", (_event, text) => {
    clipboard.writeText(String(text ?? ""));
    return { ok: true };
  });

  // ---- A-Eyes -------------------------------------------------------------
  ipcMain.handle("eyes:state", async (_event, { sessionId = null } = {}) => {
    try {
      const eyes = await getEyes();
      const sessions = eyes.listSessions();
      const changes = eyes.listChanges({ sessionId, limit: 300 });
      const todos = eyes.listTodos();
      const pngs = await eyes.listPngs({ roots: [path.join(projectRoot(), "tools", "logs")] });
      return { ok: true, sessions, changes, todos, pngs };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("eyes:changes", async (_event, { sessionId = null } = {}) => {
    try {
      const eyes = await getEyes();
      return { ok: true, changes: eyes.listChanges({ sessionId, limit: 300 }) };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("eyes:todos", async () => {
    try {
      const eyes = await getEyes();
      return { ok: true, todos: eyes.listTodos() };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("eyes:log", async (_event, { lines = 220 } = {}) => {
    try {
      const eyes = await getEyes();
      return { ok: true, text: await eyes.tailLog({ lines }) };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("eyes:pins-read", async () => {
    try {
      const eyes = await getEyes();
      return { ok: true, pins: await eyes.readPins(PINS_PATH) };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("eyes:pins-write", async (_event, pins) => {
    try {
      const eyes = await getEyes();
      return await eyes.writePins(PINS_PATH, pins);
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("eyes:watch", async (_event, { running } = {}) => (running === false ? stopEyesWatch() : startEyesWatch()));

  // ---- A-Eyes explorer: requests, checkpoints, briefing, assistant ---------
  ipcMain.handle("eyes:requests-read", async () => {
    const eyes = await getEyes();
    return { ok: true, requests: await eyes.readJson(REQUESTS_PATH, []) };
  });
  ipcMain.handle("eyes:requests-write", async (_event, requests) => {
    const next = Array.isArray(requests) ? requests : [];
    if (next.some((row) => row?.projectId && row.projectId !== projects.current().id)) return { ok: false, error: "These requests belong to another project. Reload before saving." };
    // Serialized with every other board writer so a renderer save cannot
    // land between a claim's read and write on the host side.
    await withBoardLock(async () => {
      const eyes = await getEyes();
      await eyes.writeJson(REQUESTS_PATH, next);
    });
    send("eyes:requests", next);
    return { ok: true };
  });
  ipcMain.handle("eyes:checkpoints-read", async () => {
    const eyes = await getEyes();
    return { ok: true, checkpoints: await eyes.readJson(CHECKPOINTS_PATH, {}) };
  });
  ipcMain.handle("eyes:briefing-read", async () => {
    const eyes = await getEyes();
    return { ok: true, briefing: await eyes.readJson(BRIEFING_PATH, null) };
  });
  ipcMain.handle("eyes:collisions", async () => {
    try {
      const eyes = await getEyes();
      return {
        ok: true,
        collisions: eyes.collisions({ root: projectRoot() }),
        // Solo live editors sit beside collisions so the collateral watch can
        // steer around a file before a second session turns it into a clash.
        presence: eyes.filePresence({ root: projectRoot() }),
      };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("assistant:run", async (_event, { mode = "brief", sessionId = null, payload = null } = {}) =>
    assistantDemand(ASSISTANT_RUN_ROLES[mode] ?? "briefer", assistantRunJob(mode, sessionId, payload), {
      ai: true,
      key: `run:${mode}:${sessionId ?? ""}`,
      work: { kind: ASSISTANT_RUN_KINDS.has(mode) ? mode : "brief", sessionId, payload: { args: payload }, text: sessionId ?? "" },
      targets: assistantRunTargets(mode, sessionId),
    })
  );
  // The explorer's legacy switch: it sets the service pref and steers the
  // A-Eyes autopilot timer with it, so one toggle moves both halves.
  ipcMain.handle("assistant:proactive", async (_event, { enabled, minutes } = {}) => {
    const result = await assistantSetPrefs({ proactive: enabled !== false });
    const status = await setProactive(enabled !== false, minutes ?? autopilot.minutes);
    return { ok: true, enabled: result.state.prefs.proactive, minutes: status.minutes, state: result.state, status };
  });
  // A-Eyes autopilot: main's timer/executor switch. It moves prefs.proactive
  // too, so the assistant card and the autopilot panel never disagree.
  ipcMain.handle("assistant:autopilot", async (_event, prefs) => {
    const status = await setAutopilot(prefs ?? {});
    if (prefs?.enabled !== undefined) await assistantSetPrefs({ proactive: Boolean(prefs.enabled) });
    return status;
  });
  ipcMain.handle("assistant:status", () => ({ ok: true, status: autopilotStatus() }));

  // ---- the assistant service: state, thread, controls, prefs ---------------
  ipcMain.handle("assistant:state", async () => ({ ok: true, state: await ensureAssistant() }));
  ipcMain.handle("assistant:message", async (_event, { text, projectId } = {}) => {
    if (projectId && projectId !== projects.current().id) return { ok: false, error: "The selected project changed. Send your message again in its intended project." };
    return assistantMessage(text);
  });
  // Work on it: the node becomes the assistant's next piece of work — pinned,
  // threaded, and dispatched on the spot.
  ipcMain.handle("assistant:work-on", async (_event, target) => assistantWorkOn(target ?? {}));
  ipcMain.handle("assistant:focus", async (_event, target) => assistantFocus(target ?? null));
  // A node's folder: save the owner's note on it, or clear the folder now
  // (the keeper is the one that cleans finished nodes on its own cadence).
  ipcMain.handle("assistant:node-context", async (_event, payload = {}) => {
    await ensureAssistant();
    const target = payload?.target ?? null;
    try {
      if (payload.clear) {
        if (!assistantModule?.clearNodeFolder) return { ok: false, error: "assistant logic unavailable", state: assistantState };
        assistantState = assistantModule.clearNodeFolder(assistantState, target);
        assistantLog("control", `cleared the context folder on ${target?.kind ?? "?"} "${assistantClip(String(target?.id ?? ""), 40)}"`, { target });
      } else {
        const text = String(payload?.text ?? "").trim();
        if (!text) return { ok: false, error: "empty note", state: assistantState };
        assistantNodeContext(target, "note", text.slice(0, 400), "owner");
        assistantLog("control", `saved a note on ${target?.kind ?? "?"} "${assistantClip(String(target?.id ?? ""), 40)}"`, { target });
      }
      await saveAssistant({ force: true });
      return { ok: true, state: assistantState };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error), state: assistantState };
    }
  });
  ipcMain.handle("assistant:control", async (_event, { action } = {}) => assistantControl(action));
  ipcMain.handle("assistant:prefs", async (_event, patch) => {
    const result = await assistantSetPrefs(patch ?? {});
    // The Proactive pref is the autopilot's own switch; keep them in step.
    if (patch?.proactive !== undefined) await setAutopilot({ enabled: Boolean(patch.proactive) });
    return result;
  });

  ipcMain.handle("auditor:run", async () => {
    const settings = await readSettings();
    const withAi = Boolean(settings.apiKeyEncrypted || settings.zaiApiKeyEncrypted) && safeStorage.isEncryptionAvailable();
    return assistantDemand(
      "auditor",
      async () => {
        const auditor = await getAuditor();
        const local = await auditor.audit();
        const eyes = await getEyes();
        const queued = await queueRequests(auditor.auditRequests(local, await requestBaseline(eyes)));
        const ai = withAi ? await runAssistant("audit", null) : null;
        return {
          ok: local.ok,
          errors: local.errors,
          warnings: local.warnings,
          findings: local.findings,
          queued,
          ai,
          checkedAt: local.checkedAt,
          text: `${local.errors} error(s) · ${local.warnings} warning(s)`,
        };
      },
      { ai: withAi, key: "auditor:ui", work: { kind: "audit", text: "" } }
    );
  });

  ipcMain.handle("checkpoint:add", async (_event, { sessionId, note } = {}) => {
    if (!sessionId || !note) return { ok: false, error: "sessionId and note required" };
    const eyes = await getEyes();
    const store = await eyes.readJson(CHECKPOINTS_PATH, {});
    const list = store[sessionId] ?? [];
    const pngs = await eyes.listPngs({ roots: [path.join(projectRoot(), "tools", "logs")], limit: 1 });
    const files = eyes
      .listChanges({ sessionId, limit: 6 })
      .map((change) => change.file)
      .filter(Boolean);
    list.unshift({
      note: String(note).slice(0, 240),
      at: Date.now(),
      source: "manual",
      files: [...new Set(files)],
      png: pngs[0]?.path ?? null,
    });
    store[sessionId] = list.slice(0, 50);
    await eyes.writeJson(CHECKPOINTS_PATH, store);
    send("eyes:checkpoints", store);
    return { ok: true, checkpoints: store };
  });

  ipcMain.handle("analyzer:run", async (_event, { kind, path: filePath, text } = {}) => {
    try {
      const analyzer = await getAnalyzer();
      if (kind === "file" && filePath) return { ok: true, result: await analyzer.analyzeFile(filePath, { root: projectRoot() }) };
      if (kind === "idea" && text) return { ok: true, result: await analyzer.verifyIdea(text, { root: projectRoot() }) };
      return { ok: false, error: "kind must be file|idea with path/text" };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("analyzer:pick", async () => {
    const result = await dialog.showOpenDialog(window, { title: "Analyze a file", properties: ["openFile"] });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle("analyzer:ai", async (_event, { kind, payload } = {}) =>
    assistantDemand("reference", () => analyzerAi(kind, payload), {
      ai: true,
      key: `analyzer:${kind}:${crypto.createHash("sha1").update(JSON.stringify(payload ?? null)).digest("hex").slice(0, 12)}`,
      work: { kind: "analyzer", payload: { kind, payload }, text: String(kind ?? "") },
    })
  );

  // ---- tasks, feature ideas, references, preferences -----------------------
  ipcMain.handle("tasks:list", async () => {
    const eyes = await getEyes();
    return { ok: true, tasks: await eyes.readJson(TASKS_PATH, []), projectId: projects.current().id };
  });
  ipcMain.handle("tasks:save", async (_event, tasks) => {
    const next = Array.isArray(tasks) ? tasks : [];
    if (next.some((row) => row?.projectId && row.projectId !== projects.current().id)) return { ok: false, error: "These tasks belong to another project. Reload the task board before saving." };
    await withBoardLock(async () => {
      const eyes = await getEyes();
      await eyes.writeJson(TASKS_PATH, next);
    });
    send("eyes:tasks", next);
    return { ok: true };
  });
  ipcMain.handle("ideas:list", async () => {
    const eyes = await getEyes();
    return { ok: true, ideas: await eyes.readJson(IDEAS_PATH, []) };
  });
  ipcMain.handle("ideas:save", async (_event, ideas) => {
    const next = Array.isArray(ideas) ? ideas : [];
    if (next.some((row) => row?.projectId && row.projectId !== projects.current().id)) return { ok: false, error: "These ideas belong to another project. Reload before saving." };
    await withBoardLock(async () => {
      const eyes = await getEyes();
      await eyes.writeJson(IDEAS_PATH, next);
    });
    send("eyes:ideas", next);
    return { ok: true };
  });
  ipcMain.handle("ideas:scan", async (_event, { ai = false } = {}) =>
    assistantDemand("ideas", (entry) => scanIdeasInternal(Boolean(ai), entry), { ai: Boolean(ai), key: `ideas:${Boolean(ai)}`, work: { kind: "ideas", payload: { ai: Boolean(ai) }, text: ai ? "with AI" : "" } })
  );
  ipcMain.handle("reference:gather", async (_event, { text, useWeb = false, useTree = true, useIdeas = true, taskId = null } = {}) => {
    if (!text) return { ok: false, error: "text required" };
    const task = typeof taskId === "string" && taskId ? taskId : null;
    return assistantDemand("reference", () => gatherReferences({ text, useWeb, useTree, useIdeas }), {
      key: `reference:${String(text).slice(0, 80)}`,
      work: { kind: "reference", payload: { text, useWeb, useTree, useIdeas }, taskId: task, text: assistantClip(text, 40) },
      targets: task ? [taskTarget(task)] : null,
    });
  });
  ipcMain.handle("prefs:get", async () => {
    const settings = await readSettings();
    return { ok: true, prefs: { blurMenu: true, useWeb: false, useTree: true, autoReference: true, proactive: true, ...(settings.ui ?? {}) } };
  });
  ipcMain.handle("prefs:set", async (_event, prefs) => {
    const settings = await readSettings();
    settings.ui = { ...(settings.ui ?? {}), ...(prefs ?? {}) };
    await writeSettings(settings);
    return { ok: true, prefs: settings.ui };
  });

  // ---- machine coordination + resource manager ----------------------------
  ipcMain.handle("machine:status", async (_event, { kill = false } = {}) => ({ ok: true, status: await readMachineStatus({ kill }) }));
  ipcMain.handle("machine:watch", async (_event, { running } = {}) => (running === false ? stopMachineWatch() : startMachineWatch()));
  ipcMain.handle("machine:set", async (_event, prefs) => {
    const settings = await readSettings();
    settings.machine = { ...MACHINE_DEFAULTS, ...(settings.machine ?? {}), ...(prefs ?? {}) };
    await writeSettings(settings);
    return { ok: true, machine: settings.machine };
  });
  ipcMain.handle("machine:kill", async (_event, { pid } = {}) => {
    if (!pid) return { ok: false, error: "pid required" };
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    logLine(`[machine] manual kill pid ${pid}`);
    return { ok: true };
  });

  // ---- live update --------------------------------------------------------
  ipcMain.handle("update:status", async () => {
    if (updater) return { ok: true, status: updater.status() };
    const settings = await readSettings();
    return { ok: true, status: updateEvent({ auto: settings.update?.auto !== false, watching: false }) };
  });
  ipcMain.handle("update:set", async (_event, { auto } = {}) => {
    const settings = await readSettings();
    settings.update = { ...(settings.update ?? {}), auto: auto !== false };
    await writeSettings(settings);
    const status = updater?.setAuto(auto !== false) ?? updateEvent({ auto: auto !== false, watching: false });
    return { ok: true, status };
  });
  ipcMain.handle("update:apply", async () => {
    if (!updater) return { ok: false, error: "not watching" };
    const result = await updater.applyNow();
    // A queued result only reports the phase as of the call, so it never means
    // "nothing pending": the run in flight already owns this apply.
    if (result.applied === false && !result.queued && result.phase !== "held" && result.phase !== "error") {
      // Nothing pending: the button is still a manual "restart the app now".
      const manual = await applyRestart([], { counted: false });
      if (manual?.deferred) return { ok: false, error: manual.reason, status: updater.status() };
    }
    return { ok: result.ok !== false, ...result, status: updater.status() };
  });
}

// Bounds a restart saved, when they still land on a display that exists.
function savedWindowBounds() {
  if (SMOKE || CAPTURE) return null;
  try {
    const saved = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")).window;
    const bounds = saved?.bounds;
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 400 || bounds.height < 300) return null;
    const area = screen.getDisplayMatching(bounds).workArea;
    const onScreen = bounds.x < area.x + area.width - 40 && bounds.x + bounds.width > area.x + 40 && bounds.y < area.y + area.height - 40 && bounds.y + bounds.height > area.y;
    return onScreen ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized: Boolean(saved.maximized) } : null;
  } catch {
    return null;
  }
}

function createWindow() {
  const saved = savedWindowBounds();
  window = new BrowserWindow({
    width: saved?.width ?? 1460,
    height: saved?.height ?? 940,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    show: !SMOKE && !CAPTURE,
    backgroundColor: "#0d1118",
    autoHideMenuBar: true,
    title: "Mefi's Studio AI+",
    icon: path.join(STUDIO_ROOT, "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(STUDIO_ROOT, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      // Capture mode renders offscreen so the screenshot tour never depends on
      // window visibility or occlusion (capturePage fails with UnknownVizError
      // on a covered window).
      offscreen: CAPTURE,
      backgroundThrottling: false,
    },
  });
  if (saved?.maximized) window.maximize();
  // Zen mode's "desktop audio" reactive input arrives as a getDisplayMedia
  // request. Answer it with the screen the window sits on plus system
  // loopback, so no source picker ever opens over the constellation.
  window.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => {
        if (!sources.length) return callback({});
        const display = window && !window.isDestroyed() ? screen.getDisplayMatching(window.getBounds()) : screen.getPrimaryDisplay();
        const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0];
        callback({ video: source, ...(request.audioRequested ? { audio: "loopback" } : {}) });
      })
      .catch(() => callback({}));
  });
  if (CAPTURE) window.webContents.setFrameRate(30);
  if (SMOKE || CAPTURE) {
    window.webContents.on("console-message", (...args) => {
      const details = args[1] && typeof args[1] === "object" && "message" in args[1] ? args[1] : { level: args[1], message: args[2] };
      console.log(`[renderer:${details.level ?? "?"}] ${String(details.message ?? "").slice(0, 400)}`);
    });
  }
  window.loadFile(path.join(STUDIO_ROOT, "renderer", "booklet.html"), {
    query: { capture: CAPTURE ? "1" : "0", smoke: SMOKE ? "1" : "0" },
  });
  // Background mode: closing parks the app in the tray and the assistant
  // keeps ticking; Quit lives in the tray menu.
  window.on("close", (event) => {
    if (app.isQuitting || !tray || !assistantState?.prefs?.background) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => (window = null));
}

// Screenshot tour: writes one PNG per tab/state into tools/logs/mefi_studio_captures/.
async function captureTabs() {
  const dir = path.join(SOURCE_ROOT, "tools", "logs", "mefi_studio_captures");
  await mkdir(dir, { recursive: true });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Each script runs inside its own IIFE: executeJavaScript shares one global
  // scope between calls, so bare `const` declarations collide on the second
  // tour step that happens to reuse a name.
  const run = (body) => window.webContents.executeJavaScript(`(() => { ${body} })()`);
  const runExpr = (expression) => window.webContents.executeJavaScript(`(() => (${expression}))()`);
  const shot = async (name) => {
    const image = await window.webContents.capturePage();
    await writeFile(path.join(dir, `${name}.png`), image.toPNG());
    console.log(`[capture] ${name}`);
  };
  try {
    if (process.argv.includes("--capture-idle")) {
      // Fast iteration: only the dream-mode frame.
      await wait(900);
      await run('window.MefiIdle?.enter(true)');
      await wait(1600);
      await run('window.MefiTasks?.addTask("Command view: wire task nodes into the constellation")');
      await wait(2800);
      await run('window.MefiIdle?.selectFirst?.("task")');
      await wait(700);
      await run('window.MefiIdle?.simulate({ pulses: 3, particles: 3, popup: false })');
      await wait(2200);
      await shot("23-idle-dream");
      // Finished work flies home: mark the task done and catch its node mid
      // flight into the host, then the frame after the brief has landed.
      await run('const tasks = window.MefiTasks?.state?.tasks ?? []; const target = tasks.find((task) => /wire task nodes/.test(task.title ?? "")); if (target) window.mefiStudio?.tasksSave?.(tasks.map((task) => (task.id === target.id ? { ...task, status: "done", doneAt: Date.now() } : task)));');
      await wait(420);
      await shot("23c-idle-absorb");
      await wait(2400);
      console.log(`[capture] absorb check ${await runExpr('JSON.stringify((window.MefiIdle?.debugNodes?.() ?? []).filter((n) => /wire task nodes/.test(n.label ?? "")))')}`);
      await shot("23d-idle-absorbed");
      await run('window.MefiIdle?.exit()');
      app.exit(0);
      return;
    }
    await wait(900);
    await run('document.querySelector(".tab[data-tab=\'booklet\']").click()');
    await wait(300);
    await shot("01-booklet-top");
    await run('document.querySelector(".chip[data-id=\'premium\']").click(); document.querySelector(".chip[data-id=\'vision\']").click();');
    await wait(250);
    await shot("02-booklet-filters");
    await run('document.querySelectorAll(".chip.on").forEach((chip) => chip.click()); const card = document.querySelectorAll(".card")[0]; card.querySelector("details").open = true; card.scrollIntoView({ block: "center" });');
    await wait(250);
    await shot("03-booklet-details");
    await run('document.querySelector(".tab[data-tab=\'graph\']").click()');
    await wait(600);
    await shot("04-graph-map");
    await run('const select = document.getElementById("task-select"); select.value = "hard"; select.dispatchEvent(new Event("change"));');
    await wait(250);
    await shot("05-graph-hard-problem");
    for (const [id, name] of [["heat", "06-graph-heatmap"], ["pools", "07-graph-pools"], ["table", "08-graph-table"]]) {
      await run(`document.getElementById("${id}").scrollIntoView({ block: "start" })`);
      await wait(250);
      await shot(name);
    }
    await run('document.querySelector(".tab[data-tab=\'eyes\']").click()');
    await wait(1600);
    await shot("09-eyes-feed");
    await runExpr('new Promise((resolve) => { const img = document.getElementById("eyes-png"); if (img.complete && img.naturalWidth) return resolve("ready"); img.addEventListener("load", () => resolve("loaded"), { once: true }); setTimeout(() => resolve("timeout"), 3000); })');
    await run('const img = document.getElementById("eyes-png"); const rect = img.getBoundingClientRect(); img.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + rect.width * 0.62, clientY: rect.top + rect.height * 0.38 }));');
    await wait(250);
    console.log(`[capture] pin-click ${await runExpr('JSON.stringify({ pending: !!window.MefiEyes?.state?.pendingPin, hasInput: !!document.querySelector("#eyes-pins input"), rect: (() => { const img = document.getElementById("eyes-png"); const r = img.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() })')}`);
    await run('const input = document.querySelector("#eyes-pins input"); if (input) { input.value = "change lands here"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); }');
    await wait(300);
    console.log(`[capture] pin-after ${await runExpr('JSON.stringify({ pins: Object.keys(window.MefiEyes?.state?.pins ?? {}).length, entries: document.querySelectorAll("#eyes-pins li").length })')}`);
    await shot("10-eyes-pin");
    await run('const pin = document.querySelector("#eyes-pins li"); if (pin) pin.click();');
    await wait(200);
    await run('const item = document.querySelector("#eyes-feed li[data-id]"); if (item) item.click();');
    await wait(500);
    await shot("11-eyes-diff");
    await run('document.querySelector(".mode-row .chip[data-mode=\'log\']").click()');
    await wait(700);
    await shot("12-eyes-log");
    await run('document.getElementById("tree-rail").classList.add("pinned")');
    await wait(600);
    await shot("13-task-tree");
    const nodeJson = await runExpr('JSON.stringify((window.MefiTree?.debugNodes() ?? []).find((n) => n.kind === "session") ?? null)');
    const node = JSON.parse(nodeJson || "null");
    if (node) {
      await run(
        `const canvas = document.getElementById("tree-canvas"); const rect = canvas.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: rect.left + ${node.x}, clientY: rect.top + ${node.y} }));`
      );
      await wait(350);
      await shot("14-tree-hover");
      await run(
        `const canvas = document.getElementById("tree-canvas"); const rect = canvas.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + ${node.x}, clientY: rect.top + ${node.y} }));`
      );
      await wait(500);
      await shot("15-tree-select");
      console.log(`[capture] tree-select summary: ${await runExpr('document.getElementById("eyes-summary")?.textContent ?? ""')}`);
      await run(
        `const canvas = document.getElementById("tree-canvas"); const rect = canvas.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + ${node.x}, clientY: rect.top + ${node.y} }));`
      );
    }
    await run('window.mefiStudio?.checkpointAdd?.(window.MefiEyes?.state?.sessionId ?? "", "Checkpoint chips + message icons verified in the capture tour")');
    await wait(500);
    await run('window.MefiExplorer?.open()');
    await wait(1000);
    await shot("16-explorer");
    await run('document.getElementById("brief-run")?.click()');
    await wait(50000);
    await shot("16b-explorer-briefing");
    await run('const input = document.getElementById("request-input"); if (input) { input.value = "Verify the new theme on ultrawide monitors"; document.getElementById("request-add").click(); }');
    await wait(400);
    await shot("17-explorer-inbox");
    await run('const rows = [...document.querySelectorAll("#request-list li")].filter((li) => li.textContent.includes("ultrawide monitors")); if (rows.length) rows[0].querySelector("button:last-child").click();');
    await wait(300);
    await run('window.MefiExplorer?.close()');
    await wait(300);
    await run('window.MefiAnalyzer?.open()');
    await wait(500);
    await run(`window.MefiAnalyzer?.file(${JSON.stringify(path.join(STUDIO_ROOT, "renderer", "styles.css"))})`);
    await wait(1600);
    await shot("18-analyzer-file");
    await run('const idea = document.getElementById("analyzer-idea"); if (idea) { idea.value = "slippery biome movement mechanic with tar pits"; document.getElementById("analyzer-idea-run").click(); }');
    await wait(2600);
    await shot("19-analyzer-idea");
    await run('window.MefiAnalyzer?.close()');
    await wait(200);
    await run('window.MefiTasks?.open()');
    await wait(700);
    await run('window.MefiTasks?.addTask("Polish the dream mode framing and idle camera")');
    await wait(3200);
    await shot("20-tasks-reference");
    await run('window.MefiOverhead?.open()');
    await wait(1000);
    await shot("21-overhead");
    await run('window.MefiOverhead?.close(); window.MefiTasks?.close()');
    await wait(300);
    await run('window.MefiIdeas?.open()');
    await wait(600);
    await run('window.MefiIdeas?.scan(false)');
    await wait(2600);
    await shot("22-feature-ideas");
    await run('window.MefiIdeas?.close()');
    await wait(300);
    await run('window.MefiIdle?.enter(true)');
    await wait(1600);
    await run('window.MefiIdle?.simulate({ pulses: 3, particles: 3, popup: true })');
    await wait(2400);
    await shot("23-idle-dream");
    await run('window.MefiIdle?.selectFirst?.("session")');
    await wait(600);
    await shot("23b-command-card");
    await run('window.MefiIdle?.exit()');
    await wait(300);
    await run('window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))');
    await wait(500);
    await shot("24-palette");
    await run('window.MefiPalette?.close()');
    await wait(200);
    await run('document.getElementById("tree-rail").classList.remove("pinned"); document.querySelector(".tab[data-tab=\'studio\']").click()');
    await wait(300);
    await shot("25-studio");
    await run('document.querySelector(".tab[data-tab=\'booklet\']").click()');
    await wait(400);
    try {
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { media: "print" });
      await wait(400);
      await shot("26-print-preview");
      await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { media: "" });
      window.webContents.debugger.detach();
    } catch (error) {
      console.error(`[capture] print preview skipped: ${error.message}`);
    }
    app.exit(0);
  } catch (error) {
    console.error(`[capture] failed: ${error.message}`);
    app.exit(1);
  }
}

app.whenReady().then(() => {
  registerIpc();
  if (process.argv.includes("--set-key")) {
    (async () => {
      const key = process.env.MEFI_STUDIO_KEY;
      if (!key) {
        console.error("set MEFI_STUDIO_KEY in the environment first");
        app.exit(1);
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        console.error("OS encryption unavailable; refusing to store the key in plaintext");
        app.exit(1);
        return;
      }
      const settings = await readSettings();
      settings.apiKeyEncrypted = safeStorage.encryptString(key).toString("base64");
      await writeSettings(settings);
      console.log(`key stored encrypted (${key.length} chars, ${process.platform} safeStorage)`);
      app.exit(0);
    })();
    return;
  }
  if (process.argv.includes("--set-zai-key")) {
    (async () => {
      const key = process.env.MEFI_STUDIO_ZAI_KEY;
      if (!key) {
        console.error("set MEFI_STUDIO_ZAI_KEY in the environment first");
        app.exit(1);
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        console.error("OS encryption unavailable; refusing to store the key in plaintext");
        app.exit(1);
        return;
      }
      const settings = await readSettings();
      settings.zaiApiKeyEncrypted = safeStorage.encryptString(key).toString("base64");
      await writeSettings(settings);
      console.log(`z.ai key stored encrypted (${key.length} chars, ${process.platform} safeStorage)`);
      app.exit(0);
    })();
    return;
  }
  // The Jev decision client's AI Gateway key (scripts/decision-client.mjs).
  // Same contract as the other keys: DPAPI-encrypted at rest, headless env
  // setter, never logged and never written to a tracked file.
  if (process.argv.includes("--set-gateway-key")) {
    (async () => {
      const key = process.env.MEFI_STUDIO_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY;
      if (!key) {
        console.error("set MEFI_STUDIO_GATEWAY_KEY (or AI_GATEWAY_API_KEY) in the environment first");
        app.exit(1);
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        console.error("OS encryption unavailable; refusing to store the key in plaintext");
        app.exit(1);
        return;
      }
      const settings = await readSettings();
      settings.gatewayApiKeyEncrypted = safeStorage.encryptString(key).toString("base64");
      await writeSettings(settings);
      console.log(`AI gateway key stored encrypted (${key.length} chars, ${process.platform} safeStorage)`);
      app.exit(0);
    })();
    return;
  }
  // Probe the Jev route through the STORED (DPAPI) key — the in-app twin of
  // the env-keyed `node scripts/decision-client.mjs --probe`. --status and
  // --models work here too; the key never prints, only its shape.
  if (process.argv.includes("--jev-probe") || process.argv.includes("--jev-status") || process.argv.includes("--jev-models")) {
    (async () => {
      const client = await loadModule("scripts/decision-client.mjs");
      const settings = await readSettings();
      // The --jev-* spellings map onto the client CLI's --status/--models/--probe.
      const args = process.argv.slice(2).map((arg) => (arg === "--jev-status" ? "--status" : arg === "--jev-models" ? "--models" : arg === "--jev-probe" ? "--probe" : arg));
      const code = await client.cli(args, { settings, decrypt: decryptKey });
      app.exit(code);
    })().catch((error) => {
      console.error(`[jev] probe failed: ${error.message}`);
      app.exit(2);
    });
    return;
  }
  const speedIndex = process.argv.indexOf("--speed-probe");
  if (speedIndex >= 0) {
    (async () => {
      const model = process.argv[speedIndex + 1] || "deepseek-v4.1-flash";
      const result = await runSpeedProbe(model);
      console.log(JSON.stringify({ model, ...result }, null, 2));
      app.exit(result.ok ? 0 : 1);
    })();
    return;
  }
  const cliFlag = process.argv.find((arg) =>
    ["--assistant-brief", "--assistant-improve", "--assistant-grow", "--assistant-audit", "--assistant-proactive", "--assistant-all"].includes(arg)
  );
  if (cliFlag) {
    (async () => {
      if (cliFlag === "--assistant-all") {
        const summary = {};
        for (const mode of ["brief", "improve", "grow", "audit"]) {
          const result = await runAssistant(mode, null);
          summary[mode] = result.ok
            ? {
                summary: result.briefing.summary,
                alerts: (result.briefing.alerts ?? []).length,
                checkpoints: (result.briefing.checkpoints ?? []).length,
                expand: (result.briefing.expand ?? []).length,
              }
            : { error: result.error };
        }
        summary.proactive = await proactivePass();
        const ideas = await scanIdeasInternal(true);
        summary.ideas = { added: ideas.added, aiError: ideas.aiError, scanned: ideas.scanned };
        console.log(JSON.stringify(summary, null, 2));
        app.exit(0);
        return;
      }
      const mode =
        cliFlag === "--assistant-improve"
          ? "improve"
          : cliFlag === "--assistant-grow"
            ? "grow"
            : cliFlag === "--assistant-audit"
              ? "audit"
              : "brief";
      const output = cliFlag === "--assistant-proactive" ? await proactivePass() : await runAssistant(mode, null);
      console.log(JSON.stringify(output, null, 2));
      app.exit(output.ok ? 0 : 1);
    })();
    return;
  }
  createWindow();
  // Watchers start after the window is up so first paint is never delayed.
  setTimeout(() => startMachineWatch(), 2500);
  if (!SMOKE && !CAPTURE && !CLI_MODE) setTimeout(() => bootAutopilot(), 8000);
  // Both are fire-and-forget: a failure is logged, never an unhandled rejection.
  if (!SMOKE && !CAPTURE && !CLI_MODE) setTimeout(() => startUpdateWatch().catch((error) => logLine(`[update] watch failed: ${error?.message ?? error}`)), 3500);
  if (!SMOKE && !CAPTURE && !CLI_MODE) window.webContents.once("did-finish-load", () => announceRestart().catch(() => {}));
  // The assistant service runs on its own clock, renderer or not; the smoke
  // exercises its keyless path, the capture tour never needs it.
  if (!CAPTURE && !CLI_MODE) setTimeout(() => startAssistant().catch((error) => logLine(`[assistant] start failed: ${error?.message ?? error}`)), 1500);
  app.on("second-instance", () => showWindow());
  if (CAPTURE) {
    window.webContents.once("did-finish-load", () => captureTabs());
    setTimeout(() => {
      console.error("[capture] timeout");
      app.exit(1);
    }, 300000).unref();
    return;
  }
  if (SMOKE) {
    window.webContents.once("did-finish-load", async () => {
      try {
        const result = await window.webContents.executeJavaScript(
          "({title: document.title, models: (document.getElementById('booklet-data')?.textContent || '').length > 100, cards: document.querySelectorAll('.card').length})"
        );
        // The assistant proves its keyless tick before the smoke ends.
        await Promise.race([assistantFirstTick, new Promise((resolve) => setTimeout(resolve, 8000))]);
        result.assistant = assistantState
          ? {
              status: assistantState.status,
              ticks: assistantState.tickCount,
              problems: assistantState.problems.map((problem) => problem.kind),
              fixes: assistantState.fixes.length,
              pool: assistantState.pool,
              agents: (assistantState.agents ?? []).filter((row) => row.runs).map((row) => `${row.role}:${row.status}`),
              work: (assistantState.work ?? []).length,
              resumed: assistantState.resumed?.jobs ?? null,
            }
          : null;
        console.log(`[smoke] ${JSON.stringify(result)}`);
        app.exit(result.cards > 0 ? 0 : 1);
      } catch (error) {
        console.error(`[smoke] failed: ${error.message}`);
        app.exit(1);
      }
    });
    setTimeout(() => {
      console.error("[smoke] timeout");
      app.exit(1);
      // 90 s: the first tick waits out the resumed-work restart and the
      // roster's sequential passes; at 20 s a busy machine (OneDrive sync, a
      // test suite just finished) flaked the boot though nothing was wrong.
      // At 40 s the board database could still be waiting out the live app's
      // WAL write lock on a shared machine — boot is heavier now, and the
      // smoke proves boot, not speed.
    }, 90000).unref();
  }
});

app.on("window-all-closed", () => {
  // Background mode with a tray keeps the assistant alive without a window.
  if (tray && assistantState?.prefs?.background && !app.isQuitting) return;
  stopUpdateWatch();
  stopEyesWatch();
  stopMachineWatch();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  for (const pending of jevProjectQueues.values()) pending.then((queue) => queue.stop()).catch(() => {});
  stopAssistant();
});

process.on("exit", () => {
  if (activeChild) spawn("taskkill", ["/pid", String(activeChild.pid), "/t", "/f"]);
  saveAssistantSync();
  for (const entry of autopilot.jobs) {
    const pid = entry.pid ?? entry.child?.pid;
    if (pid) spawn("taskkill", ["/pid", String(pid), "/t", "/f"]);
  }
});
