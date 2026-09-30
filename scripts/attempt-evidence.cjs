// Before and after shots of the project preview, and where they are kept: the
// rules behind the Preview tab's Before / After (docs/architecture.md "Attempt
// review"). When Studio's own project preview is running, a hidden window takes
// a PNG when an attempt starts ("before") and when it ends ("after"). This
// module holds everything that needs no machine: whether to capture and why not,
// which addresses and requests the hidden window may use, where the files go,
// what a folder's record says, how old shots are pruned, and the sentences the
// page shows. scripts/attempt-evidence-host.cjs writes the files and
// scripts/evidence-window.cjs owns the window.
//
// The shots live under the project's own data folder,
// attempt-evidence/<task>/<n>/{before,after}.png. They are never in the
// repository and never in a problem report: a screenshot can show a secret.
//
// Pure module: no Electron, no filesystem, no network, no processes, no
// timers, no clock reads (time is injected).
"use strict";

const { taskKey, wholeNumber } = require("./attempt-snapshots.cjs");

const DIR = "attempt-evidence";
const MIB = 1024 * 1024;
const LIMITS = Object.freeze({
  // The window is always this size, whatever the display.
  width: 1280,
  height: 800,
  // The whole capture, load included, and the pause after the page says it loaded (fonts, a first paint).
  timeoutMs: 15000,
  settleMs: 800,
  // A PNG bigger than this is not kept (a photo-heavy page), and one bigger than the second is not sent to the page.
  imageBytes: 6 * MIB,
  dataUrlBytes: 3 * MIB,
  // Attempts per task that keep their pictures, folders kept, and the most the whole folder may hold.
  keepImages: 10,
  keepFolders: 20,
  totalBytes: 200 * MIB,
});
const PHASES = Object.freeze(["before", "after"]);
const isPhase = (phase) => PHASES.includes(phase);

// The line the Preview tab ends on (the approved wording).
const PRIVACY = "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report.";
const WHEN = Object.freeze({ before: "Captured when the task started.", after: "Captured when the task finished." });

// ---- where and whether ---------------------------------------------------------------------

// The preview's own address, when it is one on this PC: http or https on localhost, 127.0.0.1 or [::1], with no
// login in it (the same rule scripts/project-preview.cjs applies to what it opens).
function loopback(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) return null;
    return { url: url.href, origin: url.origin, host: url.host, secure: url.protocol === "https:" };
  } catch { return null; }
}

// Whether a request from the hidden window may go out. Only the preview's own origin (its pages, scripts, styles,
// images and its live-reload socket) and data: or blob: pieces of the page itself: no third party, no other port,
// no file. A page cannot use the capture to reach anything else.
function allowRequest(requestUrl, allowed) {
  if (!allowed?.host) return false;
  let url;
  try { url = new URL(String(requestUrl)); } catch { return false; }
  if (url.protocol === "data:" || url.protocol === "blob:" || requestUrl === "about:blank") return true;
  if (url.username || url.password) return false;
  const web = allowed.secure ? ["https:", "wss:"] : ["http:", "ws:"];
  return web.includes(url.protocol) && url.host === allowed.host;
}

const SAY = Object.freeze({
  off: "Screenshots are switched off on this PC.",
  "no-preview": { before: "The preview was not running when this task started.", after: "The preview was not running when this task finished." },
  "bad-url": "The preview is not on this PC's own address, so Studio did not open it.",
  failed: { before: "The preview did not answer when this task started, so there is no shot.", after: "The preview did not answer when this task finished, so there is no shot." },
  "too-big": "The picture was too large to keep.",
  "not-merged": "The work was not merged into the folder the preview shows, so there is no shot.",
});
const sayFor = (reason, phase) => {
  const entry = SAY[reason];
  return typeof entry === "string" ? entry : entry?.[phase === "after" ? "after" : "before"] ?? "";
};

// Whether to take the shot now. `prefs`: { shots } from scripts/review-prefs.cjs; `preview`: the project preview's own
// status ({ phase, url }), read without starting anything.
function planCapture({ phase, prefs, preview } = {}) {
  if (!isPhase(phase)) return { capture: false, reason: "failed", say: sayFor("failed", "before") };
  if (!prefs?.shots) return { capture: false, reason: "off", say: SAY.off };
  if (!preview || preview.phase !== "ready" || typeof preview.url !== "string" || !preview.url) return { capture: false, reason: "no-preview", say: sayFor("no-preview", phase) };
  const address = loopback(preview.url);
  if (!address) return { capture: false, reason: "bad-url", say: SAY["bad-url"] };
  return { capture: true, reason: null, say: "", url: address.url, allow: { host: address.host, secure: address.secure, origin: address.origin } };
}

