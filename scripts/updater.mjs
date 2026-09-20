// Mefi's Studio AI+ — live update engine (pure Node ESM, no Electron import).
//
// Watches the app's SOURCE tree, plans how each change is applied (styles
// injected in place, script modules re-imported in the running process, a page
// reload, or a relaunch for main.cjs and its path resolver), validates the changed scripts,
// rebuilds renderer/booklet.html, syncs the packaged payload (never data/), and
// then asks the host (main.cjs) to apply the plan. Anything that would interrupt
// the user (reload, restart) waits behind the host's pause gate. Importing this
// file has no side effects, so tests drive it from plain node.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { watch } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

export const WATCH_ROOT_FILES = ["main.cjs", "preload.cjs", "package.json"];
export const WATCH_DIRS = [
  { dir: "renderer", recursive: false },
  { dir: "scripts", recursive: true },
  { dir: "assets", recursive: true },
];
export const CORE_FILES = ["main.cjs", "preload.cjs", "package.json", "scripts/paths.cjs", "scripts/updater.mjs", "scripts/build-booklet.mjs", "renderer/booklet.template.html"];
export const GENERATED = "renderer/booklet.html";
// Idle poll cadence. The fs watchers carry live changes; the poll is only a
// safety net for missed watcher events, so it pauses while the window is
// hidden and backs off while a poll reads the tree unchanged. Any watcher
// hint or detected change snaps the cadence back to POLL_INTERVAL_MS.
export const POLL_INTERVAL_MS = 15000;
export const POLL_BACKOFF_FACTOR = 2;
export const POLL_MAX_MS = 120000;
export const DEFAULTS = { debounceMs: 1200, restartQuietMs: 5000, maxWaitMs: 10000, deferredRetryMs: 5000, pollMs: POLL_INTERVAL_MS, loopWindowMs: 60000, loopLimit: 3, checkTimeoutMs: 15000 };

