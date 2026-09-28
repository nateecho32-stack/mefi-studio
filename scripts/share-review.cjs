"use strict";

// Share review: what Studio checks before anything leaves this PC (for the
// owner's other PCs or for friends) and before anything received is kept.
// Pure: no I/O, no clock, no model calls, so the same rules run on both ends
// and tests pin them. scan() reports findings; scrub() returns a deep copy
// with every string passed through scripts/redaction.cjs plus the rules
// here. Received brains, pipelines and setups are also checked for
// instructions aimed at an agent (prompt injection) and for ways to send data
// out, because a shared brain is text a model will later read as
// instructions. Guarded by tests/share_review.test.mjs.
const os = require("node:os");
const { scrubOutbound } = require("./redaction.cjs");

const MAX_DEPTH = 12;
const MAX_STRINGS = 20000;

// Each rule: an id, how serious it is, what the owner reads, and a pattern.
// "block" findings stop a share until the owner removes them; "warn" ones are
// shown and scrubbed.
const RULES = Object.freeze([
  { id: "private-key", level: "block", label: "a private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "api-key", level: "block", label: "an API key or token", re: /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,})\b/ },
  { id: "jwt", level: "block", label: "a sign-in token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "assigned-secret", level: "block", label: "a password or secret value", re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?[^\s"',;}{]{6,}/i },
  { id: "url-credential", level: "block", label: "a link with a login in it", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i },
  { id: "home-path", level: "warn", label: "a folder path with your user name", re: /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>|]+|(?<![\w.-])\/(?:home|Users)\/[^\\/\s"'<>|]+/ },
  { id: "drive-path", level: "warn", label: "a folder path on this PC", re: /\b[A-Za-z]:[\\/][^\s"'<>|]{2,}/ },
  // Not the user:password part of a link, which url-credential reports.
  { id: "email", level: "warn", label: "an email address", re: /(?<![:/])\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: "ip", level: "warn", label: "a network address", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/ },
]);

// Instructions aimed at an agent, and ways to move data off a machine. These
// matter in received brains, pipelines, setups and notes.
const INJECTION = Object.freeze([
  { id: "override", label: "tells an agent to ignore its instructions", re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|system|all)\b[^.\n]{0,30}\b(?:instructions?|prompts?|rules?|messages?)\b/i },
  { id: "role-claim", label: "claims to be the system or the owner", re: /(?:^|\n)\s*(?:system|developer|assistant)\s*(?:prompt|message)?\s*:|\byou are now\b|\bnew instructions?\s*:/i },
  { id: "secret-request", label: "asks for keys, tokens or passwords", re: /\b(?:send|share|post|upload|reveal|print|show|give|paste|include|exfiltrate)\b[^.\n]{0,60}\b(?:api[ -]?keys?|tokens?|passwords?|secrets?|credentials?|\.env|ssh keys?|cookies?)\b/i },
  { id: "remote-script", label: "runs a script downloaded from the internet", re: /\b(?:curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^\n|]{0,200}\|\s*(?:sh|bash|zsh|iex|invoke-expression|python|node|pwsh|powershell)\b/i },
  { id: "encoded-command", label: "runs an encoded or hidden command", re: /-(?:enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}|\bfrombase64string\b|\beval\s*\(\s*atob\s*\(/i },
  { id: "exfil-host", label: "sends data to a paste, webhook or tunnel service", re: /\b(?:pastebin\.com|transfer\.sh|webhook\.site|requestbin|ngrok\.io|ngrok-free\.app|trycloudflare\.com|discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com)\b/i },
  { id: "hidden-text", label: "contains invisible or direction-changing characters", re: /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/ },
]);

const REPLACEMENTS = Object.freeze([
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9_]{16,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}|\bglpat-[A-Za-z0-9_-]{16,}/g, "[redacted key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted token]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, "[address]"],
  [/\b[A-Za-z]:[\\/][^\s"'<>|]{2,}/g, "[path]"],
  [/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, ""],
]);

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Words that name this machine or this account: the PC's name and the user
// name. They are scrubbed and reported wherever they appear.
function localNames({ hostname = os.hostname(), username = safeUser() } = {}) {
  return [hostname, username].filter((name) => typeof name === "string" && name.length >= 3);
}
function safeUser() { try { return os.userInfo().username; } catch { return ""; } }

// Every string in a value with where it sits ("brain.steps[2].prompt").
// `walk.cut` says the walk stopped at a limit with text left unread: 20,000
// padding strings or a deep nest in front of a note would otherwise hide it.
function strings(value, where = "", out = [], depth = 0, walk = { cut: false }) {
  const nested = value && typeof value === "object";
  if (typeof value !== "string" && !(nested && Object.keys(value).length)) return out;
  if (out.length >= MAX_STRINGS || depth > MAX_DEPTH) { walk.cut = true; return out; }
  if (typeof value === "string") out.push([where || "(text)", value]);
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${where}[${index}]`, out, depth + 1, walk));
  else for (const [key, item] of Object.entries(value)) {
    strings(key, `${where}${where ? "." : ""}(key ${key.slice(0, 40)})`, out, depth + 1, walk);
    strings(item, `${where}${where ? "." : ""}${key}`, out, depth + 1, walk);
  }
  return out;
}

// Findings for one value. `received` adds the injection checks (they also run
// on anything a PC shares, since the same text lands on the next PC).
function scan(value, { received = true, names = localNames() } = {}) {
  const findings = [];
  const seen = new Set();
  const add = (finding) => {
    const key = `${finding.id}|${finding.where}`;
    if (!seen.has(key)) { seen.add(key); findings.push(finding); }
  };
  const nameRules = names.map((name) => ({ id: "this-pc", level: "warn", label: "this PC's name or your user name", re: new RegExp(`\\b${escapeRegExp(name)}\\b`, "i") }));
  const walk = { cut: false };
  for (const [where, text] of strings(value, "", [], 0, walk)) {
    for (const rule of [...RULES, ...nameRules]) if (rule.re.test(text)) add({ id: rule.id, level: rule.level, label: rule.label, where });
    if (received) for (const rule of INJECTION) if (rule.re.test(text)) add({ id: rule.id, level: "block", label: rule.label, where });
  }
  // What was never read cannot pass as checked.
  if (walk.cut) add({ id: "unchecked", level: "block", label: "more text or deeper nesting than Studio checks", where: "the whole item" });
  const order = { block: 0, warn: 1 };
  findings.sort((a, b) => order[a.level] - order[b.level] || a.where.localeCompare(b.where));
  return { ok: !findings.some((item) => item.level === "block"), findings };
}

// A copy with every string scrubbed. Blocked content is not made safe by
// this: scan() still decides whether an item may go.
function scrub(value, { names = localNames() } = {}, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === "string") {
    let text = scrubOutbound(value);
    for (const [re, replacement] of REPLACEMENTS) text = text.replace(re, replacement);
    for (const name of names) text = text.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), "[this PC]");
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, { names }, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key, { names }, depth + 1), scrub(item, { names }, depth + 1)]));
  return value;
}

// One sentence per finding, blocked first, for a preview or a quarantine card.
function explain(findings) {
  return (findings ?? []).map((item) => `${item.level === "block" ? "Stopped" : "Removed"}: ${item.label} (${item.where}).`);
}

module.exports = { RULES, INJECTION, scan, scrub, explain, localNames };
