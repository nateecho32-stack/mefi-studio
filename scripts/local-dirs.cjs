// Mefi's Studio AI+ — the local folder: what Studio keeps on this PC only.
//
// The log archive, the work journal, migration backups and the dev tools'
// output belong to this PC and only ever grow (old logs are archived and all
// kept, the owner's rule for 0.4.5), so they must never ride a sync client.
// OneDrive holds the Desktop and so, often, the projects themselves: it would
// re-upload every appended segment and every sealed archive, and a conflict
// copy of a half-written file is worse than none. This module picks the folder
// and names the layout under it; the callers make the folders.
//
// The order: the owner's own choice (Settings › Storage), then the
// MEFI_STUDIO_LOCAL_DIR environment variable, then the platform's local-state
// folder:
//   win32   %LOCALAPPDATA%\MefiStudio (or <home>\AppData\Local\MefiStudio)
//   darwin  ~/Library/Application Support/MefiStudio
//   other   $XDG_STATE_HOME/mefi-studio (or ~/.local/state/mefi-studio)
// A candidate inside OneDrive (under the OneDrive, OneDriveConsumer or
// OneDriveCommercial folder the environment names, or with any path segment
// that starts with "OneDrive") is refused, and so is a relative one; the next
// candidate is tried. When none is left the answer is <userData>/local. The
// result says which rule chose the folder and what was refused on the way, so
// the host can say so once.
//
// The layout under the root:
//   journal/<projectId>/   the per-project work journal (0.4.5 A1)
//   journal/<projectId>/runs/  a builder's output per run (run-journal.cjs),
//                          and desk.json, the desk server's saved port
//   logs/                  the log core's active segments (log-core.cjs)
//   archive/<kind>/        sealed monthly archives (segment-archive.cjs)
//   migrations/<date>/     verified backups taken before a migration
//   dev-logs/              the dev tools' and --capture output
//   resources/             the resource manager's helper program and its
//                          journal (resource-host.cjs)
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const path = require("node:path");