const IGNORED_TOP = new Set(["data", "dist", "node_modules"]);
const TEMP_NAME = /(~$|\.(tmp|swp|swx|crswap|bak|orig|sync-tmp)$|\.tmp\.[\w.-]+$|^#.*#$)/i;
// How each kind of change reaches the running app, weakest first. `sync` only
// refreshes the packaged payload; `style` and `modules` apply in place without
// interrupting anyone; `reload` and `restart` wait for a pause.
export const KINDS = ["none", "sync", "style", "modules", "reload", "restart"];
const PLACEHOLDERS = ["__BOOKLET_DATA__", "__BOOKLET_STYLES__", "__BOOKLET_CODE__"];

export function normalizeRel(relPath) {
  return String(relPath ?? "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

export function classifyPath(relPath) {
  const rel = normalizeRel(relPath);
  if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return "ignore";
  const segments = rel.split("/");
  if (segments.includes("..")) return "ignore";
  if (segments.some((segment) => segment.startsWith("."))) return "ignore";
  if (IGNORED_TOP.has(segments[0])) return "ignore";
  if (TEMP_NAME.test(segments[segments.length - 1])) return "ignore";
  if (rel === GENERATED) return "ignore";
  if (/^renderer\/[^/]+\.css$/.test(rel)) return "style";
  // A changed build script can change the built page, so it is a reload too.
  if (rel === "renderer/booklet.template.html" || rel === "scripts/build-booklet.mjs" || /^renderer\/[^/]+\.js$/.test(rel)) return "reload";
  // Electron runs the preload from disk on every page load: a reload is enough.
  if (rel === "preload.cjs") return "reload";
  // Root paths are startup constants, and CommonJS keeps the resolver cached.
  if (rel === "main.cjs" || /^scripts\/.*\.cjs$/.test(rel)) return "restart";
  if (rel === "package.json") return "sync";
  if (segments.length > 1 && segments[0] === "scripts") return /\.(mjs|cjs|js)$/.test(rel) ? "modules" : "sync";
  if (segments.length > 1 && segments[0] === "assets") return "sync";
  return "ignore";
}

// The plan for one change set: which in-place actions apply, whether the page
// must reload, whether the app must restart, and the strongest kind as a label.
export function plan(relPaths) {
  const rels = [...new Set((relPaths ?? []).map(normalizeRel))];
  const kinds = new Set(rels.map(classifyPath));
  kinds.delete("ignore");
  const restart = kinds.has("restart");
  const reload = !restart && kinds.has("reload");
  const style = !restart && !reload && kinds.has("style");
  const modules = restart ? [] : rels.filter((rel) => classifyPath(rel) === "modules");
  const kind = [...KINDS].reverse().find((entry) => entry !== "none" && kinds.has(entry)) ?? "none";
  return { kind, restart, reload, style, modules, sync: kinds.size > 0, build: restart || reload || style };
}

export function classify(relPaths) {
  return plan(relPaths).kind;
}

export function payloadPackage(pkg) {
  return { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: pkg.main };
}

const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex");

async function hashFile(full, rel) {
  const bytes = await readFile(full);
  if (rel === "package.json") {
    try {
      return sha1(JSON.stringify(payloadPackage(JSON.parse(bytes.toString("utf8")))));
    } catch {
      return sha1(bytes);
    }
  }
  return sha1(bytes);
}

export async function snapshot(root, { hash = false } = {}) {
  const found = [];
  const visit = async (dirRel, recursive) => {
    let entries = [];
    try {
      entries = await readdir(path.join(root, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (recursive && !entry.name.startsWith(".")) await visit(rel, true);
      } else if (entry.isFile() && classifyPath(rel) !== "ignore") found.push(rel);
    }
  };
  for (const name of WATCH_ROOT_FILES) found.push(name);
  for (const { dir, recursive } of WATCH_DIRS) await visit(dir, recursive);
  const result = {};
  for (const rel of [...new Set(found)].sort()) {
    const full = path.join(root, rel);
    try {
      const info = await stat(full);
      if (!info.isFile()) continue;
      const entry = { mtimeMs: Math.floor(info.mtimeMs), size: info.size };
      if (hash) entry.sha1 = await hashFile(full, rel);
      result[rel] = entry;
    } catch {}
  }
  return result;
}

export function diff(prev = {}, next = {}) {
  const changed = [];
  const added = [];
  const removed = [];
  for (const [rel, entry] of Object.entries(next)) {
    const before = prev[rel];
    if (!before) added.push(rel);
    else if (before.sha1 && entry.sha1 ? before.sha1 !== entry.sha1 : before.size !== entry.size || before.mtimeMs !== entry.mtimeMs) changed.push(rel);
  }
  for (const rel of Object.keys(prev)) if (!next[rel]) removed.push(rel);
  changed.sort();
  added.sort();
  removed.sort();
  return { changed, added, removed, all: [...changed, ...added, ...removed].sort() };
}

function checkScript(execPath, full, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let stderr = "";
    let done = false;
    const finish = (message) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(message);
    };
    let child;
    try {
      child = spawn(execPath, ["--check", full], { cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true });
    } catch (error) {
      resolve(`validator unavailable: ${error.message}`);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish("syntax check timed out");
    }, timeoutMs);
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => finish(`validator unavailable: ${error.message}`));
    child.on("close", (code) => {
      if (code === 0) return finish(null);
      const lines = stderr.trim().split(/\r?\n/);
      const headline = stderr.match(/^[A-Za-z]*Error: .*$/m)?.[0] ?? lines[lines.length - 1] ?? `exit code ${code}`;
      const where = lines[0]?.match(/[\\/]([^\\/]+):(\d+)\s*$/);
      const line = where && where[1] === path.basename(full) ? where[2] : null;
      finish(`${headline}${line ? ` (line ${line})` : ""}`.slice(0, 400));
    });
  });
}

// build-booklet.mjs inlines every renderer/*.js into ONE classic <script>, so
// those files must be parsed with that goal. `node --check` would read them as
// ES modules (package.json is "type": "module") and wave through a top-level
// await / import / export that kills the whole booklet script block.
function checkClassicScript(text, full) {
  try {
    new vm.Script(text, { filename: full });
    return null;
  } catch (error) {
    const head = String(error?.stack ?? "").split(/\r?\n/)[0] ?? "";
    const line = head.startsWith(full) ? head.slice(full.length).match(/^:(\d+)$/)?.[1] : null;
    return `${error?.name ?? "SyntaxError"}: ${error?.message ?? error}${line ? ` (line ${line})` : ""}`.slice(0, 400);
  }
}

