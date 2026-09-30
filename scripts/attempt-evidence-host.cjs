"use strict";
// Before and after shots, the host half: takes the shot through an injected
// capture (scripts/evidence-window.cjs in the app), keeps the files under the
// project's data folder and answers what exists. scripts/attempt-evidence.cjs
// (pure) decides whether to capture, names the files and plans the pruning.
//
//   shot         plan, capture, save <data>/attempt-evidence/<task>/<n>/<phase>.png
//                and note in meta.json how it went; never throws, never waits
//                longer than the capture's own limit
//   read         what exists for one attempt: each picture as a bounded data URL
//                and, for a side with none, why (the preview was not running)
//   numbers      the attempt numbers already taken, so a run's number is the
//                same for its snapshots and its shots
//   checks       the advisory results of an attempt (scripts/advisory-checks.cjs)
//                kept beside its pictures
//   prune        the newest ten attempts keep their pictures, twenty their
//                folders, and the whole folder stays under a size
//   drop         an attempt that never started (its claim was cancelled while
//                the start shot was taken) leaves no folder behind
//
// The folder is the project's data folder, never the repository, and never part
// of a problem report. All IO is injected like scripts/git-actions.cjs; the
// defaults are the real ones. Guarded by tests/attempt_evidence.test.mjs.
const rules = require("./attempt-evidence.cjs");

const STALE_TEMP_MS = 60 * 60 * 1000;
// Pruning reads every attempt folder, so after a shot it runs at most this often.
const PRUNE_EVERY_MS = 5 * 60 * 1000;