// ---- names and records ------------------------------------------------------------------------

// The folder parts for one attempt, or null when the task has no safe name.
function folderParts(taskId, n) {
  const key = taskKey(taskId);
  const number = wholeNumber(n);
  return key && number ? [DIR, key, String(number)] : null;
}
const imageName = (phase) => (isPhase(phase) ? `${phase}.png` : null);

// meta.json: what was tried for each side of an attempt and how it went.
function metaOf(previous, { runId, phase, state, reason = null, at, bytes = null, width = null, height = null } = {}) {
  const base = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  if (!isPhase(phase)) return { v: 1, ...base };
  return {
    v: 1, ...(runId ? { runId } : base.runId ? { runId: base.runId } : {}),
    before: base.before ?? null, after: base.after ?? null,
    [phase]: { state, ...(reason ? { reason } : {}), at: Number(at) || 0, ...(bytes ? { bytes, width, height } : {}) },
  };
}
function parseMeta(text) {
  let parsed = null;
  try { parsed = JSON.parse(String(text ?? "")); } catch { return { v: 1, runId: null, before: null, after: null }; }
  const side = (value) => (value && typeof value === "object" && typeof value.state === "string" ? { state: value.state.slice(0, 20), reason: typeof value.reason === "string" ? value.reason.slice(0, 20) : null, at: Number(value.at) || 0, bytes: Number(value.bytes) || null, width: Number(value.width) || null, height: Number(value.height) || null } : null);
  return { v: 1, runId: typeof parsed?.runId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(parsed.runId) ? parsed.runId : null, before: side(parsed?.before), after: side(parsed?.after) };
}

// What the Preview tab says about one side of an attempt.
function noteFor(phase, side, hasImage) {
  if (hasImage) return WHEN[phase];
  if (!side) return "";
  if (side.state === "skipped") return sayFor(side.reason, phase) || sayFor("failed", phase);
  return sayFor("failed", phase);
}

// ---- keeping the folder small --------------------------------------------------------------------

// `listing`: one row per attempt folder, { key, n, at, images } (bytes the pictures hold). What to drop so each
// task keeps pictures for its newest `keepImages` attempts and folders for `keepFolders`, and the whole folder
// stays under `totalBytes` (the oldest pictures go first).
function prunePlan(listing, limits = LIMITS) {
  const rows = (Array.isArray(listing) ? listing : []).filter((row) => row && typeof row.key === "string" && Number.isSafeInteger(row.n));
  const byTask = new Map();
  for (const row of rows) byTask.set(row.key, [...(byTask.get(row.key) ?? []), row]);
  const dropImages = [];
  const dropFolders = [];
  const kept = [];
  for (const list of byTask.values()) {
    list.sort((a, b) => b.n - a.n).forEach((row, index) => {
      if (index >= limits.keepFolders) dropFolders.push({ key: row.key, n: row.n });
      else if (index >= limits.keepImages) { if (row.images > 0) dropImages.push({ key: row.key, n: row.n }); }
      else if (row.images > 0) kept.push(row);
    });
  }
  let total = kept.reduce((sum, row) => sum + row.images, 0);
  for (const row of kept.sort((a, b) => (a.at || 0) - (b.at || 0) || a.n - b.n)) {
    if (total <= limits.totalBytes) break;
    dropImages.push({ key: row.key, n: row.n });
    total -= row.images;
  }
  return { dropImages, dropFolders };
}

// The attempt numbers a task's folders hold.
function numbersOf(listing, key) {
  return (Array.isArray(listing) ? listing : []).filter((row) => row?.key === key && Number.isSafeInteger(row.n)).map((row) => row.n);
}

// ---- images -------------------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// The size a PNG says it has (its IHDR chunk), or null when the bytes are not a PNG.
function pngSize(bytes) {
  if (!bytes || bytes.length < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 16384 && height <= 16384 ? { width, height } : null;
}
// Whether a PNG may be kept, and whether it may be sent to the page as a data URL.
const keepable = (bytes) => Number.isFinite(bytes) && bytes > 0 && bytes <= LIMITS.imageBytes;
const sendable = (bytes) => Number.isFinite(bytes) && bytes > 0 && bytes <= LIMITS.dataUrlBytes;
const dataUrl = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

module.exports = {
  DIR, LIMITS, PHASES, PRIVACY, WHEN, SAY,
  isPhase, loopback, allowRequest, sayFor, planCapture, folderParts, imageName, metaOf, parseMeta, noteFor, prunePlan, numbersOf, pngSize, keepable, sendable, dataUrl,
};
