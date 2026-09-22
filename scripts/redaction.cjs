// Everything Studio sends to a remote model passes through here first.
//
// Two jobs, deliberately separate:
//   scrubOutbound(text) — the transmission gate. One pass over a payload that
//     is already bounded by its caller, applied at the single choke point
//     (assistantFetch) rather than at each of the eight call sites above it.
//   safeExcerpt(value, max) — the Analyzer's field clipper, which scrubs and
//     then truncates. It lived in analyzer.mjs and moved here so there is one
//     definition of what counts as a credential.
//
// What is masked, and why only this much: a home prefix leaks the account name
// out of every absolute path in the facts, so it is replaced with `~` while the
// rest of the path is kept — "~/Coding Projects/…" still lets the assistant
// talk about the project, which whole-path masking would destroy. The
// credential patterns stay narrow on purpose (a known key shape, or an
// assignment whose left side names a secret) so a task about "the token map"
// or a file called secrets.md still reads normally.
//
// What is NOT covered: the executor prompt. A coding worker runs cwd-scoped in
// the real project and needs real paths to find files, so masking them there
// would break the run — a worse outcome than the leak. That prompt does reach a
// provider through the worker's own CLI; the trade is deliberate, not an
// oversight. See buildExecutorPrompt in main.cjs.
const os = require("node:os");

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The real home directory, matched in either separator form. Built once: this
// runs on every assistant call and the value cannot change while the app runs.
function homePattern() {
  let home = "";
  try { home = os.homedir() ?? ""; } catch { home = ""; }
  home = String(home).replace(/[\\/]+$/, "");
  if (home.length < 4) return null;
  // Accept `\` and `/` interchangeably wherever the real path has a separator,
  // because the same directory reaches us both ways (path.join vs a JSON URL).
  const body = home.split(/[\\/]/).map(escapeRegExp).join("[\\\\/]");
  return new RegExp(body, "gi");
}

const HOME = homePattern();

// A drive letter cannot appear inside a URL path, so this form is safe to
// rewrite wherever it is found. The bare `/Users/<name>` and `/home/<name>`
// forms are ambiguous with ordinary URL paths, so only the account-name segment
// of an actual home directory is taken, and the generic unix shapes are left to
// the HOME pass above.
const WINDOWS_HOME = /\b[A-Za-z]:[\\/]Users[\\/][^\\/\r\n"'<>|?*]+/g;
const LINUX_HOME = /(?<![\w.-])\/home\/[^\\/\r\n"'<>|?*\s]+/g;

const PRIVATE_KEY = /-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/g;
const KEY_SHAPES = /\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g;
const ASSIGNED_SECRET = /((?:password|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*)(?:["'][^"'\r\n]*["']|[^\s,;}]+)/gi;
const URL_BASIC_AUTH = /(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi;

/** Replace credential-shaped text. Shared by both exports. */
function maskCredentials(text) {
  return text
    .replace(PRIVATE_KEY, "[redacted private key]")
    .replace(KEY_SHAPES, "[redacted credential]")
    .replace(ASSIGNED_SECRET, "$1[redacted]")
    .replace(URL_BASIC_AUTH, "$1[redacted]@");
}

/** Replace any home directory prefix with `~`, keeping the rest of the path. */
function maskHome(text) {
  let out = HOME ? text.replace(HOME, "~") : text;
  return out.replace(WINDOWS_HOME, "~").replace(LINUX_HOME, "~");
}

/**
 * The transmission gate: credentials and home prefixes out, length unchanged
 * otherwise. Callers bound their own payloads; this must never truncate, or a
 * chat turn would silently lose the end of the user's own question.
 */
function scrubOutbound(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!text) return text;
  return maskHome(maskCredentials(text));
}

/**
 * Analyzer field clipper: scrub, trim, then truncate to [max]. Kept distinct
 * from scrubOutbound because truncation is an Analyzer display concern, not a
 * privacy one.
 */
function safeExcerpt(value, max = 220) {
  return maskCredentials(String(value ?? "")).trim().slice(0, max);
}

module.exports = { scrubOutbound, safeExcerpt, maskHome, maskCredentials };