function createAttemptEvidence({
  fs = require("node:fs"),
  path = require("node:path"),
  // The project's data folder (a string or a function): the evidence goes in its attempt-evidence folder.
  root,
  // (url, { width, height, timeoutMs, settleMs, allow }) => Promise<{ ok, png?, error? }>
  capture = async () => ({ ok: false, error: "no capture window" }),
  now = () => Date.now(),
  log = () => {},
  random = () => require("node:crypto").randomBytes(6).toString("hex"),
  // Belt and braces: a capture that never answers is given up on after its own limit and this much more.
  graceMs = 3000,
} = {}) {
  const fsp = fs.promises;
  const clock = () => (typeof now === "function" ? now() : Date.now());
  let lastPrune = 0;
  const dataFolder = () => (typeof root === "function" ? root() : root);
  const evidenceRoot = () => { const data = dataFolder(); return typeof data === "string" && data ? path.join(data, rules.DIR) : null; };

  const folderOf = (taskId, n) => {
    const parts = rules.folderParts(taskId, n);
    const data = dataFolder();
    return parts && typeof data === "string" && data ? path.join(data, ...parts) : null;
  };
  const safe = (name, task) => async (...args) => {
    try { return await task(...args); } catch (error) { log(`[review] ${name} failed (${error?.code || error?.name || "error"})`); return { ok: false }; }
  };
  // A file appears whole or not at all.
  async function writeAtomic(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${random()}.tmp`;
    try { await fsp.writeFile(temp, data, { flag: "wx" }); await fsp.rename(temp, file); } catch (error) { await fsp.rm(temp, { force: true }).catch(() => {}); throw error; }
  }
  async function readMeta(folder) {
    try { return rules.parseMeta(await fsp.readFile(path.join(folder, "meta.json"), "utf8")); } catch { return rules.parseMeta(""); }
  }
  async function noteMeta(folder, details) {
    const meta = rules.metaOf(await readMeta(folder), { ...details, at: clock() });
    await writeAtomic(path.join(folder, "meta.json"), `${JSON.stringify(meta)}\n`);
    return meta;
  }

  // ---- taking a shot -------------------------------------------------------------------------------
  // `preview`: the project preview's status, read without starting anything ({ phase, url }).
  const shot = safe("shot", async ({ taskId, n, runId = null, phase, preview, prefs, timeoutMs = rules.LIMITS.timeoutMs, cancelled = null } = {}) => {
    const folder = folderOf(taskId, n);
    if (!folder || !rules.isPhase(phase)) return { ok: false, reason: "failed" };
    const plan = rules.planCapture({ phase, prefs, preview });
    if (!plan.capture) {
      // A switched-off host leaves no trace; a preview that was not running is worth saying.
      if (plan.reason !== "off") await noteMeta(folder, { runId, phase, state: "skipped", reason: plan.reason });
      return { ok: true, captured: false, reason: plan.reason, say: plan.say };
    }
    let taken = null;
    let guard = null;
    try {
      const asked = Promise.resolve(capture(plan.url, { width: rules.LIMITS.width, height: rules.LIMITS.height, timeoutMs, settleMs: rules.LIMITS.settleMs, allow: plan.allow }));
      const late = new Promise((resolve) => { guard = setTimeout(() => resolve({ ok: false, error: "no answer" }), timeoutMs + graceMs); guard.unref?.(); });
      taken = await Promise.race([asked, late]);
    } catch { taken = { ok: false }; } finally { clearTimeout(guard); }
    if (cancelled?.()) {
      // The run went on without waiting: a shot that arrives now would not be "when the task started".
      await noteMeta(folder, { runId, phase, state: "skipped", reason: "failed" });
      return { ok: true, captured: false, reason: "failed", say: rules.sayFor("failed", phase), late: true };
    }
    const png = taken?.ok ? taken.png : null;
    const size = png ? rules.pngSize(png) : null;
    if (!png || !size) {
      await noteMeta(folder, { runId, phase, state: "skipped", reason: "failed" });
      return { ok: true, captured: false, reason: "failed", say: rules.sayFor("failed", phase) };
    }
    if (!rules.keepable(png.length)) {
      await noteMeta(folder, { runId, phase, state: "skipped", reason: "too-big" });
      return { ok: true, captured: false, reason: "too-big", say: rules.SAY["too-big"] };
    }
    await writeAtomic(path.join(folder, rules.imageName(phase)), png);
    await noteMeta(folder, { runId, phase, state: "captured", bytes: png.length, width: size.width, height: size.height });
    if (clock() - lastPrune > PRUNE_EVERY_MS) { lastPrune = clock(); prune().catch(() => {}); }
    return { ok: true, captured: true, bytes: png.length, width: size.width, height: size.height };
  });

  // A side that will not get a shot, and why (the run's work was never merged into the folder the preview shows).
  const skip = safe("skip", async ({ taskId, n, runId = null, phase, reason } = {}) => {
    const folder = folderOf(taskId, n);
    if (!folder || !rules.isPhase(phase) || !["not-merged", "failed", "no-preview"].includes(reason)) return { ok: false };
    await noteMeta(folder, { runId, phase, state: "skipped", reason });
    return { ok: true };
  });

  // An attempt that never started has no end side: its folder (the start shot, the notes) goes.
  const drop = safe("drop", async ({ taskId, n } = {}) => {
    const folder = folderOf(taskId, n);
    if (!folder) return { ok: false };
    for (const name of [rules.imageName("after"), "checks.json"]) {
      if (await fsp.stat(path.join(folder, name)).then(() => true, () => false)) return { ok: true, dropped: false };
    }
    await fsp.rm(folder, { recursive: true, force: true });
    return { ok: true, dropped: true };
  });

  // ---- what exists -------------------------------------------------------------------------------------
  const listing = async () => {
    const top = evidenceRoot();
    const rows = [];
    let tasks = [];
    if (!top) return rows;
    try { tasks = await fsp.readdir(top, { withFileTypes: true }); } catch { return rows; }
    for (const task of tasks) {
      if (!task.isDirectory()) continue;
      let attempts = [];
      try { attempts = await fsp.readdir(path.join(top, task.name), { withFileTypes: true }); } catch { continue; }
      for (const attempt of attempts) {
        if (!attempt.isDirectory() || !/^\d{1,6}$/.test(attempt.name)) continue;
        const folder = path.join(top, task.name, attempt.name);
        let images = 0;
        let at = 0;
        for (const phase of rules.PHASES) {
          try { const info = await fsp.stat(path.join(folder, rules.imageName(phase))); images += info.size; at = Math.max(at, info.mtimeMs); } catch { /* none */ }
        }
        if (!at) { try { at = (await fsp.stat(folder)).mtimeMs; } catch { /* gone */ } }
        rows.push({ key: task.name, n: Number(attempt.name), at, images });
      }
    }
    return rows;
  };
  // The attempt numbers this task's folders hold: <data>/attempt-evidence/<task>/<n>. Only this task's folder is read.
  async function numbers(taskId) {
    const key = rules.folderParts(taskId, 1)?.[1];
    const top = evidenceRoot();
    if (!key || !top) return [];
    try {
      const entries = await fsp.readdir(path.join(top, key), { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory() && /^\d{1,6}$/.test(entry.name)).map((entry) => Number(entry.name));
    } catch { return []; }
  }

  const read = safe("read", async ({ taskId, n } = {}) => {
    const folder = folderOf(taskId, n);
    if (!folder) return { ok: true, attempt: n ?? null, shots: [], notes: {}, privacy: rules.PRIVACY };
    const meta = await readMeta(folder);
    const shots = [];
    const notes = {};
    for (const phase of rules.PHASES) {
      const file = path.join(folder, rules.imageName(phase));
      let bytes = null;
      let info = null;
      try { info = await fsp.stat(file); } catch { /* none */ }
      if (info?.isFile() && rules.keepable(info.size)) {
        try { bytes = await fsp.readFile(file); } catch { bytes = null; }
      }
      const size = bytes ? rules.pngSize(bytes) : null;
      if (bytes && size) {
        const row = { phase, at: meta[phase]?.at || Math.round(info.mtimeMs), bytes: bytes.length, width: size.width, height: size.height };
        shots.push(rules.sendable(bytes.length) ? { ...row, dataUrl: rules.dataUrl(bytes) } : { ...row, tooBig: true });
      }
      notes[phase] = rules.noteFor(phase, meta[phase], Boolean(bytes && size));
    }
    return { ok: true, attempt: n, runId: meta.runId, shots, notes, privacy: rules.PRIVACY };
  });

  // ---- advisory results, kept beside the pictures ----------------------------------------------------------
  const saveChecks = safe("saveChecks", async ({ taskId, n, runId = null, results, ranAt = clock() } = {}) => {
    const folder = folderOf(taskId, n);
    if (!folder || !Array.isArray(results)) return { ok: false };
    const body = { v: 1, ...(runId ? { runId } : {}), at: Number(ranAt) || 0, results: results.slice(0, 12) };
    await writeAtomic(path.join(folder, "checks.json"), `${JSON.stringify(body)}\n`);
    return { ok: true };
  });
  const readChecks = safe("readChecks", async ({ taskId, n } = {}) => {
    const folder = folderOf(taskId, n);
    if (!folder) return { ok: true, results: [], at: null };
    try {
      const body = JSON.parse(await fsp.readFile(path.join(folder, "checks.json"), "utf8"));
      return { ok: true, results: Array.isArray(body?.results) ? body.results.slice(0, 12) : [], at: Number(body?.at) || null, runId: typeof body?.runId === "string" ? body.runId : null };
    } catch { return { ok: true, results: [], at: null }; }
  });

  // ---- keeping the folder small ------------------------------------------------------------------------------
  async function prune() {
    const rows = await listing();
    const plan = rules.prunePlan(rows);
    const top = evidenceRoot();
    if (!top) return { ok: true, images: 0, folders: 0 };
    for (const item of plan.dropImages) {
      for (const phase of rules.PHASES) await fsp.rm(path.join(top, item.key, String(item.n), rules.imageName(phase)), { force: true }).catch(() => {});
    }
    for (const item of plan.dropFolders) await fsp.rm(path.join(top, item.key, String(item.n)), { recursive: true, force: true }).catch(() => {});
    // A picture that never finished writing, left by a crash.
    for (const row of rows) {
      try {
        const folder = path.join(top, row.key, String(row.n));
        for (const name of await fsp.readdir(folder)) {
          if (!name.endsWith(".tmp")) continue;
          const info = await fsp.stat(path.join(folder, name)).catch(() => null);
          if (info && clock() - info.mtimeMs > STALE_TEMP_MS) await fsp.rm(path.join(folder, name), { force: true }).catch(() => {});
        }
      } catch { /* gone */ }
    }
    return { ok: true, images: plan.dropImages.length, folders: plan.dropFolders.length };
  }

  return { shot, skip, drop, read, numbers, saveChecks, readChecks, prune: safe("prune", prune), folderOf };
}

module.exports = { createAttemptEvidence };
