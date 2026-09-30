"use strict";
// Pure module: no Electron, no filesystem, no network, no clock reads (time is
// injected), no processes, no timers.
//
// The records the updater's safety net keeps, and the rules for reading them.
// An in-app update replaces the portable folder while Studio is closed, so
// nothing inside the old process can notice that the new build is broken. The
// PowerShell helper that installs it therefore keeps a copy of the old build,
// launches the new one and waits for it to say it started. Three small files
// carry that conversation; main.cjs and release-updater.mjs own the I/O and
// this module owns their shape:
//
//   data/boot-health.json   written by every boot of a packaged build. The
//                           renderer's "boot:healthy" (or a 45 second fallback
//                           once the window has loaded and Studio stayed up)
//                           stamps healthyAt. The helper reads it.
//   <backup>/manifest.json  written by the helper after it copied the old
//                           build: which version the copy is, which build it
//                           was replaced by, and which install folder it
//                           belongs to.
//   data/update-result.json written by the helper when an update did not
//                           stand (the backup failed, or the new build never
//                           became healthy and the old one was restored). The
//                           next boot reads it, tells the owner, and removes it.
//
// The health file's shape is a contract between versions: the helper that
// installs version N+1 is written by version N, so a build that stops writing
// it looks broken to that helper. releaseWritesHealth() lets the installing
// version check a staged build before it starts waiting for the flag.

const HEALTH_FILE = "boot-health.json";
const RESULT_FILE = "update-result.json";
const MANIFEST_FILE = "manifest.json";
const HEALTH_MARKER = "boot-health.json";
// The renderer normally reports within seconds. When it never does (a shell
// that forgot to call bootHealthy) the host counts a window that finished
// loading and stayed up this long as healthy, so a good build is not undone.
const HEALTHY_FALLBACK_MS = 45_000;

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value, max = 300) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

function beginBoot({ version, pid, now }) {
  return { v: 1, version: text(version, 40), pid: isNumber(pid) ? pid : 0, startedAt: isNumber(now) ? now : 0, healthyAt: null, via: null };
}

// Idempotent: the first stamp of a boot stands, so a live reload that reports
// again cannot move it.
function reportHealthy(record, { via = "renderer", now } = {}) {
  if (!record || typeof record !== "object") return null;
  if (isNumber(record.healthyAt)) return record;
  return { ...record, healthyAt: isNumber(now) ? now : 0, via: text(via, 20) || "renderer" };
}

function parseHealth(raw) {
  let value = null;
  try { value = typeof raw === "string" ? JSON.parse(raw.replace(/^﻿/, "")) : raw; } catch { return null; }
  if (!value || typeof value !== "object" || !isNumber(value.startedAt)) return null;
  return {
    v: 1,
    version: text(value.version, 40),
    pid: isNumber(value.pid) ? value.pid : 0,
    startedAt: value.startedAt,
    healthyAt: isNumber(value.healthyAt) ? value.healthyAt : null,
    via: text(value.via, 20) || null,
  };
}

// What the installing helper concludes from the record, given when it started
// the build and which version it expects: healthy, still starting, or nothing
// from this launch (the file is from an earlier boot or another version).
function healthVerdict(record, { version, launchedAt }) {
  const health = parseHealth(record);
  if (!health || (version && health.version !== text(version, 40))) return "absent";
  if (isNumber(health.healthyAt) && health.healthyAt >= launchedAt) return "healthy";
  if (health.startedAt >= launchedAt) return "starting";
  return "absent";
}

function backupManifest({ from, to, installRoot, at }) {
  return { v: 1, from: text(from, 40), to: text(to, 40), installRoot: text(installRoot, 400), at: isNumber(at) ? at : 0 };
}

function parseManifest(raw) {
  let value = null;
  try { value = typeof raw === "string" ? JSON.parse(raw.replace(/^﻿/, "")) : raw; } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const manifest = backupManifest({ from: value.from, to: value.to, installRoot: value.installRoot, at: value.at });
  return manifest.from && manifest.installRoot ? manifest : null;
}

const norm = (value) => String(value ?? "").replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
const clean = (version) => String(version ?? "").replace(/^v/i, "").trim();

// A backup is offered only while it still describes this install: same folder,
// and the build that replaced it is the one running now. A reinstall by hand
// or a second portable copy therefore never inherits somebody else's backup.
function usableBackup(manifest, { installRoot, version }) {
  const parsed = parseManifest(manifest);
  if (!parsed) return null;
  if (norm(parsed.installRoot) !== norm(installRoot)) return null;
  if (parsed.to && clean(parsed.to) !== clean(version)) return null;
  if (clean(parsed.from) === clean(version)) return null;
  return { from: clean(parsed.from), to: clean(parsed.to), at: parsed.at };
}

function parseResult(raw) {
  let value = null;
  try { value = typeof raw === "string" ? JSON.parse(raw.replace(/^﻿/, "")) : raw; } catch { return null; }
  if (!value || typeof value !== "object") return null;
  return {
    ok: value.ok === true,
    rolledBack: value.rolledBack === true,
    rollbackFailed: value.rollbackFailed === true,
    stage: ["backup", "boot", "manual"].includes(value.stage) ? value.stage : null,
    from: clean(text(value.from, 40)),
    to: clean(text(value.to, 40)),
    at: isNumber(value.at) ? value.at : 0,
    reason: text(value.reason, 200),
  };
}

// One plain sentence for the owner, or null when the record says nothing went
// wrong (a successful result is never written).
function describeResult(result) {
  const r = parseResult(result);
  if (!r || (r.ok && !r.rolledBack)) return null;
  if (r.stage === "backup") return `Studio did not install v${r.to || "the update"}: it could not back up this version first, so nothing changed.`;
  if (r.rolledBack && r.rollbackFailed) return `v${r.to || "The update"} did not start and going back to v${r.from} did not finish. Reinstall from the release page to be safe.`;
  if (r.rolledBack && r.stage === "manual") return `Went back to v${r.from}.`;
  if (r.rolledBack) return `v${r.to || "The update"} did not start properly, so Studio went back to v${r.from}.`;
  return null;
}

// A stable, short folder name for one install, so two portable copies on one
// account keep separate backups. FNV-1a over the normalized path.
function installKey(installRoot) {
  let hash = 0x811c9dc5;
  for (const ch of norm(installRoot)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// True when a staged main.cjs still writes the health file, so the installing
// helper can wait for a flag this build will actually raise.
function releaseWritesHealth(mainSource) {
  return typeof mainSource === "string" && mainSource.includes(HEALTH_MARKER);
}

module.exports = {
  HEALTH_FILE,
  RESULT_FILE,
  MANIFEST_FILE,
  HEALTHY_FALLBACK_MS,
  beginBoot,
  reportHealthy,
  parseHealth,
  healthVerdict,
  backupManifest,
  parseManifest,
  usableBackup,
  parseResult,
  describeResult,
  installKey,
  releaseWritesHealth,
};
