// Mefi's Studio AI+ — the resource manager's rules: which apps on this PC
// Studio may slow down, pause or close so its agents get the machine while
// they build, and when (Team › Resources, docs/resource-manager.md).
//
// The helper (scripts/resource-helper.cs) reads every process and acts on one;
// the host (scripts/resource-host.cjs) runs it, keeps the holds and the
// journal. Everything that decides lives here:
//
// - readSnapshot: the helper's process table in plain fields;
// - cpuUse: each process's share of the machine between two snapshots;
// - studioTree / protection: what is never touched — Studio itself and its
//   agents, what Studio was started from, Windows and its services, another
//   user's processes, console windows and security software;
// - groupApps: processes as the apps a person knows (Chrome's thirty processes
//   are one Chrome), with their CPU, memory, window and what Studio holds;
// - plan: what auto mode does while agents build — slow heavy background apps,
//   pause or close only the apps you said may be paused or closed, give memory
//   back when building is short of it — and when it puts everything back;
// - the words the page and the toasts say.
//
// Manual mode does only what you press. Auto mode never pauses or closes an
// app unless that app's rule says so, never touches the app in front of you or
// one you used in the last two minutes, and puts back what it did once
// building stops. Pausing is undone the moment you switch to a paused app.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const MODES = Object.freeze(["manual", "auto"]);
// What auto mode may do with one app while agents build, mildest first.
const RULES = Object.freeze(["auto", "leave", "slow", "pause", "close"]);
// What a person can ask for one app from the page.
const OPS = Object.freeze(["slow", "pause", "trim", "close", "end", "restore"]);
// The helper's own refusal codes, in words.
const ERRORS = Object.freeze({
  denied: "Windows won't let Studio change it. It probably runs as administrator.",
  gone: "It closed before Studio got to it.",
  critical: "Windows needs it to keep running, so Studio leaves it alone.",
  system: "It is part of Windows, so Studio leaves it alone.",
  studio: "It is part of Studio.",
  partial: "Studio could only put part of it back.",
  failed: "Windows refused.",
  unknown: "Studio did not understand that.",
});