const APP_FOLDER = Object.freeze({ win32: "MefiStudio", darwin: "MefiStudio", other: "mefi-studio" });
const ONEDRIVE_ENV = Object.freeze(["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]);
const LAYOUT = Object.freeze({ journal: "journal", runs: "runs", logs: "logs", archive: "archive", migrations: "migrations", devLogs: "dev-logs", resources: "resources", fallback: "local" });
const RULES = Object.freeze(["chosen", "env", "platform", "userData"]);

const pathsFor = (platform) => (platform === "win32" ? path.win32 : path.posix);
const text = (value) => (typeof value === "string" ? value.trim() : "");

// A path as the platform compares it: normalised, without a trailing
// separator, and without regard to case on Windows.
function comparable(dir, platform) {
  const paths = pathsFor(platform);
  let out = paths.normalize(dir);
  while (out.length > 1 && out.endsWith(paths.sep) && !(platform === "win32" && /^[a-z]:\\$/i.test(out))) out = out.slice(0, -1);
  return platform === "win32" ? out.toLowerCase() : out;
}

function segmentsOf(dir, platform) {
  return String(dir).split(platform === "win32" ? /[\\/]+/ : /\/+/).filter(Boolean);
}

/**
 * Why `dir` counts as inside OneDrive, or null: "env:<name>" when it sits
 * under the folder that environment variable names, "segment:<part>" when one
 * of its path segments starts with "OneDrive".
 */
function insideOneDrive(dir, { platform = process.platform, env = {} } = {}) {
  const value = text(dir);
  if (!value) return null;
  const paths = pathsFor(platform);
  const target = comparable(value, platform);
  for (const name of ONEDRIVE_ENV) {
    const root = text(env?.[name]);
    if (!root || !paths.isAbsolute(root)) continue;
    const base = comparable(root, platform);
    const sep = platform === "win32" ? "\\" : "/";
    if (target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) return `env:${name}`;
  }
  const part = segmentsOf(value, platform).find((segment) => /^onedrive/i.test(segment));
  return part ? `segment:${part}` : null;
}

// The platform's own local-state folder, or "" when there is no home to hang
// it from. A relative LOCALAPPDATA or XDG_STATE_HOME is ignored, as the XDG
// rules say to.
function platformDir(platform, env, home) {
  const paths = pathsFor(platform);
  const absolute = (value) => (value && paths.isAbsolute(value) ? value : "");
  if (platform === "win32") {
    const base = absolute(text(env?.LOCALAPPDATA)) || (home ? paths.join(home, "AppData", "Local") : "");
    return base ? paths.join(base, APP_FOLDER.win32) : "";
  }
  if (platform === "darwin") return home ? paths.join(home, "Library", "Application Support", APP_FOLDER.darwin) : "";
  const base = absolute(text(env?.XDG_STATE_HOME)) || (home ? paths.join(home, ".local", "state") : "");
  return base ? paths.join(base, APP_FOLDER.other) : "";
}

// One folder name from a caller's id: letters, digits, dot, dash and
// underscore only, no leading dots, no trailing dot, never a Windows device
// name, at most 96 characters. An id that leaves nothing is refused.
function folderName(value, what) {
  let name = String(value ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_").replace(/\.+$/, "_").slice(0, 96);
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = `_${name}`;
  if (!name || /^_+$/.test(name)) throw new TypeError(`${what} needs a name made of letters or digits`);
  return name;
}

// YYYY-MM-DD from a Date, a time in ms or a "YYYY-MM-DD…" string; the local
// calendar day, since the folder is for people to find.
function dayOf(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value.trim().slice(0, 10);
  const date = value instanceof Date ? value : typeof value === "number" || typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new TypeError("migrationsDir needs a date");
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-");
}

/**
 * The local folder and its layout:
 * { root, rule, rejected: [{rule, dir, reason, detail?}], oneDrive,
 *   journalDir(projectId), runsDir(projectId), logsDir(), archiveDir(kind?), migrationsDir(date),
 *   devLogsDir(), resourcesDir() }.
 * `rule` is "chosen", "env", "platform" or "userData"; `oneDrive` is only
 * ever true for the userData fallback, when even that sits inside OneDrive.
 */
function localRoot({ platform = process.platform, env = {}, homedir = "", userData = "", chosen = null } = {}) {
  const paths = pathsFor(platform);
  const home = text(homedir) || text(platform === "win32" ? env?.USERPROFILE : env?.HOME);
  const candidates = [
    { rule: "chosen", dir: text(chosen) },
    { rule: "env", dir: text(env?.MEFI_STUDIO_LOCAL_DIR) },
    { rule: "platform", dir: platformDir(platform, env, home) },
  ];
  const rejected = [];
  let pick = null;
  for (const candidate of candidates) {
    if (!candidate.dir) continue;
    if (!paths.isAbsolute(candidate.dir)) {
      rejected.push({ rule: candidate.rule, dir: candidate.dir, reason: "relative" });
      continue;
    }
    const dir = paths.normalize(candidate.dir);
    const oneDrive = insideOneDrive(dir, { platform, env });
    if (oneDrive) {
      rejected.push({ rule: candidate.rule, dir, reason: "onedrive", detail: oneDrive });
      continue;
    }
    pick = { rule: candidate.rule, dir };
    break;
  }
  let synced = false;
  if (!pick) {
    const base = text(userData);
    if (!base || !paths.isAbsolute(base)) throw new TypeError("localRoot needs an absolute userData folder to fall back on");
    pick = { rule: "userData", dir: paths.join(paths.normalize(base), LAYOUT.fallback) };
    synced = Boolean(insideOneDrive(pick.dir, { platform, env }));
  }
  const root = pick.dir;
  return Object.freeze({
    root,
    rule: pick.rule,
    rejected: Object.freeze(rejected.map((entry) => Object.freeze(entry))),
    oneDrive: synced,
    journalDir: (projectId) => paths.join(root, LAYOUT.journal, folderName(projectId, "journalDir")),
    runsDir: (projectId) => paths.join(root, LAYOUT.journal, folderName(projectId, "runsDir"), LAYOUT.runs),
    logsDir: () => paths.join(root, LAYOUT.logs),
    archiveDir: (kind = null) => (kind === null || kind === undefined || kind === "" ? paths.join(root, LAYOUT.archive) : paths.join(root, LAYOUT.archive, folderName(kind, "archiveDir"))),
    migrationsDir: (date) => paths.join(root, LAYOUT.migrations, dayOf(date)),
    devLogsDir: () => paths.join(root, LAYOUT.devLogs),
    resourcesDir: () => paths.join(root, LAYOUT.resources),
  });
}

/** One plain sentence about a refused folder, or "" when the first choice held. */
function explain(result) {
  const refused = result?.rejected ?? [];
  if (!refused.length && !result?.oneDrive) return "";
  const why = (entry) => (entry.reason === "relative" ? `${entry.dir} is not a full path` : `${entry.dir} is inside OneDrive`);
  const parts = refused.map(why);
  const where = result?.oneDrive
    ? `${result.root}, which is inside OneDrive too; set MEFI_STUDIO_LOCAL_DIR to a folder outside it`
    : result?.root;
  return `${parts.length ? `${parts.join("; ")}, so ` : ""}Studio keeps its local files in ${where}.`;
}

module.exports = { APP_FOLDER, ONEDRIVE_ENV, LAYOUT, RULES, localRoot, insideOneDrive, explain };