export async function validate(root, relPaths, { execPath = process.execPath, timeoutMs = DEFAULTS.checkTimeoutMs, concurrency = 4 } = {}) {
  const errors = [];
  const targets = [];
  for (const rel of [...new Set((relPaths ?? []).map(normalizeRel))].sort()) {
    if (classifyPath(rel) === "ignore") continue;
    const full = path.join(root, rel);
    let text = null;
    try {
      text = await readFile(full, "utf8");
    } catch {
      if (CORE_FILES.includes(rel)) errors.push({ file: rel, message: "core file missing" });
      continue;
    }
    targets.push({ rel, full, text });
  }
  const checked = targets.length;
  const queue = [...targets];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { rel, full, text } = job;
      if (/^renderer\/[^/]+\.js$/.test(rel)) {
        const message = checkClassicScript(text, full);
        if (message) errors.push({ file: rel, message });
      } else if (/\.(js|cjs|mjs)$/.test(rel)) {
        const message = await checkScript(execPath, full, root, timeoutMs);
        if (message) errors.push({ file: rel, message });
      } else if (rel.endsWith(".json")) {
        try {
          JSON.parse(text);
        } catch (error) {
          errors.push({ file: rel, message: `JSON does not parse: ${error.message}`.slice(0, 400) });
        }
      } else if (rel === "renderer/booklet.template.html") {
        for (const placeholder of PLACEHOLDERS) {
          if (!text.includes(placeholder)) errors.push({ file: rel, message: `template lost the ${placeholder} placeholder` });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { ok: errors.length === 0, errors, checked };
}

export async function syncPayload({ sourceRoot, appRoot, relPaths }) {
  const result = { copied: [], deleted: [], skipped: [], failed: [] };
  const from = path.resolve(sourceRoot);
  const to = path.resolve(appRoot);
  if (from === to) return result;
  const dataDir = path.join(to, "data") + path.sep;
  for (const rel of [...new Set((relPaths ?? []).map(normalizeRel))].sort()) {
    const dest = path.resolve(to, rel);
    const allowed = rel === GENERATED || classifyPath(rel) !== "ignore";
    if (!allowed || !dest.startsWith(to + path.sep) || dest.startsWith(dataDir)) {
      result.skipped.push(rel);
      continue;
    }
    const source = path.join(from, rel);
    let exists = true;
    try {
      exists = (await stat(source)).isFile();
    } catch {
      exists = false;
    }
    if (!exists) {
      if (CORE_FILES.includes(rel) || rel === GENERATED) {
        result.skipped.push(rel);
        continue;
      }
      try {
        await rm(dest, { force: true });
        result.deleted.push(rel);
      } catch (error) {
        result.failed.push({ rel, error: String(error?.message ?? error).slice(0, 400) });
      }
      continue;
    }
    // One locked destination must not abort the rest of the payload, and the
    // temp is always removed — a leftover reads as a real file to the next diff.
    const temp = `${dest}.sync-tmp`;
    let failure = null;
    try {
      await mkdir(path.dirname(dest), { recursive: true });
      if (rel === "package.json") {
        const pkg = JSON.parse(await readFile(source, "utf8"));
        await writeFile(temp, JSON.stringify(payloadPackage(pkg), null, 2) + "\n");
      } else {
        await copyFile(source, temp);
      }
      try {
        await rename(temp, dest);
      } catch {
        await copyFile(temp, dest);
      }
    } catch (error) {
      failure = String(error?.message ?? error).slice(0, 400);
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
    if (failure) result.failed.push({ rel, error: failure });
    else result.copied.push(rel);
  }
  return result;
}

export async function runtimeGuard({ sourceRoot, packaged = false, runtimeVersion = process.versions.electron } = {}) {
  if (!packaged || !runtimeVersion) return { ok: true, reason: null, wanted: null, running: runtimeVersion ?? null };
  let wanted = null;
  try {
    const pkg = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
    wanted = String(pkg.devDependencies?.electron ?? "").replace(/^[\^~=v\s]+/, "") || null;
  } catch {}
  if (wanted && wanted !== runtimeVersion) {
    return { ok: false, reason: "runtime changed — run npm run package", wanted, running: runtimeVersion };
  }
  return { ok: true, reason: null, wanted, running: runtimeVersion };
}

export async function loadBuild(sourceRoot) {
  const file = path.join(sourceRoot, "scripts", "build-booklet.mjs");
  const info = await stat(file);
  const module = await import(`${pathToFileURL(file).href}?v=${Math.floor(info.mtimeMs)}`);
  if (typeof module.build !== "function") throw new Error("scripts/build-booklet.mjs does not export build()");
  return module.build;
}

const BUSY = new Set(["detected", "validating", "building", "syncing", "waiting", "swapping", "styling", "reloading", "restarting"]);

export function createUpdater({
  sourceRoot,
  appRoot = sourceRoot,
  debounceMs = DEFAULTS.debounceMs,
  restartQuietMs = DEFAULTS.restartQuietMs,
  maxWaitMs = DEFAULTS.maxWaitMs,
  deferredRetryMs = DEFAULTS.deferredRetryMs,
  pollMs = DEFAULTS.pollMs,
  execPath = process.execPath,
  packaged = false,
  runtimeVersion = process.versions.electron,
  auto = true,
  restartHistory = [],
  watch: useWatch = true,
  // Host-supplied visibility probe (e.g. window minimized or hidden). True
  // pauses the stat-walk poll entirely — the fs watchers keep running.
  hidden = null,
  build = null,
  now = Date.now,
  actions = {},
  // Awaited before a reload or restart (never before an in-place action):
  // the host resolves it once the user has paused. A manual apply skips it.
  gate = null,
  onEvent = () => {},
} = {}) {
  if (!sourceRoot) throw new Error("createUpdater needs sourceRoot");
  const sameRoot = path.resolve(sourceRoot) === path.resolve(appRoot);
  const state = {
    started: false,
    phase: "idle",
    kind: null,
    files: [],
    error: null,
    reason: null,
    auto: Boolean(auto),
    at: now(),
    baseline: {},
    statBaseline: {},
    hints: new Set(),
    pendingSince: null,
    timer: null,
    deferredTimer: null,
    pollTimer: null,
    pollDelay: Math.max(1000, pollMs),
    hidden,
    running: false,
    rerun: false,
    rerunForce: false,
    watchers: [],
    waiters: [],
    history: [...restartHistory],
    lastApplied: null,
  };

  const status = () => ({
    phase: state.phase,
    kind: state.kind,
    files: [...state.files],
    error: state.error,
    reason: state.reason,
    auto: state.auto,
    watching: state.started,
    at: state.at,
    last: state.lastApplied,
    pollMs: state.pollDelay,
  });

  function emit(phase, patch = {}) {
    Object.assign(state, patch);
    state.phase = phase;
    state.at = now();
    const { last, ...payload } = status();
    try {
      onEvent(payload);
    } catch {}
  }

  function settle() {
    if (state.timer || state.running) return;
    for (const resolve of state.waiters.splice(0)) resolve(status());
  }

  function notify(relPath) {
    if (!state.started) return;
    if (relPath !== undefined && relPath !== null) {
      const rel = normalizeRel(relPath);
      if (classifyPath(rel) === "ignore") return;
      state.hints.add(rel);
    }
    // Activity: the safety-net poll follows the watcher at the base cadence.
    state.pollDelay = Math.max(1000, pollMs);
    const stamp = now();
    if (state.pendingSince === null) state.pendingSince = stamp;
    const quiet = [...state.hints].some((rel) => classifyPath(rel) === "restart") ? Math.max(debounceMs, restartQuietMs) : debounceMs;
    const delay = Math.max(0, Math.min(quiet, state.pendingSince + maxWaitMs - stamp));
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      run().catch(() => {});
    }, delay);
  }

  async function run({ force = false } = {}) {
    if (state.running) {
      state.rerun = true;
      // Keep an explicit apply's intent: a click that lands mid-run must still
      // apply afterwards instead of falling back to the plain debounce.
      if (force) state.rerunForce = true;
      return { ok: true, applied: false, phase: state.phase, queued: true };
    }
    clearTimeout(state.deferredTimer);
    state.deferredTimer = null;
    state.running = true;
    state.pendingSince = null;
    state.hints.clear();
    let outcome = { ok: true, applied: false, phase: state.phase };
    try {
      const next = await snapshot(sourceRoot, { hash: true });
      state.statBaseline = next;
      const delta = diff(state.baseline, next);
      const files = delta.all;
      const todo = plan(files);
      const kind = todo.kind;
      // A host without an in-process module swap still gets a working update:
      // the old full restart.
      const restarting = todo.restart || (todo.modules.length > 0 && typeof actions.modules !== "function");
      if (kind === "none") {
        state.baseline = next;
        if (state.phase !== "watching") emit("watching", { kind: null, files: [], error: null, reason: null });
        outcome = { ok: true, applied: false, phase: state.phase };
        return outcome;
      }
      emit("detected", { kind, files, error: null, reason: null });
      if (!state.auto && !force) {
        emit("pending", { reason: "auto-restart is off" });
        outcome = { ok: true, applied: false, phase: "pending", kind, files };
        return outcome;
      }
      const guard = await runtimeGuard({ sourceRoot, packaged, runtimeVersion });
      if (!guard.ok) {
        emit("held", { reason: guard.reason, error: `source wants Electron ${guard.wanted}, running ${guard.running}` });
        outcome = { ok: false, applied: false, phase: "held", kind, files, reason: state.reason, error: state.error };
        return outcome;
      }
      emit("validating");
      const checkedFiles = [...delta.changed, ...delta.added, ...delta.removed.filter((rel) => CORE_FILES.includes(rel))];
      const verdict = await validate(sourceRoot, checkedFiles, { execPath });
      if (!verdict.ok) {
        const first = verdict.errors[0];
        emit("held", { reason: "syntax error", error: `${first.file}: ${first.message}` });
        outcome = { ok: false, applied: false, phase: "held", kind, files, reason: state.reason, error: state.error, errors: verdict.errors };
        return outcome;
      }
      // Checked before building/syncing: a held update must never leave the
      // packaged payload ahead of the process that is still running.
      if (restarting && !force) {
        const stamp = now();
        const recent = state.history.filter((at) => stamp - at < DEFAULTS.loopWindowMs);
        if (recent.length >= DEFAULTS.loopLimit) {
          emit("held", { reason: "restart loop", error: `${recent.length} restarts inside ${DEFAULTS.loopWindowMs / 1000} s` });
          outcome = { ok: false, applied: false, phase: "held", kind, files, reason: state.reason, error: state.error };
          return outcome;
        }
      }
      emit("building");
      try {
        const buildFn = build ?? (await loadBuild(sourceRoot));
        await buildFn({ root: sourceRoot });
      } catch (error) {
        // A multi-file edit can register a renderer input before its writer
        // creates it. Keep the last complete payload and retry on the next
        // source change; never sync or restart into this incomplete build.
        const missing = error?.code === "ENOENT" && typeof error.path === "string"
          ? normalizeRel(path.relative(sourceRoot, error.path)) : null;
        if (!missing || missing.startsWith("../") || path.isAbsolute(missing) || /^[A-Za-z]:/.test(missing)) throw error;
        emit("held", { reason: "incomplete source files", error: `Waiting for ${missing}` });
        outcome = { ok: false, applied: false, phase: "held", kind, files, reason: state.reason, error: state.error };
        return outcome;
      }
      if (!sameRoot) {
        emit("syncing");
        const sync = await syncPayload({ sourceRoot, appRoot, relPaths: [...files, GENERATED] });
        // A locked destination leaves the payload half-written: hold (the
        // baseline stays unadopted, so the whole set is retried) instead of
        // reloading or relaunching into a mixed-revision payload.
        if (sync.failed.length) {
          const first = sync.failed[0];
          emit("held", { reason: "payload locked", error: `${first.rel}: ${first.error}` });
          outcome = { ok: false, applied: false, phase: "held", kind, files, reason: state.reason, error: state.error };
          return outcome;
        }
      }
      if (restarting) {
        if (gate && !force) {
          emit("waiting", { reason: "waiting for a pause" });
          await gate("restart");
        }
        emit("restarting", { reason: null });
        const answer = await actions.restart?.(files);
        if (answer && answer.deferred) {
          emit("pending", { reason: state.auto ? answer.reason ?? "restart deferred" : "auto-restart is off" });
          // Worker/game completion does not change the watched source. The
          // stat baseline already includes these files, so neither an idle
          // poll nor a hidden window can wake this restart. Retry independently
          // until the host drains, without keeping whenIdle() pending forever.
          if (state.started && state.auto) {
            state.deferredTimer = setTimeout(() => {
              state.deferredTimer = null;
              if (state.started && state.auto) run().catch(() => {});
            }, Math.max(1, deferredRetryMs));
            state.deferredTimer.unref?.();
          }
          outcome = { ok: true, applied: false, phase: "pending", kind, files, reason: state.reason };
          return outcome;
        }
        state.history = [...state.history.filter((at) => now() - at < DEFAULTS.loopWindowMs), now()];
      } else {
        // In place first: swapped modules and injected styles interrupt nobody,
        // so they never wait behind the pause gate.
        if (todo.modules.length) {
          emit("swapping");
          await actions.modules(todo.modules);
        }
        let reload = todo.reload;
        if (!reload && todo.style) {
          if (typeof actions.style === "function") {
            emit("styling");
            // false means the page could not take the styles live (an old page
            // without the style slot): fall back to the reload path.
            if ((await actions.style(files)) === false) reload = true;
          } else reload = true;
        }
        if (reload) {
          if (gate && !force) {
            emit("waiting", { reason: "waiting for a pause" });
            await gate("reload");
          }
          emit("reloading", { reason: null });
          await actions.reload?.(files);
        }
      }
      state.baseline = next;
      state.lastApplied = { at: now(), kind, files };
      emit("watching", { kind: null, files: [], error: null, reason: null });
      outcome = { ok: true, applied: true, phase: "watching", kind, files };
      return outcome;
    } catch (error) {
      emit("error", { reason: "update failed", error: String(error?.message ?? error).slice(0, 400) });
      outcome = { ok: false, applied: false, phase: "error", reason: state.reason, error: state.error };
      return outcome;
    } finally {
      state.running = false;
      if (state.rerun) {
        state.rerun = false;
        const again = state.rerunForce;
        state.rerunForce = false;
        if (again && state.started) {
          clearTimeout(state.timer);
          state.timer = null;
          run({ force: true }).catch(() => {});
        } else {
          notify();
        }
      }
      settle();
    }
  }

  function schedulePoll() {
    const timer = setTimeout(pollOnce, state.pollDelay);
    timer.unref?.();
    return timer;
  }

  async function pollOnce() {
    state.pollTimer = null;
    if (!state.started) return;
    const base = Math.max(1000, pollMs);
    // Hidden window: skip the stat walk entirely — the fs watchers keep
    // collecting hints, and the next visible poll diffs against the baseline
    // it left behind, so nothing observed is lost while paused.
    const isHidden = typeof state.hidden === "function" && state.hidden();
    let changed = false;
    if (!isHidden && !state.running && !state.timer) {
      try {
        const next = await snapshot(sourceRoot);
        if (state.started) {
          const delta = diff(state.statBaseline, next);
          if (delta.all.length) {
            for (const rel of delta.all) notify(rel);
            changed = true;
          }
        }
      } catch {}
    }
    if (!state.started) return;
    // Paused or changed reads sit at the base cadence; quiet reads multiply
    // toward the cap, so an idle tree costs exponentially fewer stat walks.
    state.pollDelay = isHidden || changed ? base : Math.min(Math.max(state.pollDelay, base) * POLL_BACKOFF_FACTOR, Math.max(base, POLL_MAX_MS));
    state.pollTimer = schedulePoll();
  }

  async function start() {
    if (state.started) return status();
    const source = await snapshot(sourceRoot, { hash: true });
    state.baseline = sameRoot ? source : await snapshot(appRoot, { hash: true });
    state.statBaseline = source;
    state.started = true;
    if (useWatch) {
      const targets = [{ dir: "", recursive: false }, ...WATCH_DIRS];
      for (const { dir, recursive } of targets) {
        try {
          const watcher = watch(path.join(sourceRoot, dir), { persistent: false, recursive }, (_type, filename) => {
            notify(filename ? (dir ? `${dir}/${filename}` : String(filename)) : undefined);
          });
          watcher.on("error", () => {
            try {
              watcher.close();
            } catch {}
          });
          state.watchers.push(watcher);
        } catch {}
      }
    }
    state.pollDelay = Math.max(1000, pollMs);
    state.pollTimer = schedulePoll();
    emit("watching", { kind: null, files: [], error: null, reason: null });
    if (!sameRoot && diff(state.baseline, source).all.length) notify();
    return status();
  }

  function stop() {
    for (const watcher of state.watchers.splice(0)) {
      try {
        watcher.close();
      } catch {}
    }
    clearTimeout(state.timer);
    clearTimeout(state.deferredTimer);
    clearTimeout(state.pollTimer);
    state.timer = null;
    state.deferredTimer = null;
    state.pollTimer = null;
    state.pollDelay = Math.max(1000, pollMs);
    state.started = false;
    state.phase = "idle";
    settle();
    return status();
  }

  function applyNow() {
    clearTimeout(state.timer);
    state.timer = null;
    return run({ force: true });
  }

  function setAuto(value) {
    state.auto = Boolean(value);
    if (!state.auto) {
      clearTimeout(state.deferredTimer);
      state.deferredTimer = null;
    }
    if (state.auto && state.phase === "pending") notify();
    else if (!state.auto && state.phase === "pending") emit("pending", { reason: "auto-restart is off" });
    else emit(state.phase);
    return status();
  }

  function whenIdle() {
    return new Promise((resolve) => {
      state.waiters.push(resolve);
      settle();
    });
  }

  return { start, stop, status, applyNow, setAuto, notify, whenIdle, isBusy: () => BUSY.has(state.phase) };
}
