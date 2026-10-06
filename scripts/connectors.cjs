// Team › Connectors: the host half. A connector is an MCP server (agent-mcp.cjs)
// that gives agents extra tools, like a browser or GitHub. This module keeps the
// owner's list in ~/.mefi-studio/mcp.json, the same device file Studio always
// read, and nothing else in it changes shape: a server written by hand keeps
// working as before.
//
//  - add       puts a server in the list as `pending`: Studio never starts one the
//              owner has not approved. A command line is split into the program and
//              its arguments here; nothing ever runs through a shell.
//  - approve   stamps the exact thing it runs (agent-mcp.cjs fingerprint): if the
//              command, its arguments, the names of its settings or its address
//              change later, it waits for approval again. The page sends back the
//              fingerprint it showed, so what is approved is what was read.
//  - test      starts it, asks for its tools and stops it; the tools it named are
//              what agents are offered (bounded and cleaned by agent-mcp.cjs).
//  - update    on or off, which places get it (chat, agents, builders), tools off.
//  - remove    keeps a copy of the file first.
//  - candidates / importFrom   the servers other apps on this PC already use
//              (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex,
//              OpenCode, Gemini CLI, and the open project's own files). Nothing
//              loads by itself: picked ones arrive pending, and a value such as a
//              token comes along only when the owner says so.
//  - secrets   the values a connector needs (a token) are kept encrypted by the
//              host (`encrypt`/`decrypt`, Electron's safeStorage) in their own file
//              in Studio's data folder, never in mcp.json and never sent to the page:
//              the page sees names and whether a value is saved. envFor() hands
//              them to a starting server.
//
// Host module: the files, the clock, the encryption and the MCP client come in
// through the factory. Nothing here throws to its caller: a refusal is
// { ok: false, error }.
"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const mcpLib = require("./agent-mcp.cjs");

const PLACES = mcpLib.PLACES;
const KEEP_BACKUPS = 10;
const MAX_SERVERS = 32;
const SOURCE_BYTES = 16 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Servers worth knowing about, each one command Studio shows before anything runs.
const FEATURED = Object.freeze([
  { id: "playwright", title: "Playwright browser", description: "Lets a builder open your app in a real browser, click around and take screenshots, so it can see what it made.", command: "npx", args: ["-y", "@playwright/mcp@latest"], envKeys: [], needs: "Node.js", places: ["builders"] },
  { id: "context7", title: "Context7 docs", description: "Looks up current documentation for the libraries your project uses, so agents stop guessing at old ones.", command: "npx", args: ["-y", "@upstash/context7-mcp"], envKeys: [], needs: "Node.js", places: ["builders"] },
  { id: "github", title: "GitHub", description: "Issues, pull requests and files on GitHub. It needs a GitHub token; Studio uses the one you saved for GitHub if there is one.", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"], needs: "Node.js and a GitHub token", places: ["builders"] },
  { id: "memory", title: "Memory", description: "A small notebook agents can write facts into and read back later.", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], envKeys: [], needs: "Node.js", places: ["builders"] },
  { id: "sequential-thinking", title: "Step-by-step thinking", description: "A scratchpad that helps an agent work through a hard problem one step at a time.", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], envKeys: [], needs: "Node.js", places: ["builders"] },
].map((entry) => Object.freeze({ ...entry, args: Object.freeze([...entry.args]), envKeys: Object.freeze([...entry.envKeys]), places: Object.freeze([...entry.places]) })));

// ---- pure helpers ---------------------------------------------------------------------------------------