const PREF_DEFAULTS = Object.freeze({
  mode: "manual",
  // appKey -> one of RULES; a missing key uses the app's default.
  rules: Object.freeze({}),
  // Free memory auto mode keeps for building; below it building is short.
  keepFreeMB: 2048,
  // An app using this much of the whole machine's CPU, or this much memory, is heavy.
  heavyCpuPct: 10,
  heavyMemMB: 500,
  // While building is short of memory, give background apps' memory back to Windows.
  trimWhenShort: true,
  // How long after the last agent finishes everything auto did is put back.
  restoreAfterSec: 60,
  // A toast when auto mode acts.
  notify: true,
});
const PREF_LIMITS = Object.freeze({
  keepFreeMB: [256, 65536],
  heavyCpuPct: [1, 100],
  heavyMemMB: [50, 65536],
  restoreAfterSec: [0, 3600],
});
const MAX_RULES = 300;
const KEY_PATTERN = /^[a-z0-9][a-z0-9 ._+()&'-]{0,63}$/;

// An app the person just used is not touched for this long.
const FOREGROUND_GRACE_MS = 2 * 60 * 1000;
// Memory is given back to Windows at most this often per app.
const TRIM_EVERY_MS = 3 * 60 * 1000;
const MIB = 1024 * 1024;

// ---- apps Studio knows by name ---------------------------------------------------
// Kinds whose apps auto mode leaves alone unless their rule says otherwise:
// pausing or slowing them drops a call, stutters music or a recording, cuts a
// remote session, or touches what keeps the PC safe.
const KIND_LEAVE = new Set(["remote", "call", "media", "recording", "security", "terminal"]);
const KIND_WORDS = Object.freeze({
  browser: "Browser", chat: "Chat", call: "Calls", media: "Music and video", recording: "Recording",
  remote: "Remote access", game: "Game", launcher: "Game launcher", sync: "Cloud sync", editor: "Code editor",
  terminal: "Terminal", ai: "AI app", office: "Office", creative: "Creative", dev: "Developer tool", security: "Security",
});
const KNOWN = Object.freeze({
  msedge: ["Microsoft Edge", "browser"], chrome: ["Google Chrome", "browser"], firefox: ["Firefox", "browser"],
  brave: ["Brave", "browser"], opera: ["Opera", "browser"], vivaldi: ["Vivaldi", "browser"], arc: ["Arc", "browser"],
  zen: ["Zen Browser", "browser"], librewolf: ["LibreWolf", "browser"], waterfox: ["Waterfox", "browser"], chromium: ["Chromium", "browser"],
  discord: ["Discord", "call"], slack: ["Slack", "call"], "ms-teams": ["Microsoft Teams", "call"], teams: ["Microsoft Teams", "call"],
  zoom: ["Zoom", "call"], skype: ["Skype", "call"], webex: ["Webex", "call"], telegram: ["Telegram", "chat"],
  whatsapp: ["WhatsApp", "chat"], signal: ["Signal", "chat"], messenger: ["Messenger", "chat"],
  spotify: ["Spotify", "media"], vlc: ["VLC", "media"], foobar2000: ["foobar2000", "media"], musicbee: ["MusicBee", "media"],
  aimp: ["AIMP", "media"], itunes: ["iTunes", "media"], applemusic: ["Apple Music", "media"], tidal: ["TIDAL", "media"],
  potplayermini64: ["PotPlayer", "media"], "mpc-hc64": ["MPC-HC", "media"], mpv: ["mpv", "media"], plex: ["Plex", "media"],
  obs64: ["OBS Studio", "recording"], obs32: ["OBS Studio", "recording"], "streamlabs obs": ["Streamlabs", "recording"], xsplit: ["XSplit", "recording"],
  parsecd: ["Parsec", "remote"], teamviewer: ["TeamViewer", "remote"], anydesk: ["AnyDesk", "remote"], rustdesk: ["RustDesk", "remote"],
  zerotier_desktop_ui: ["ZeroTier", "remote"], "tailscale-ipn": ["Tailscale", "remote"], sunshine: ["Sunshine", "remote"], moonlight: ["Moonlight", "remote"],
  steam: ["Steam", "launcher"], epicgameslauncher: ["Epic Games Launcher", "launcher"], "battle.net": ["Battle.net", "launcher"],
  eadesktop: ["EA app", "launcher"], upc: ["Ubisoft Connect", "launcher"], galaxyclient: ["GOG Galaxy", "launcher"], riotclientservices: ["Riot Client", "launcher"],
  onedrive: ["OneDrive", "sync"], dropbox: ["Dropbox", "sync"], googledrivefs: ["Google Drive", "sync"], icloud: ["iCloud", "sync"],
  code: ["Visual Studio Code", "editor"], cursor: ["Cursor", "editor"], windsurf: ["Windsurf", "editor"], devenv: ["Visual Studio", "editor"],
  idea64: ["IntelliJ IDEA", "editor"], pycharm64: ["PyCharm", "editor"], webstorm64: ["WebStorm", "editor"], rider64: ["Rider", "editor"],
  "notepad++": ["Notepad++", "editor"], sublime_text: ["Sublime Text", "editor"], zed: ["Zed", "editor"],
  windowsterminal: ["Windows Terminal", "terminal"], wt: ["Windows Terminal", "terminal"], alacritty: ["Alacritty", "terminal"],
  wezterm: ["WezTerm", "terminal"], "wezterm-gui": ["WezTerm", "terminal"], tabby: ["Tabby", "terminal"], hyper: ["Hyper", "terminal"],
  claude: ["Claude", "ai"], chatgpt: ["ChatGPT", "ai"], codex: ["Codex", "ai"], "github desktop": ["GitHub Desktop", "dev"],
  githubdesktop: ["GitHub Desktop", "dev"], docker: ["Docker", "dev"], "docker desktop": ["Docker Desktop", "dev"], postman: ["Postman", "dev"],
  node: ["Node.js", "dev"], python: ["Python", "dev"], pythonw: ["Python", "dev"], java: ["Java", "dev"], javaw: ["Java", "dev"],
  winword: ["Word", "office"], excel: ["Excel", "office"], powerpnt: ["PowerPoint", "office"], outlook: ["Outlook", "office"],
  olk: ["Outlook", "office"], onenote: ["OneNote", "office"], notion: ["Notion", "office"], obsidian: ["Obsidian", "office"],
  figma: ["Figma", "creative"], photoshop: ["Photoshop", "creative"], blender: ["Blender", "creative"], unity: ["Unity", "creative"],
  unrealeditor: ["Unreal Editor", "creative"], "adobe premiere pro": ["Premiere Pro", "creative"], resolve: ["DaVinci Resolve", "creative"],
  msmpeng: ["Microsoft Defender", "security"], securityhealthsystray: ["Windows Security", "security"],
});
// Processes that belong to the app that started them, whatever their own name:
// a launcher's web views, a browser engine's helpers, crash reporters.
const HELPERS = new Set(["msedgewebview2", "steamwebhelper", "crashpad_handler", "cefsharp.browsersubprocess", "qtwebengineprocess", "epicwebhelper", "ubisoftconnectwebcore"]);
// Never touched by name: a console window Studio may be writing to (pausing
// it would freeze Studio's own output), and what keeps the PC safe.
const PROTECTED = Object.freeze({
  "openconsole.exe": "It is a console window Studio may be writing to.",
  "conhost.exe": "It is a console window Studio may be writing to.",
  "msmpeng.exe": "It keeps this PC safe.",
  "mpdefendercoreservice.exe": "It keeps this PC safe.",
  "nissrv.exe": "It keeps this PC safe.",
  "securityhealthsystray.exe": "It keeps this PC safe.",
  "securityhealthservice.exe": "It keeps this PC safe.",
});

// ---- small helpers -------------------------------------------------------------------
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round1 = (value) => Math.round(value * 10) / 10;
const mb = (bytes) => (finite(bytes) && bytes > 0 ? bytes / MIB : 0);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

// A creation time is a decimal string (a Windows FILETIME is past 2^53); this
// orders two of them without losing digits.
function compareCreate(a, b) {
  const left = String(a ?? "0").replace(/^0+(?=\d)/, "");
  const right = String(b ?? "0").replace(/^0+(?=\d)/, "");
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The name an app is kept under: its program's file name, lower case, without ".exe". */
function appKeyOf(name) {
  const text = String(name ?? "").trim().toLowerCase().replace(/\.exe$/, "");
  return KEY_PATTERN.test(text) ? text : "";
}

function gb(megabytes) {
  const value = Math.max(0, Number(megabytes) || 0);
  if (value < 1024) return `${Math.round(value)} MB`;
  return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} GB`;
}

// ---- preferences -----------------------------------------------------------------------
/** settings.resources as the host uses it: every field present, each in range. */
function normalizePrefs(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const prefs = { ...PREF_DEFAULTS, rules: {} };
  if (MODES.includes(input.mode)) prefs.mode = input.mode;
  for (const [key, [low, high]] of Object.entries(PREF_LIMITS)) {
    const value = Number(input[key]);
    if (input[key] !== undefined && input[key] !== null && Number.isFinite(value)) prefs[key] = Math.round(clamp(value, low, high));
  }
  for (const key of ["trimWhenShort", "notify"]) if (typeof input[key] === "boolean") prefs[key] = input[key];
  const rules = input.rules && typeof input.rules === "object" && !Array.isArray(input.rules) ? input.rules : {};
  for (const [key, rule] of Object.entries(rules).slice(0, MAX_RULES)) {
    const app = appKeyOf(key);
    if (app && RULES.includes(rule) && rule !== "auto") prefs.rules[app] = rule;
  }
  return prefs;
}

/**
 * A change from the page, checked field by field: { mode }, a threshold, a
 * switch, or { rule: { app, value } } ("auto" forgets the app's rule).
 * Returns { ok, prefs } or { ok: false, error } with nothing changed.
 */
function applyPrefsPatch(current, patch) {
  const prefs = normalizePrefs(current);
  const input = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const next = { ...prefs, rules: { ...prefs.rules } };
  if (input.mode !== undefined) {
    if (!MODES.includes(input.mode)) return { ok: false, error: "The mode is manual or auto." };
    next.mode = input.mode;
  }
  for (const [key, [low, high]] of Object.entries(PREF_LIMITS)) {
    if (input[key] === undefined) continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < low || value > high) return { ok: false, error: `${key} must be between ${low} and ${high}.` };
    next[key] = Math.round(value);
  }
  for (const key of ["trimWhenShort", "notify"]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") return { ok: false, error: `${key} is on or off.` };
    next[key] = input[key];
  }
  if (input.rule !== undefined) {
    const app = appKeyOf(input.rule?.app);
    const value = input.rule?.value;
    if (!app) return { ok: false, error: "That app's name is not one Studio keeps rules for." };
    if (!RULES.includes(value)) return { ok: false, error: `A rule is one of: ${RULES.join(", ")}.` };
    if (value === "auto") delete next.rules[app];
    else {
      if (!(app in next.rules) && Object.keys(next.rules).length >= MAX_RULES) return { ok: false, error: `Studio keeps at most ${MAX_RULES} app rules.` };
      next.rules[app] = value;
    }
  }
  return { ok: true, prefs: next };
}

// ---- the helper's snapshot ---------------------------------------------------------------
/**
 * The helper's `snap` reply as plain fields, or null when it is not one.
 * Each process: { id: "pid:create", pid, ppid, name, create, cpu (100 ns
 * units), workingSetMB, privateMB, privateWorkingSetMB, session,
 * basePriority, threads, frozen, path, description, title }.
 */
function readSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.procs)) return null;
  const files = Array.isArray(raw.files) ? raw.files : [];
  const memory = Array.isArray(raw.mem) ? raw.mem : [];
  const sys = Array.isArray(raw.sys) ? raw.sys : [];
  const processes = [];
  for (const row of raw.procs) {
    if (!Array.isArray(row) || row.length < 14) continue;
    const [pid, ppid, name, create, cpu, workingSet, privateBytes, privateWorkingSet, session, basePriority, threads, frozen, file, title] = row;
    if (!Number.isInteger(pid) || pid < 0 || typeof create !== "string" || !/^\d{1,20}$/.test(create)) continue;
    const entry = Number.isInteger(file) && file >= 0 && Array.isArray(files[file]) ? files[file] : null;
    processes.push({
      id: `${pid}:${create}`,
      pid,
      ppid: Number.isInteger(ppid) ? ppid : 0,
      name: typeof name === "string" ? name : "",
      create,
      cpu: finite(cpu) && cpu >= 0 ? cpu : 0,
      workingSetMB: mb(workingSet),
      privateMB: mb(privateBytes),
      privateWorkingSetMB: mb(privateWorkingSet),
      session: Number.isInteger(session) ? session : -1,
      basePriority: Number.isInteger(basePriority) ? basePriority : 8,
      threads: Number.isInteger(threads) ? threads : 0,
      frozen: frozen === 1 || frozen === true,
      path: entry && typeof entry[0] === "string" ? entry[0] : null,
      description: entry && typeof entry[1] === "string" ? entry[1] : "",
      title: typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : null,
    });
  }
  const ledger = Array.isArray(raw.ledger) ? raw.ledger.filter((row) => row && Number.isInteger(row.pid) && typeof row.create === "string") : [];
  return {
    at: finite(raw.at) ? raw.at : 0,
    cpus: Number.isInteger(raw.cpus) && raw.cpus > 0 ? raw.cpus : 1,
    sys: { idle: finite(sys[0]) ? sys[0] : null, kernel: finite(sys[1]) ? sys[1] : null, user: finite(sys[2]) ? sys[2] : null },
    memory: {
      totalMB: mb(memory[0]),
      freeMB: mb(memory[1]),
      commitLimitMB: mb(memory[2]),
      commitFreeMB: mb(memory[3]),
      loadPct: finite(memory[4]) ? memory[4] : null,
    },
    foreground: Number.isInteger(raw.fg) ? raw.fg : 0,
    idleMs: finite(raw.idle) && raw.idle >= 0 ? raw.idle : null,
    self: Number.isInteger(raw.self) ? raw.self : 0,
    session: Number.isInteger(raw.session) ? raw.session : -1,
    processes,
    ledger: ledger.map((row) => ({
      pid: row.pid,
      create: row.create,
      id: `${row.pid}:${row.create}`,
      name: typeof row.name === "string" ? row.name : "",
      slowed: row.slowed === true,
      paused: row.paused === true,
      oldPriority: Number.isInteger(row.oldPriority) ? row.oldPriority : 0,
      oldMemoryPriority: Number.isInteger(row.oldMemoryPriority) ? row.oldMemoryPriority : 0,
    })),
  };
}

/**
 * Each process's share of the whole machine (0-100) and the machine's own
 * CPU use between two snapshots. A process that is new since `previous` has
 * no share yet.
 */
function cpuUse(previous, next) {
  const byProcess = new Map();
  let system = null;
  if (!previous || !next) return { system, byProcess };
  const wall = (next.at - previous.at) * 10000;
  if (wall > 0) {
    const before = new Map(previous.processes.map((row) => [row.id, row.cpu]));
    const capacity = wall * Math.max(1, next.cpus);
    for (const row of next.processes) {
      const old = before.get(row.id);
      if (old === undefined || row.pid === 0) continue;
      byProcess.set(row.id, round1(clamp(((row.cpu - old) / capacity) * 100, 0, 100)));
    }
  }
  const a = previous.sys, b = next.sys;
  if ([a.idle, a.kernel, a.user, b.idle, b.kernel, b.user].every(finite)) {
    // The kernel's time includes the idle time.
    const total = (b.kernel - a.kernel) + (b.user - a.user);
    const idle = b.idle - a.idle;
    if (total > 0 && idle >= 0 && idle <= total) system = round1((1 - idle / total) * 100);
  }
  return { system, byProcess };
}

// ---- what is never touched -----------------------------------------------------------------
// A parent is only a parent when it started before its child: Windows reuses
// a dead parent's pid, and the newcomer is no relation.
function parentOf(row, byPid) {
  const parent = byPid.get(row.ppid);
  return parent && parent.pid !== row.pid && compareCreate(parent.create, row.create) <= 0 ? parent : null;
}

/**
 * Studio's own processes (everything started from its roots: the window, the
 * engine, the agents and their tools, the helper) and what Studio was started
 * from (the terminal or launcher above it), as two sets of process ids.
 */
function studioTree(processes, roots) {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const children = new Map();
  for (const row of processes) {
    const parent = parentOf(row, byPid);
    if (!parent) continue;
    if (!children.has(parent.pid)) children.set(parent.pid, []);
    children.get(parent.pid).push(row);
  }
  const own = new Set();
  const above = new Set();
  const stack = [];
  for (const pid of roots ?? []) {
    const root = byPid.get(Number(pid));
    if (!root) continue;
    stack.push(root);
    let cursor = root;
    for (let depth = 0; depth < 64; depth++) {
      const parent = parentOf(cursor, byPid);
      if (!parent || parent.pid <= 4) break;
      above.add(parent.id);
      cursor = parent;
    }
  }
  while (stack.length) {
    const row = stack.pop();
    if (own.has(row.id)) continue;
    own.add(row.id);
    for (const child of children.get(row.pid) ?? []) stack.push(child);
  }
  for (const id of own) above.delete(id);
  return { own, above };
}

function underWindows(file, windowsDir) {
  if (!file || !windowsDir) return false;
  const dir = String(windowsDir).replace(/[\\/]+$/, "").toLowerCase();
  const path = String(file).replace(/\//g, "\\").toLowerCase();
  return dir.length > 2 && path.startsWith(`${dir.replace(/\//g, "\\")}\\`);
}

/**
 * Why one process is never touched, or null when it may be.
 * codes: studio, above (Studio was started from it), windows, service,
 * session (another user's), console/safety (by name), helper, hidden (Windows
 * would not tell Studio which program it is).
 */
function protection(row, { tree, windowsDir = "", session = -1, self = 0 } = {}) {
  if (!row || row.pid <= 4) return { code: "windows", why: "It is part of Windows." };
  if (row.pid === self) return { code: "studio", why: "It is Studio's resource helper." };
  if (tree?.own?.has(row.id)) return { code: "studio", why: "It is part of Studio or one of its agents." };
  if (row.session === 0) return { code: "service", why: "It is a Windows service." };
  if (session >= 0 && row.session >= 0 && row.session !== session) return { code: "session", why: "It belongs to another person signed in to this PC." };
  if (underWindows(row.path, windowsDir)) return { code: "windows", why: "It is part of Windows." };
  if (tree?.above?.has(row.id)) return { code: "above", why: "Studio was started from it, so pausing it could freeze Studio." };
  const name = String(row.name ?? "").toLowerCase();
  if (PROTECTED[name]) return { code: name.includes("console") || name === "conhost.exe" ? "console" : "safety", why: PROTECTED[name] };
  if (!row.path) return { code: "hidden", why: "Windows won't tell Studio which program it is, so Studio leaves it alone." };
  return null;
}

// ---- processes as apps -------------------------------------------------------------------
// The process that names an app: a child with its parent's name (a browser's
// tabs) or a helper (a launcher's web view) belongs to the parent's app.
function appRoot(row, byPid, skip) {
  let cursor = row;
  for (let depth = 0; depth < 32; depth++) {
    const parent = parentOf(cursor, byPid);
    if (!parent || skip(parent)) break;
    const same = appKeyOf(parent.name) && appKeyOf(parent.name) === appKeyOf(cursor.name);
    if (!same && !HELPERS.has(appKeyOf(cursor.name))) break;
    cursor = parent;
  }
  return cursor;
}

function knownApp(key) {
  const known = KNOWN[key];
  return known ? { name: known[0], kind: known[1] } : null;
}

function defaultRule(kind) {
  return KIND_LEAVE.has(kind) ? "leave" : "auto";
}

// How much of an app's processes is in one state: "all", "some" or "none".
const share = (count, total) => (!total || !count ? "none" : count >= total ? "all" : "some");

/**
 * Every process of a snapshot sorted into Studio, Windows and the apps a
 * person knows, each app with its CPU share, memory (private working set),
 * window title, whether it is in front, what Studio holds on it and the rule
 * auto mode follows. `holds` is the host's Map appKey -> { slow, pause }, each
 * null or { by: "auto" | "you", at }.
 */
function groupApps({ snapshot, cpu = null, studioPids = [], windowsDir = "", prefs = PREF_DEFAULTS, holds = new Map() } = {}) {
  const empty = { apps: [], studio: { count: 0, cpu: 0, memMB: 0 }, windows: { count: 0, cpu: 0, memMB: 0 }, kept: { count: 0, cpu: 0, memMB: 0 } };
  if (!snapshot) return empty;
  const rules = normalizePrefs(prefs).rules;
  const tree = studioTree(snapshot.processes, studioPids);
  const byPid = new Map(snapshot.processes.map((row) => [row.pid, row]));
  const ledger = new Map(snapshot.ledger.map((row) => [row.id, row]));
  const shareOf = (row) => cpu?.byProcess?.get(row.id) ?? 0;
  const context = { tree, windowsDir, session: snapshot.session, self: snapshot.self };
  const verdicts = new Map(snapshot.processes.map((row) => [row.id, protection(row, context)]));
  const skip = (row) => {
    const verdict = verdicts.get(row.id);
    return verdict && ["windows", "service", "studio", "session"].includes(verdict.code);
  };
  const apps = new Map();
  const out = { ...empty, studio: { ...empty.studio }, windows: { ...empty.windows }, kept: { ...empty.kept } };
  const tally = (bucket, row) => { bucket.count += 1; bucket.cpu += shareOf(row); bucket.memMB += row.privateWorkingSetMB; };
  for (const row of snapshot.processes) {
    if (row.pid === 0) continue;
    const verdict = verdicts.get(row.id);
    if (verdict?.code === "studio") { tally(out.studio, row); continue; }
    if (verdict && ["windows", "service", "session"].includes(verdict.code)) { tally(out.windows, row); continue; }
    const root = appRoot(row, byPid, skip);
    const key = appKeyOf(root.name);
    if (!key) { tally(out.kept, row); continue; }
    if (!apps.has(key)) {
      const known = knownApp(key);
      const kind = known?.kind ?? null;
      apps.set(key, {
        key,
        name: known?.name || (root.description && root.description.length <= 60 ? root.description : root.name.replace(/\.exe$/i, "")),
        kind,
        kindLabel: kind ? KIND_WORDS[kind] : null,
        exe: root.name,
        count: 0,
        cpu: 0,
        memMB: 0,
        title: null,
        foreground: false,
        targets: [],
        kept: [],
        frozen: 0,
        paused: 0,
        slowed: 0,
      });
    }
    const app = apps.get(key);
    app.count += 1;
    app.cpu += shareOf(row);
    app.memMB += row.privateWorkingSetMB;
    if (row.pid === snapshot.foreground) app.foreground = true;
    if (row.title && (!app.title || row.pid === root.pid)) app.title = row.title;
    if (row.frozen) app.frozen += 1;
    if (verdict) { app.kept.push(verdict); continue; }
    app.targets.push(row.id);
    const held = ledger.get(row.id);
    if (held?.paused) app.paused += 1;
    if (held?.slowed) app.slowed += 1;
  }
  for (const app of apps.values()) {
    const total = app.targets.length;
    const rule = rules[app.key] ?? defaultRule(app.kind);
    const hold = holds.get(app.key) ?? null;
    out.apps.push({
      key: app.key,
      name: app.name,
      kind: app.kind,
      kindLabel: app.kindLabel,
      exe: app.exe,
      count: app.count,
      cpu: round1(app.cpu),
      memMB: Math.round(app.memMB),
      title: app.title,
      foreground: app.foreground,
      targets: app.targets,
      // Kept: processes of this app Studio never touches (and why, once).
      kept: app.kept.length,
      protected: total ? null : app.kept[0] ?? { code: "hidden", why: "Studio cannot reach it." },
      keptWhy: app.kept[0]?.why ?? null,
      paused: share(app.paused, total),
      slowed: share(app.slowed, total),
      frozen: app.frozen > 0 && app.frozen >= app.count && !app.paused,
      hold: { slow: hold?.slow ?? null, pause: hold?.pause ?? null },
      rule,
      ruleSet: app.key in rules,
    });
  }
  out.apps.sort((a, b) => b.memMB - a.memMB || b.cpu - a.cpu || a.name.localeCompare(b.name));
  for (const bucket of [out.studio, out.windows, out.kept]) { bucket.cpu = round1(bucket.cpu); bucket.memMB = Math.round(bucket.memMB); }
  return out;
}

// ---- auto mode -----------------------------------------------------------------------------
/**
 * What auto mode does now. Input:
 *   apps      groupApps' apps
 *   prefs     normalized preferences
 *   building  { active, since, endedAt, waitingForMemory }
 *   memory    { freeMB }
 *   marks     Map appKey -> { usedAt, trimmedAt, closedAt, releasedAt } (the host's)
 *   snoozed   true while auto holds off (after Restore all, until building ends)
 *   now
 * Returns { level, apply: [{ key, op, by, reason, whole? }], release: [{ key, what, reason }],
 * suggest: [{ key, freesMB }], short: { freeMB, wantMB } | null }.
 * Holds made by you are never released here, except a pause on the app you
 * switch to: a paused window cannot answer you. A step marked `whole` only
 * carries a hold to the app's processes that started after it.
 */
function plan({ apps = [], prefs = PREF_DEFAULTS, building = {}, memory = {}, marks = new Map(), snoozed = false, now = 0 } = {}) {
  const settings = normalizePrefs(prefs);
  const result = { level: settings.mode === "auto" ? "watching" : "manual", apply: [], release: [], suggest: [], short: null };
  const markOf = (key) => marks.get(key) ?? {};
  const inUse = (app) => app.foreground || now - (markOf(app.key).usedAt ?? -Infinity) < FOREGROUND_GRACE_MS;
  // In every mode: a paused app you switch to runs again at once.
  for (const app of apps) {
    if (app.foreground && (app.hold.pause || app.paused !== "none")) result.release.push({ key: app.key, what: "pause", reason: "you switched to it" });
  }
  // A hold reaches the app's processes that started after it.
  for (const app of apps) {
    if (app.protected || result.release.some((entry) => entry.key === app.key)) continue;
    if (app.hold.pause && app.paused !== "all") result.apply.push({ key: app.key, op: "pause", by: app.hold.pause.by, reason: "a new process of a paused app", whole: true });
    if (app.hold.slow && app.slowed !== "all") result.apply.push({ key: app.key, op: "slow", by: app.hold.slow.by, reason: "a new process of a slowed app", whole: true });
  }
  if (settings.mode !== "auto") return result;
  const autoHeld = (app) => app.hold.slow?.by === "auto" || app.hold.pause?.by === "auto";
  const releaseAuto = (app, reason) => {
    if (result.release.some((entry) => entry.key === app.key && entry.what === "all")) return;
    result.release.push({ key: app.key, what: "auto", reason });
  };
  if (snoozed) {
    result.level = "snoozed";
    return result;
  }
  if (!building.active) {
    const done = Number.isFinite(building.endedAt) && now - building.endedAt >= settings.restoreAfterSec * 1000;
    for (const app of apps) if (autoHeld(app) && (done || !Number.isFinite(building.endedAt))) releaseAuto(app, "building finished");
    result.level = apps.some(autoHeld) && !done && Number.isFinite(building.endedAt) ? "winding-down" : "watching";
    return result;
  }
  result.level = "focus";
  const freeMB = Number(memory.freeMB);
  const short = (Number.isFinite(freeMB) && freeMB < settings.keepFreeMB) || building.waitingForMemory === true;
  if (short) result.short = { freeMB: Number.isFinite(freeMB) ? Math.round(freeMB) : null, wantMB: settings.keepFreeMB };
  const since = Number.isFinite(building.since) ? building.since : -Infinity;
  const queued = new Set(result.apply.map((entry) => `${entry.key}:${entry.op}`));
  const add = (app, op, reason) => {
    if (queued.has(`${app.key}:${op}`)) return;
    queued.add(`${app.key}:${op}`);
    result.apply.push({ key: app.key, op, by: "auto", reason });
  };
  for (const app of apps) {
    if (app.protected) continue;
    const mark = markOf(app.key);
    // Put back by you, or switched to, since this building began: not touched again until it ends.
    const released = Number.isFinite(mark.releasedAt) && mark.releasedAt >= since;
    const leave = app.rule === "leave" || inUse(app) || released;
    if (leave) {
      if (autoHeld(app)) releaseAuto(app, app.rule === "leave" ? "its rule says leave it alone" : "you are using it");
      continue;
    }
    const heavy = app.cpu >= settings.heavyCpuPct || app.memMB >= settings.heavyMemMB;
    if (app.rule === "close") {
      if (!(Number.isFinite(mark.closedAt) && mark.closedAt >= since)) add(app, "close", "its rule says close it while agents build");
      continue;
    }
    if (app.rule === "pause") {
      if (!app.hold.pause) add(app, "pause", "its rule says pause it while agents build");
      continue;
    }
    if ((app.rule === "slow" || heavy) && !app.hold.slow) add(app, "slow", app.rule === "slow" ? "its rule says slow it down while agents build" : "it is heavy and in the background");
    if (short && settings.trimWhenShort && app.memMB >= settings.heavyMemMB / 2 && now - (mark.trimmedAt ?? -Infinity) >= TRIM_EVERY_MS) {
      add(app, "trim", "building is short of memory");
    }
  }
  // What pausing would free when giving memory back is not enough: offered, never done.
  if (short) {
    let missing = settings.keepFreeMB - (Number.isFinite(freeMB) ? freeMB : 0);
    const candidates = apps
      .filter((app) => !app.protected && app.rule === "auto" && !inUse(app) && !app.hold.pause && app.memMB >= 200)
      .sort((a, b) => b.memMB - a.memMB);
    for (const app of candidates) {
      if (missing <= 0 || result.suggest.length >= 3) break;
      result.suggest.push({ key: app.key, freesMB: app.memMB });
      missing -= app.memMB;
    }
  }
  return result;
}

// ---- the journal ---------------------------------------------------------------------------
/**
 * What to hand a new helper from the journal a crashed one left: only what the
 * snapshot shows is still in effect (every thread still suspended; still at
 * idle priority), as the helper's `adopt` targets
 * "pid:create:flags:oldPriority:oldMemoryPriority".
 */
function adoptions(entries, snapshot) {
  if (!Array.isArray(entries) || !snapshot) return [];
  const live = new Map(snapshot.processes.map((row) => [row.id, row]));
  const out = [];
  for (const entry of entries) {
    if (!entry || !Number.isInteger(entry.pid) || typeof entry.create !== "string") continue;
    const row = live.get(`${entry.pid}:${entry.create}`);
    if (!row) continue;
    const paused = entry.paused === true && row.frozen;
    const slowed = entry.slowed === true && row.basePriority <= 4;
    if (!paused && !slowed) continue;
    const priority = Number.isInteger(entry.oldPriority) && entry.oldPriority > 0 ? entry.oldPriority : 0x20;
    const memory = Number.isInteger(entry.oldMemoryPriority) && entry.oldMemoryPriority > 0 ? entry.oldMemoryPriority : 5;
    out.push(`${entry.pid}:${entry.create}:${paused ? "p" : ""}${slowed ? "s" : ""}:${priority}:${memory}`);
  }
  return out;
}

// ---- words ---------------------------------------------------------------------------------
const OP_DONE = Object.freeze({ slow: "Slowed down", pause: "Paused", trim: "Gave back memory from", close: "Asked to close", end: "Ended", restore: "Put back" });
const OP_BUTTON = Object.freeze({ slow: "Slow down", pause: "Pause", trim: "Free memory", close: "Close", end: "End", restore: "Put back" });

function errorWords(code, detail = "") {
  return ERRORS[code] ?? (detail ? String(detail).slice(0, 200) : ERRORS.failed);
}

/** One line for the activity list and the toast: "Paused Discord", "Slowed down Edge (2 of 30 refused)". */
function actionWords({ op, name, ok = 0, failed = 0, error = null }) {
  const done = OP_DONE[op] ?? op;
  if (!ok && failed) return `Could not ${String(OP_BUTTON[op] ?? op).toLowerCase()} ${name}: ${errorWords(error)}`;
  return `${done} ${name}${failed ? ` (${failed} of ${ok + failed} parts refused)` : ""}`;
}

/** The page's headline for where things stand. */
function headline({ supported = true, reason = "", mode = "manual", level = "manual", held = 0, paused = 0, short = null, building = {} } = {}) {
  if (!supported) return reason || "The resource manager works on Windows.";
  const holding = held ? ` Holding ${plural(held, "app")}${paused ? `, ${paused} paused` : ""}.` : "";
  if (mode !== "auto") return held ? `Manual.${holding} Put them back with Restore all.` : "Manual: Studio changes nothing until you press a button.";
  if (level === "snoozed") return "Auto is holding off until the agents finish building, because you restored everything.";
  if (level === "focus") {
    const shortWords = short ? ` Building is short of memory (${gb(short.freeMB)} free, ${gb(short.wantMB)} wanted).` : "";
    return `Agents are building, so Studio is making room.${holding}${shortWords}`;
  }
  if (level === "winding-down") return `Agents finished. Studio puts everything back shortly.${holding}`;
  return building.waiting ? "Auto is watching. Work is waiting for the machine." : "Auto is watching. When agents build, Studio slows heavy background apps.";
}

module.exports = {
  MODES,
  RULES,
  OPS,
  KIND_WORDS,
  PREF_DEFAULTS,
  FOREGROUND_GRACE_MS,
  TRIM_EVERY_MS,
  compareCreate,
  appKeyOf,
  gb,
  normalizePrefs,
  applyPrefsPatch,
  readSnapshot,
  cpuUse,
  studioTree,
  protection,
  knownApp,
  defaultRule,
  groupApps,
  plan,
  adoptions,
  errorWords,
  actionWords,
  headline,
};