/** A command line as a program and its arguments: "a b" or 'a b' keep spaces, \" is a quote inside "…". Null when quotes do not close. */
function parseLine(line) {
  const text = String(line ?? "").trim();
  if (!text || text.length > 4000 || /[\r\n\u0000]/.test(text)) return null;
  const words = [];
  let current = "", quote = null, started = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === "\"" && text[at + 1] === "\"") { current += "\""; at += 1; }
      else current += char;
    } else if (char === "\"" || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started || current) { words.push(current); current = ""; started = false; } }
    else { current += char; started = true; }
  }
  if (quote) return null;
  if (started || current) words.push(current);
  return words.length && words[0] ? { command: words[0], args: words.slice(1) } : null;
}
/** A program and its arguments as one line to read, quoting what holds spaces or quotes. */
function displayLine(command, args = []) {
  const quote = (word) => (word === "" || /[\s"']/.test(word) ? `"${String(word).replace(/"/g, "\\\"")}"` : word);
  return [command, ...(Array.isArray(args) ? args : [])].map((word) => quote(String(word ?? ""))).join(" ");
}
/** A name another app gave a server, as an id Studio can use: lowercase letters, numbers, dashes and underscores. */
function idFrom(name) {
  const id = String(name ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 40);
  return ID.test(id) ? id : "";
}
/** JSON with comments and trailing commas (VS Code's and OpenCode's files), as plain JSON. Text inside strings is never changed. */
function stripJsonc(text) {
  let out = "", quote = false, comma = -1;
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (quote) {
      out += char;
      if (char === "\\") { out += source[at + 1] ?? ""; at += 1; } else if (char === "\"") quote = false;
    } else if (char === "\"") { quote = true; comma = -1; out += char; }
    else if (char === "/" && source[at + 1] === "/") { while (at < source.length && source[at] !== "\n") at += 1; out += "\n"; }
    else if (char === "/" && source[at + 1] === "*") { at += 2; while (at < source.length && !(source[at] === "*" && source[at + 1] === "/")) at += 1; at += 1; }
    else if (char === ",") { comma = out.length; out += char; }
    // A comma whose next real character closes the object or the list was a trailing one: it goes.
    else if ((char === "}" || char === "]") && comma >= 0) { out = out.slice(0, comma) + out.slice(comma + 1) + char; comma = -1; }
    else { if (!/\s/.test(char)) comma = -1; out += char; }
  }
  return out;
}
// One TOML value Codex's config uses for servers: a string, an array of strings, an inline table of strings, a boolean.
// A TOML basic string's inside, escapes decoded in pairs: \\\\ is one backslash, so a Windows path written the TOML way reads right.
function tomlString(inside) {
  let out = "";
  for (let at = 0; at < inside.length; at += 1) {
    const char = inside[at];
    if (char !== "\\") { out += char; continue; }
    const next = inside[at + 1];
    at += 1;
    if (next === "u" || next === "U") {
      const width = next === "u" ? 4 : 8, hex = inside.slice(at + 1, at + 1 + width);
      if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === width) { const code = parseInt(hex, 16); out += code <= 0x10ffff ? String.fromCodePoint(code) : ""; at += width; continue; }
    }
    out += { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", "\"": "\"", "\\": "\\" }[next] ?? `\\${next ?? ""}`;
  }
  return out;
}
function tomlValue(raw) {
  const text = raw.trim();
  if (/^"/.test(text)) return /^"(?:[^"\\]|\\.)*"$/s.test(text) ? tomlString(text.slice(1, -1)) : null;
  if (/^'/.test(text)) return text.endsWith("'") ? text.slice(1, -1) : null;
  if (text === "true" || text === "false") return text === "true";
  if (/^\[/.test(text)) {
    const items = [];
    for (const match of text.slice(1, -1).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) items.push(match[1] !== undefined ? tomlString(match[1]) : match[2]);
    return items.filter((item) => typeof item === "string");
  }
  if (/^\{/.test(text)) {
    const table = {};
    for (const match of text.slice(1, -1).matchAll(/([A-Za-z0-9_-]+|"[^"]+")\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|true|false)/g)) {
      const key = match[1].replace(/^"|"$/g, "");
      if (!UNSAFE_KEYS.has(key)) table[key] = tomlValue(match[2]);
    }
    return table;
  }
  return null;
}
/** Codex's config.toml: the [mcp_servers.<name>] tables, as { name: { command, args, env, url, ... } }. */
function parseCodexToml(text) {
  // Tables with no prototype while they fill: a server, table or setting named __proto__ is skipped, never assigned.
  const servers = Object.create(null);
  const tableOf = (name, sub) => { const server = (servers[name] ??= Object.create(null)); return sub ? (server[sub] ??= Object.create(null)) : server; };
  let table = null, sub = null, pending = "", key = null;
  const strip = (line) => {
    let quote = null;
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at];
      if (quote) { if (char === "\\" && quote === "\"") at += 1; else if (char === quote) quote = null; }
      else if (char === "\"" || char === "'") quote = char;
      else if (char === "#") return line.slice(0, at);
    }
    return line;
  };
  for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = strip(raw).trim();
    if (key !== null) {
      pending += ` ${line}`;
      if ((pending.match(/\[/g) || []).length <= (pending.match(/\]/g) || []).length) { if (table) tableOf(table, sub)[key] = tomlValue(pending); key = null; pending = ""; }
      continue;
    }
    if (!line) continue;
    const header = /^\[\s*mcp_servers\.("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?\s*\]$/.exec(line);
    if (header) {
      table = header[1].replace(/^["']|["']$/g, ""); sub = header[2] || null;
      if (UNSAFE_KEYS.has(table) || UNSAFE_KEYS.has(sub)) { table = null; sub = null; continue; }
      tableOf(table, sub);
      continue;
    }
    if (/^\[/.test(line)) { table = null; sub = null; continue; }
    if (!table) continue;
    const pair = /^([A-Za-z0-9_-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
    if (!pair) continue;
    const name = pair[1].replace(/^"|"$/g, "");
    if (UNSAFE_KEYS.has(name)) continue;
    if (/^\[/.test(pair[2]) && (pair[2].match(/\[/g) || []).length > (pair[2].match(/\]/g) || []).length) { key = name; pending = pair[2]; continue; }
    tableOf(table, sub)[name] = tomlValue(pair[2]);
  }
  // Ordinary objects again for the callers, built from the safe ones.
  const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : value);
  return plain(servers);
}
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// A value another app wrote for a setting: a real one, or a placeholder it fills in itself (${VAR}, ${input:x}).
const placeholder = (value) => typeof value !== "string" || !value || /\$\{[^}]*\}|^\$[A-Za-z_]|%[A-Za-z_]+%|<[^>]+>/.test(value);
/** One server as another app wrote it, in Studio's words; `values` are the real setting values found (host only). */
function fromOther(name, entry, source, { codex = false, deviceEnv = {} } = {}) {
  if (!record(entry)) return null;
  const type = String(entry.type ?? entry.transport ?? "").toLowerCase();
  const url = entry.url ?? entry.serverUrl ?? entry.httpUrl ?? null;
  const values = {}, headerKeys = {};
  let envKeys = [];
  const env = record(entry.env) ? entry.env : record(entry.environment) ? entry.environment : {};
  for (const [key, value] of Object.entries(env)) if (mcpLib.envName(key)) { envKeys.push(key); if (!placeholder(value)) values[key] = String(value); }
  // Codex names the setting that holds an online server's bearer token; any other app's file saying so is not trusted with it.
  if (codex && typeof entry.bearer_token_env_var === "string" && mcpLib.envName(entry.bearer_token_env_var)) {
    headerKeys.Authorization = entry.bearer_token_env_var;
    const value = deviceEnv?.[entry.bearer_token_env_var];
    if (typeof value === "string" && value) values[entry.bearer_token_env_var] = value;
  }
  if (record(entry.headers)) {
    for (const [header, value] of Object.entries(entry.headers).slice(0, 8)) {
      if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header)) continue;
      const key = `${idFrom(name).replace(/-/g, "_").toUpperCase() || "SERVER"}_${header.replace(/-/g, "_").toUpperCase()}`.slice(0, 120);
      headerKeys[header] = key;
      if (!placeholder(value)) values[key] = String(value);
    }
  }
  envKeys = [...new Set(envKeys)].slice(0, 32);
  if (url && (type === "http" || type === "streamable-http" || type === "remote" || entry.httpUrl || !entry.command)) {
    const address = mcpLib.httpAddress(String(url));
    const sse = type === "sse" || /\/sse\/?$/.test(String(url));
    return { name: String(name), transport: "http", url: address || String(url).slice(0, 300), headerKeys, envKeys: [], values, source, supported: Boolean(address) && !sse, why: !address ? "Studio reads https:// addresses, or http:// on this PC." : sse ? "This connector uses the older SSE connection, which Studio can't use." : "" };
  }
  let command = entry.command, args = Array.isArray(entry.args) ? entry.args : [];
  if (Array.isArray(command)) { args = command.slice(1); command = command[0]; }
  if (typeof command !== "string" || !command.trim()) return null;
  args = args.filter((arg) => typeof arg === "string").slice(0, 64);
  return { name: String(name), transport: "stdio", command: command.trim(), args, envKeys, values, source, supported: true, why: "" };
}

// ---- the host module -----------------------------------------------------------------------------------

function createConnectors({
  file = mcpLib.CONFIG, fs = fsp, home = os.homedir(), appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  projectRoot = () => null, secretFile = null, encrypt = null, decrypt = null, canEncrypt = () => typeof encrypt === "function" && typeof decrypt === "function",
  fallbackEnv = () => null, backups = null, mcp = mcpLib, now = Date.now, env = process.env, platform = process.platform, testTimeoutMs = 120000,
} = {}) {
  let tail = Promise.resolve();
  // Writes one after another, each on a fresh read: two changes at once both land.
  const serial = (work) => { const run = tail.then(work, work); tail = run.catch(() => {}); return run; };
  class Refusal extends Error {}
  const refuse = (message) => new Refusal(message);
  const safely = (work) => async (...args) => {
    try { return await work(...args); } catch (error) {
      if (error instanceof Refusal) return { ok: false, error: error.message };
      return { ok: false, error: `That could not be done (${String(error?.code || error?.message || "unknown").slice(0, 120)}).` };
    }
  };
  const shown = (target) => {
    const homeDir = String(home ?? "");
    const value = String(target ?? "");
    return homeDir && value.toLowerCase().startsWith(homeDir.toLowerCase()) ? `~${value.slice(homeDir.length).replace(/\\/g, "/")}` : value.replace(/\\/g, "/");
  };

  async function readRaw() {
    let text;
    try { text = await fs.readFile(file, "utf8"); } catch (error) { if (error?.code === "ENOENT") return { servers: {} }; throw refuse("The connectors file can't be read."); }
    if (text.length > 512000) throw refuse("The connectors file is too big to change here.");
    let parsed;
    try { parsed = JSON.parse(text.replace(/^﻿/, "")); } catch { throw refuse(`${shown(file)} is not valid JSON, so Studio leaves it alone. Fix it by hand or move it aside.`); }
    if (!record(parsed)) throw refuse(`${shown(file)} is not a JSON object.`);
    if (parsed.servers !== undefined && !record(parsed.servers)) throw refuse(`${shown(file)} has a "servers" that is not an object.`);
    parsed.servers ??= {};
    return parsed;
  }
  async function replaceFile(target, text) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${crypto.randomBytes(5).toString("hex")}`;
    try {
      await fs.writeFile(temporary, text, { mode: 0o600, flag: "wx" });
      for (let attempt = 0; ; attempt += 1) {
        try { await fs.rename(temporary, target); return; } catch (error) {
          if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt >= 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        }
      }
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  async function keepCopy(reason) {
    const place = typeof backups === "function" ? backups() : null;
    if (!place) return;
    try {
      const text = await fs.readFile(file, "utf8");
      await fs.mkdir(place, { recursive: true });
      await fs.writeFile(path.join(place, `mcp-${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${reason}.json`), text, { mode: 0o600, flag: "wx" });
      const kept = (await fs.readdir(place)).filter((name) => /^mcp-.*\.json$/.test(name)).sort();
      for (const old of kept.slice(0, Math.max(0, kept.length - KEEP_BACKUPS))) await fs.rm(path.join(place, old), { force: true }).catch(() => {});
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw refuse("Studio could not keep a copy of the connectors file first, so nothing was changed.");
    }
  }
  // Change the file: `change(config)` edits the parsed object (false: nothing to write).
  const mutate = (change) => serial(async () => {
    const config = await readRaw();
    const result = await change(config);
    if (result === false) return null;
    await replaceFile(file, `${JSON.stringify(config, null, 2)}\n`);
    return result;
  });

  // ---- secrets ----
  // For reading a value: anything unreadable is simply not there.
  async function readSecrets() {
    if (!secretFile) return {};
    try {
      const parsed = JSON.parse(await fs.readFile(secretFile, "utf8"));
      return record(parsed?.servers) ? parsed.servers : {};
    } catch { return {}; }
  }
  // For changing the file: only a missing file starts empty. One that is not JSON is copied aside first (nothing is
  // lost), and one that can't be read right now (another program holds it) refuses the change instead of wiping it.
  async function secretsForWrite() {
    if (!secretFile) return {};
    let text;
    try { text = await fs.readFile(secretFile, "utf8"); } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw refuse("Studio could not read its saved connector values just now, so nothing was changed. Try again in a moment.");
    }
    try {
      const parsed = JSON.parse(text);
      if (record(parsed) && (parsed.servers === undefined || record(parsed.servers))) return record(parsed.servers) ? parsed.servers : {};
    } catch { /* copied aside below */ }
    try { await fs.writeFile(`${secretFile}.broken-${new Date(now()).toISOString().replace(/[:.]/g, "-")}`, text, { mode: 0o600, flag: "wx" }); }
    catch { throw refuse("Studio's saved connector values are damaged and could not be copied aside, so nothing was changed."); }
    return {};
  }
  const writeSecrets = (servers) => replaceFile(secretFile, `${JSON.stringify({ v: 1, servers }, null, 2)}\n`);
  const secretLock = (work) => serial(work);
  async function saveValues(id, values, { replace = false } = {}) {
    const entries = Object.entries(record(values) ? values : {}).filter(([key, value]) => mcpLib.envName(key) && typeof value === "string" && value.length && value.length <= 8000);
    if (!entries.length && !replace) return;
    if (entries.length && (!secretFile || !canEncrypt())) throw refuse("This PC can't keep that value safely in Studio. Set it as a Windows environment variable instead, and Studio passes it on.");
    if (!secretFile) return;
    const all = await secretsForWrite();
    const mine = replace ? {} : { ...(record(all[id]) ? all[id] : {}) };
    for (const [key, value] of entries) mine[key] = encrypt(value);
    if (Object.keys(mine).length) all[id] = mine; else delete all[id];
    await writeSecrets(all);
  }
  /** The values saved for a server, decrypted, for the keys it uses; plus Studio's own where one stands in. */
  async function envFor(server) {
    const out = {};
    if (!server?.id) return out;
    const keys = new Set([...(server.envKeys || []), ...Object.values(server.headerKeys || {})]);
    const saved = (await readSecrets())[server.id];
    if (record(saved) && typeof decrypt === "function") {
      for (const [key, value] of Object.entries(saved)) {
        if (!keys.has(key)) continue;
        try { const plain = decrypt(value); if (typeof plain === "string" && plain) out[key] = plain; } catch { /* a value this PC can't read is missing */ }
      }
    }
    // An online connector gets only what was saved for it: whatever it is given leaves this PC.
    if (server.transport === "http") return out;
    for (const key of keys) {
      if (out[key] || env[key] !== undefined) continue;
      const stand = await Promise.resolve(fallbackEnv(key)).catch(() => null);
      if (typeof stand === "string" && stand) out[key] = stand;
    }
    return out;
  }

  // ---- what the page shows ----
  function view(row, savedKeys, standIns) {
    const needs = [...new Set([...(row.envKeys || []), ...Object.values(row.headerKeys || {})])];
    const online = row.transport === "http";
    const missing = needs.filter((key) => !savedKeys.includes(key) && (online || (env[key] === undefined && !standIns.includes(key))));
    if (online) standIns = [];
    return {
      id: row.id, title: typeof row.title === "string" && row.title.trim() ? row.title.trim().slice(0, 80) : row.id,
      transport: row.transport, line: row.transport === "http" ? row.url : displayLine(row.command, row.args),
      ...(row.transport === "http" ? { url: row.url, host: (() => { try { return new URL(row.url).host; } catch { return ""; } })(), headerKeys: { ...row.headerKeys } } : { command: row.command, args: [...row.args] }),
      envKeys: [...row.envKeys], saved: savedKeys.filter((key) => needs.includes(key)), standIns: standIns.filter((key) => needs.includes(key)), missing,
      status: row.status, fingerprint: row.fingerprint, enabled: row.enabled !== false, places: [...row.places],
      tools: row.tools.map((tool) => ({ name: tool.name, description: tool.description, off: row.off.includes(tool.name) })),
      tested: record(row.tested) ? { at: Number(row.tested.at) || 0, ok: row.tested.ok === true, ms: Number(row.tested.ms) || 0, error: String(row.tested.error ?? "").slice(0, 400), found: Number(row.tested.found) || 0, skipped: Number(row.tested.skipped) || 0 } : null,
      approvedAt: record(row.approval) ? Number(row.approval.at) || 0 : 0, handWritten: !record(row.approval) && row.pending !== true,
      source: typeof row.source === "string" ? row.source.slice(0, 120) : "", addedAt: Number(row.addedAt) || 0,
      ...(typeof row.description === "string" ? { description: row.description.slice(0, 300) } : {}),
    };
  }
  async function standInKeys(rows) {
    const keys = new Set();
    for (const row of rows) for (const key of row.transport === "http" ? [] : row.envKeys) {
      if (env[key] !== undefined) continue;
      const stand = await Promise.resolve(fallbackEnv(key)).catch(() => null);
      if (typeof stand === "string" && stand) keys.add(key);
    }
    return [...keys];
  }
  const list = safely(async () => {
    const config = await readRaw();
    const rows = await mcp.rows(file);
    const secrets = await readSecrets();
    const stand = await standInKeys(rows);
    const servers = rows.map((row) => view(row, Object.keys(record(secrets[row.id]) ? secrets[row.id] : {}), stand));
    const skippedRows = Object.keys(config.servers).length - rows.length;
    return {
      ok: true, file: shown(file), servers, secretsSafe: Boolean(secretFile) && canEncrypt(),
      featured: FEATURED.map((entry) => ({ ...entry, args: [...entry.args], envKeys: [...entry.envKeys], places: [...entry.places], line: displayLine(entry.command, entry.args), added: rows.some((row) => row.id === entry.id || (row.transport === "stdio" && row.command === entry.command && JSON.stringify(row.args) === JSON.stringify(entry.args))) })),
      limits: { toolsPerAgent: 16, places: [...PLACES], servers: MAX_SERVERS },
      ...(skippedRows > 0 ? { unreadable: skippedRows } : {}),
    };
  });

  // ---- adding ----
  function checkPlaces(value, fallback) {
    if (value === undefined) return [...fallback];
    if (!Array.isArray(value) || value.some((place) => !PLACES.includes(place))) throw refuse("Choose where it is used: the chat, agents or builders.");
    return [...new Set(value)];
  }
  function shapeOf(draft) {
    if (draft.transport === "http" || (typeof draft.url === "string" && draft.url.trim() && !draft.line && !draft.command)) {
      const url = mcpLib.httpAddress(String(draft.url ?? "").trim());
      if (!url) throw refuse("Use an https:// address (or http:// on this PC).");
      const headerKeys = {};
      for (const [header, key] of Object.entries(record(draft.headerKeys) ? draft.headerKeys : {})) {
        if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header) || !mcpLib.envName(key)) throw refuse("A header needs a name and the setting that holds its value.");
        headerKeys[header] = key;
      }
      return { transport: "http", url, headerKeys, envKeys: [] };
    }
    let command, args;
    if (typeof draft.line === "string") {
      const parsed = parseLine(draft.line);
      if (!parsed) throw refuse("Write the command the way you would type it, for example npx -y @playwright/mcp@latest.");
      ({ command, args } = parsed);
    } else { command = String(draft.command ?? "").trim(); args = Array.isArray(draft.args) ? draft.args.map(String) : []; }
    if (!command || command.length >= 1000) throw refuse("Give the command that starts the connector.");
    if (args.length > 64 || args.some((arg) => arg.length > 4000)) throw refuse("That command has too many or too long arguments.");
    const envKeys = [...new Set((Array.isArray(draft.envKeys) ? draft.envKeys : []).map((key) => String(key).trim()).filter(Boolean))];
    if (envKeys.some((key) => !mcpLib.envName(key)) || envKeys.length > 32) throw refuse("A setting's name is letters, numbers and underscores, like GITHUB_TOKEN.");
    return { transport: "stdio", command, args, envKeys };
  }
  async function addOne(config, draft, { unique = false } = {}) {
    let id = typeof draft.id === "string" && draft.id ? draft.id : idFrom(draft.name);
    if (!ID.test(id)) throw refuse("Give it a short name: lowercase letters, numbers and dashes, like github.");
    if (Object.keys(config.servers).length >= MAX_SERVERS) throw refuse(`Studio keeps up to ${MAX_SERVERS} connectors.`);
    if (!mcpLib.safeName(id)) throw refuse("Give it a short name: lowercase letters, numbers and dashes, like github.");
    if (Object.hasOwn(config.servers, id)) {
      if (!unique) throw refuse(`A connector named ${id} already exists.`);
      let number = 2;
      while (Object.hasOwn(config.servers, `${id.slice(0, 44)}-${number}`)) number += 1;
      id = `${id.slice(0, 44)}-${number}`;
    }
    const shape = shapeOf(draft);
    const values = record(draft.values) ? draft.values : {};
    for (const key of Object.keys(values)) if (shape.transport === "stdio" && !shape.envKeys.includes(key)) shape.envKeys.push(key);
    const row = {
      ...(typeof draft.title === "string" && draft.title.trim() ? { title: draft.title.trim().slice(0, 80) } : {}),
      ...(typeof draft.description === "string" && draft.description.trim() ? { description: draft.description.trim().slice(0, 300) } : {}),
      ...(shape.transport === "http" ? { transport: "http", url: shape.url, ...(Object.keys(shape.headerKeys).length ? { headerKeys: shape.headerKeys } : {}) } : { command: shape.command, args: shape.args, ...(shape.envKeys.length ? { envKeys: shape.envKeys } : {}) }),
      tools: [], places: checkPlaces(draft.places, ["builders"]), pending: true, addedAt: now(),
      ...(typeof draft.source === "string" && draft.source ? { source: draft.source.slice(0, 120) } : {}),
    };
    config.servers[id] = row;
    return { id, values };
  }
  const add = safely(async (draft = {}) => {
    const added = await mutate(async (config) => addOne(config, draft));
    if (Object.keys(added.values).length) await secretLock(() => saveValues(added.id, added.values));
    return { ok: true, server: await one(added.id) };
  });
  const addFeatured = safely(async ({ id } = {}) => {
    const entry = FEATURED.find((item) => item.id === id);
    if (!entry) throw refuse("That is not one of Studio's featured connectors.");
    const added = await mutate(async (config) => addOne(config, { id: entry.id, title: entry.title, description: entry.description, command: entry.command, args: [...entry.args], envKeys: [...entry.envKeys], places: [...entry.places], source: "Featured in Studio" }));
    return { ok: true, server: await one(added.id) };
  });
  async function one(id) {
    const rows = await mcp.rows(file);
    const row = rows.find((item) => item.id === id);
    if (!row) return null;
    const secrets = await readSecrets();
    return view(row, Object.keys(record(secrets[id]) ? secrets[id] : {}), await standInKeys([row]));
  }
  const known = (config, id) => {
    if (!mcpLib.safeName(String(id ?? ""))) throw refuse("Choose a connector.");
    // Only a server the file itself holds, never a name an object finds on its prototype.
    if (!Object.hasOwn(config.servers, id) || !record(config.servers[id])) throw refuse(`There is no connector named ${id}.`);
    return config.servers[id];
  };

  // ---- approving, testing, changing ----
  const approve = safely(async ({ id, fingerprint } = {}) => {
    await mutate(async (config) => {
      const raw = known(config, id);
      const row = (await mcp.rows(file)).find((item) => item.id === id);
      if (!row) throw refuse("That connector can't be read; check its command.");
      if (typeof fingerprint !== "string" || fingerprint !== row.fingerprint) throw refuse("It changed since you looked at it. Read the command again, then approve.");
      raw.approval = { fingerprint: row.fingerprint, at: now() };
      delete raw.pending;
    });
    return { ok: true, server: await one(id) };
  });
  const test = safely(async ({ id } = {}) => {
    const row = (await mcp.rows(file)).find((item) => item.id === id);
    if (!row) throw refuse(`There is no connector named ${id}.`);
    if (row.status === "needs-approval" || row.status === "changed") throw refuse("Approve it first: Studio never starts a connector you have not approved.");
    const started = now();
    let found = null, problem = null;
    try { found = await mcp.discover(row, { env: await envFor(row), timeoutMs: testTimeoutMs }); }
    catch (error) { problem = String(error?.message ?? error).slice(0, 400); }
    await mutate(async (config) => {
      const raw = config.servers[id];
      if (!record(raw)) return false;
      // Changed while it was being tested: what was found belongs to the old command.
      const fresh = (await mcp.rows(file)).find((item) => item.id === id);
      if (!fresh || fresh.fingerprint !== row.fingerprint) return false;
      if (found) {
        raw.tools = found.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
        if (Array.isArray(raw.off)) raw.off = raw.off.filter((name) => found.tools.some((tool) => tool.name === name));
        raw.tested = { at: started, ok: true, ms: found.ms, found: found.tools.length, skipped: found.skipped.length, ...(found.serverInfo?.name ? { server: `${found.serverInfo.name}${found.serverInfo.version ? ` ${found.serverInfo.version}` : ""}`.slice(0, 120) } : {}) };
      } else raw.tested = { at: started, ok: false, error: problem || "It did not start." };
    });
    return found
      ? { ok: true, ms: found.ms, tools: found.tools.map((tool) => ({ name: tool.name, description: tool.description })), skipped: found.skipped, server: await one(id) }
      : { ok: false, error: problem || "It did not start.", server: await one(id) };
  });
  const update = safely(async ({ id, enabled, places, off, title } = {}) => {
    await mutate(async (config) => {
      const raw = known(config, id);
      if (enabled !== undefined) { if (typeof enabled !== "boolean") throw refuse("On or off."); if (enabled) delete raw.enabled; else raw.enabled = false; }
      if (places !== undefined) raw.places = checkPlaces(places, []);
      if (off !== undefined) {
        if (!Array.isArray(off) || off.some((name) => !mcpLib.safeName(name))) throw refuse("Choose tools by name.");
        raw.off = [...new Set(off)];
        if (!raw.off.length) delete raw.off;
      }
      if (title !== undefined) { const text = String(title ?? "").trim().slice(0, 80); if (text) raw.title = text; else delete raw.title; }
    });
    return { ok: true, server: await one(id) };
  });
  const remove = safely(async ({ id } = {}) => {
    await serial(async () => {
      const config = await readRaw();
      known(config, id);
      await keepCopy("remove");
      delete config.servers[id];
      await replaceFile(file, `${JSON.stringify(config, null, 2)}\n`);
    });
    await secretLock(() => saveValues(id, {}, { replace: true }));
    return { ok: true, id };
  });
  // A value a connector needs (a token): kept encrypted; an empty value forgets it.
  const setSecret = safely(async ({ id, key, value } = {}) => {
    if (!mcpLib.envName(String(key ?? ""))) throw refuse("A setting's name is letters, numbers and underscores, like GITHUB_TOKEN.");
    const row = (await mcp.rows(file)).find((item) => item.id === id);
    if (!row) throw refuse(`There is no connector named ${id}.`);
    const needs = new Set([...row.envKeys, ...Object.values(row.headerKeys || {})]);
    if (!needs.has(key)) throw refuse(`${id} does not use ${key}. Add it to the connector's settings first.`);
    if (typeof value !== "string") throw refuse("Give a value.");
    if (value === "") {
      await secretLock(async () => {
        const all = await secretsForWrite();
        if (record(all[id])) { delete all[id][key]; if (!Object.keys(all[id]).length) delete all[id]; await writeSecrets(all); }
      });
    } else await secretLock(() => saveValues(id, { [key]: value }));
    return { ok: true, server: await one(id) };
  });

  // ---- importing from other apps ----
  async function readText(target) {
    try {
      const info = await fs.stat(target);
      if (!info.isFile() || info.size > SOURCE_BYTES) return null;
      return await fs.readFile(target, "utf8");
    } catch { return null; }
  }
  const sameFolder = (a, b) => {
    const norm = (value) => String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
  };
  function sources() {
    const root = projectRoot();
    const list = [
      { id: "claude-code", label: "Claude Code", file: path.join(home, ".claude.json"), read: (json) => {
        // The user's servers, then the open project's entry over them; a name an object keeps for itself is skipped.
        const out = {};
        const take = (servers) => { if (record(servers)) for (const [name, entry] of Object.entries(servers)) if (!UNSAFE_KEYS.has(name)) out[name] = entry; };
        take(json.mcpServers);
        if (root && record(json.projects)) for (const [folder, entry] of Object.entries(json.projects)) if (sameFolder(folder, root)) take(entry?.mcpServers);
        return out;
      } },
      { id: "claude-desktop", label: "Claude Desktop", file: path.join(appData, "Claude", "claude_desktop_config.json"), read: (json) => json.mcpServers },
      { id: "cursor", label: "Cursor", file: path.join(home, ".cursor", "mcp.json"), read: (json) => json.mcpServers },
      { id: "vscode", label: "VS Code", file: path.join(appData, "Code", "User", "mcp.json"), jsonc: true, read: (json) => json.servers },
      { id: "windsurf", label: "Windsurf", file: path.join(home, ".codeium", "windsurf", "mcp_config.json"), read: (json) => json.mcpServers },
      { id: "gemini", label: "Gemini CLI", file: path.join(home, ".gemini", "settings.json"), jsonc: true, read: (json) => json.mcpServers },
      { id: "opencode", label: "OpenCode", file: path.join(home, ".config", "opencode", "opencode.json"), jsonc: true, read: (json) => json.mcp },
      { id: "opencode-c", label: "OpenCode", file: path.join(home, ".config", "opencode", "opencode.jsonc"), jsonc: true, read: (json) => json.mcp },
      { id: "codex", label: "Codex", file: path.join(home, ".codex", "config.toml"), toml: true },
    ];
    if (root) {
      list.push(
        { id: "project-mcp", label: "This project's .mcp.json", file: path.join(root, ".mcp.json"), read: (json) => json.mcpServers, project: true },
        { id: "project-vscode", label: "This project's .vscode/mcp.json", file: path.join(root, ".vscode", "mcp.json"), jsonc: true, read: (json) => json.servers, project: true },
        { id: "project-cursor", label: "This project's .cursor/mcp.json", file: path.join(root, ".cursor", "mcp.json"), read: (json) => json.mcpServers, project: true },
      );
    }
    return list;
  }
  async function scan() {
    const found = [];
    for (const source of sources()) {
      const text = await readText(source.file);
      if (text === null) continue;
      let servers = null;
      try {
        servers = source.toml ? parseCodexToml(text) : source.read(JSON.parse(source.jsonc ? stripJsonc(text) : text.replace(/^﻿/, "")));
      } catch { continue; }
      if (!record(servers)) continue;
      for (const [name, entry] of Object.entries(servers).slice(0, 64)) {
        const one = fromOther(name, entry, `${source.label} (${shown(source.file)})`, { codex: source.id === "codex", deviceEnv: env });
        if (one) found.push({ ...one, key: crypto.createHash("sha256").update(`${source.id}:${name}`).digest("hex").slice(0, 16), sourceId: source.id });
      }
    }
    return found;
  }
  const candidates = safely(async () => {
    const rows = await mcp.rows(file);
    const prints = new Map(rows.map((row) => [row.fingerprint, row.id]));
    const seen = new Map(), out = [];
    for (const item of await scan()) {
      const print = mcpLib.fingerprint(item.transport === "http" ? { transport: "http", url: item.url, headerKeys: item.headerKeys } : { command: item.command, args: item.args, envKeys: item.envKeys });
      if (seen.has(print)) { seen.get(print).alsoIn.push(item.source); continue; }
      const entry = {
        key: item.key, name: item.name, id: idFrom(item.name), transport: item.transport,
        line: item.transport === "http" ? item.url : displayLine(item.command, item.args),
        envKeys: [...item.envKeys, ...Object.values(item.headerKeys || {})], hasValues: Object.keys(item.values).length > 0,
        source: item.source, alsoIn: [], supported: item.supported, why: item.why, added: prints.get(print) ?? null,
      };
      seen.set(print, entry); out.push(entry);
    }
    return { ok: true, candidates: out, secretsSafe: Boolean(secretFile) && canEncrypt() };
  });
  const importFrom = safely(async ({ keys = [], values = false } = {}) => {
    if (!Array.isArray(keys) || !keys.length || keys.length > 32 || keys.some((key) => typeof key !== "string")) throw refuse("Pick the connectors to bring in.");
    const found = await scan();
    const picked = keys.map((key) => found.find((item) => item.key === key) ?? { missing: key });
    const added = [], skipped = [];
    await serial(async () => {
      const config = await readRaw();
      await keepCopy("import");
      for (const item of picked) {
        if (item.missing) { skipped.push({ key: item.missing, reason: "It is no longer in that app's settings." }); continue; }
        if (!item.supported) { skipped.push({ key: item.key, name: item.name, reason: item.why || "Studio can't use this kind of connector." }); continue; }
        try {
          const { id } = await addOne(config, { name: item.name, ...(item.transport === "http" ? { transport: "http", url: item.url, headerKeys: item.headerKeys } : { command: item.command, args: item.args, envKeys: item.envKeys }), source: item.source, places: ["builders"] }, { unique: true });
          added.push({ id, values: values === true ? item.values : {} });
        } catch (error) { skipped.push({ key: item.key, name: item.name, reason: error instanceof Refusal ? error.message : "It could not be added." }); }
      }
      if (added.length) await replaceFile(file, `${JSON.stringify(config, null, 2)}\n`);
    });
    const kept = [];
    for (const entry of added) {
      if (!Object.keys(entry.values).length) continue;
      try { await secretLock(() => saveValues(entry.id, entry.values)); kept.push(entry.id); }
      catch (error) { skipped.push({ key: entry.id, name: entry.id, reason: error instanceof Refusal ? `Added, but its saved values stayed behind: ${error.message}` : "Added, but its saved values stayed behind." }); }
    }
    return { ok: true, added: added.map((entry) => entry.id), valuesKept: kept, skipped };
  });

  return { list, add, addFeatured, approve, test, update, remove, setSecret, candidates, importFrom, envFor, file };
}

module.exports = { createConnectors, FEATURED, PLACES, parseLine, displayLine, idFrom, stripJsonc, parseCodexToml, fromOther, KEEP_BACKUPS };
