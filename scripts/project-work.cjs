// Work that already exists in an open folder, read from the conventions the
// engineering skills (mattpocock/skills: setup-matt-pocock-skills, wayfinder,
// to-tickets, triage) write into a repo, plus the agents, skills and commands
// the coding tools in that folder can reach.
//
//   docs/agents/issue-tracker.md        which tracker the repo uses
//   docs/agents/triage-labels.md        label vocabulary
//   docs/agents/domain.md, CONTEXT.md   domain docs
//   .scratch/<effort>/map.md            a wayfinder map (local tracker)
//   .scratch/<effort>/spec.md           the effort's spec
//   .scratch/<effort>/issues/NN-*.md    one ticket per file, Status:/Type:/Blocked by: lines
//   gh issue list                       GitHub tracker: maps carry the wayfinder:map label
//
// Tooling comes from the repo (.claude/, .opencode/, .agents/, opencode.json),
// the user's home (~/.claude, ~/.config/opencode) and installed Claude Code
// plugins (~/.claude/plugins). Everything is read-only and bounded; a folder
// without any of it yields empty lists, never an error.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const LIMITS = Object.freeze({ efforts: 40, ticketsPerEffort: 200, fileBytes: 16 * 1024, names: 400, remoteMs: 6000, cacheMs: 60_000 });

const isDir = (target) => { try { return fs.statSync(target).isDirectory(); } catch { return false; } };
const isFile = (target) => { try { return fs.statSync(target).isFile(); } catch { return false; } };
const head = async (file, bytes = LIMITS.fileBytes) => {
  let handle = null;
  try {
    handle = await fsp.open(file, "r");
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch { return ""; }
  finally { await handle?.close().catch(() => {}); }
};
const rel = (root, file) => path.relative(root, file).split(path.sep).join("/");
const listDir = async (dir) => { try { return await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; } };
const clip = (text, max) => { const flat = String(text ?? "").replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };

// ---- markdown helpers -------------------------------------------------------

function titleOf(text, fallback) {
  const match = String(text).match(/^\s*#\s+(.+?)\s*$/m);
  return match ? clip(match[1], 160) : fallback;
}
// The `## Heading` body up to the next heading of the same or higher level.
function sectionOf(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^#{1,3}\\s+${heading}\\s*$`, "i").test(line));
  if (start < 0) return "";
  const level = (lines[start].match(/^#+/) || ["##"])[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    const mark = line.match(/^(#+)\s/);
    if (mark && mark[1].length <= level) break;
    body.push(line);
  }
  return body.join("\n").trim();
}
const fieldOf = (text, name) => {
  const match = String(text).match(new RegExp(`^\\s*(?:\\*\\*)?${name}(?:\\*\\*)?\\s*:\\s*(?:\\*\\*)?(.+?)(?:\\*\\*)?\\s*$`, "im"));
  return match ? clip(match[1], 200) : null;
};
const bulletCount = (body) => body.split(/\r?\n/).filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)).length;
const frontmatter = (text) => {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (pair) out[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
};

// ---- issue tracker config ---------------------------------------------------

async function readTracker(root) {
  const docs = path.join(root, "docs", "agents");
  const trackerDoc = path.join(docs, "issue-tracker.md");
  const tracker = { kind: null, doc: null, labelsDoc: null, domainDoc: null, contextDoc: null, contextMap: null, summary: null };
  if (isFile(trackerDoc)) {
    const text = await head(trackerDoc);
    const title = titleOf(text, "");
    const flat = `${title}\n${text.slice(0, 600)}`.toLowerCase();
    tracker.kind = /gitlab/.test(flat) ? "gitlab" : /github/.test(flat) ? "github" : /linear/.test(flat) ? "linear" : /local|markdown|\.scratch/.test(flat) ? "local" : "other";
    tracker.doc = rel(root, trackerDoc);
    tracker.summary = clip(title.replace(/^issue tracker:\s*/i, "") || text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#")) || "", 120) || null;
  } else if (isDir(path.join(root, ".scratch"))) {
    // The local convention in use without the setup doc: still a tracker.
    tracker.kind = "local";
  }
  for (const [key, file] of [["labelsDoc", path.join(docs, "triage-labels.md")], ["domainDoc", path.join(docs, "domain.md")], ["contextDoc", path.join(root, "CONTEXT.md")], ["contextMap", path.join(root, "CONTEXT-MAP.md")]]) {
    if (isFile(file)) tracker[key] = rel(root, file);
  }
  return tracker;
}

// ---- local efforts: .scratch/<effort>/ --------------------------------------

const TICKET_NAME = /^(\d{1,4})-(.+)\.md$/i;
const STATUS_WORDS = { open: "open", claimed: "claimed", resolved: "resolved", done: "resolved", closed: "resolved", "in-progress": "claimed", "in progress": "claimed" };

async function readTicket(root, file, name) {
  const match = name.match(TICKET_NAME);
  const text = await head(file);
  const rawStatus = (fieldOf(text, "Status") || "").toLowerCase();
  const status = STATUS_WORDS[rawStatus] || (rawStatus.includes("resolv") || rawStatus.includes("done") || rawStatus.includes("closed") ? "resolved" : rawStatus.includes("claim") || rawStatus.includes("progress") ? "claimed" : "open");
  const blockedRaw = fieldOf(text, "Blocked by") || "";
  const blockedBy = /none/i.test(blockedRaw) ? [] : [...blockedRaw.matchAll(/\b(\d{1,4})\b/g)].map((hit) => Number(hit[1]));
  const answered = /^#{1,3}\s+Answer\s*$/im.test(text);
  return {
    number: match ? Number(match[1]) : null,
    slug: match ? match[2] : name.replace(/\.md$/i, ""),
    title: titleOf(text, match ? match[2].replace(/[-_]+/g, " ") : name).replace(/^\d{1,4}:\s*/, ""),
    file: rel(root, file),
    status: status === "open" && answered ? "resolved" : status,
    type: (fieldOf(text, "Type") || "").toLowerCase() || null,
    blockedBy,
  };
}

async function readEffort(root, dir, slug) {
  const effort = { slug, dir: rel(root, dir), map: null, spec: null, tickets: [], counts: { open: 0, claimed: 0, resolved: 0, frontier: 0 } };
  const mapFile = path.join(dir, "map.md");
  if (isFile(mapFile)) {
    const text = await head(mapFile, 64 * 1024);
    effort.map = {
      file: rel(root, mapFile),
      title: titleOf(text, slug.replace(/[-_]+/g, " ")),
      destination: clip(sectionOf(text, "Destination"), 400) || null,
      decisions: bulletCount(sectionOf(text, "Decisions so far")),
      fog: bulletCount(sectionOf(text, "Not yet specified")),
      outOfScope: bulletCount(sectionOf(text, "Out of scope")),
      notes: clip(sectionOf(text, "Notes"), 200) || null,
    };
  }
  const specFile = path.join(dir, "spec.md");
  if (isFile(specFile)) effort.spec = { file: rel(root, specFile), title: titleOf(await head(specFile, 2048), `${slug} spec`) };
  const issuesDir = path.join(dir, "issues");
  const entries = (await listDir(issuesDir)).filter((entry) => entry.isFile() && /\.md$/i.test(entry.name)).slice(0, LIMITS.ticketsPerEffort);
  for (const entry of entries) effort.tickets.push(await readTicket(root, path.join(issuesDir, entry.name), entry.name));
  effort.tickets.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.slug.localeCompare(b.slug));
  const resolved = new Set(effort.tickets.filter((ticket) => ticket.status === "resolved").map((ticket) => ticket.number));
  for (const ticket of effort.tickets) {
    ticket.unblocked = ticket.blockedBy.every((number) => resolved.has(number));
    effort.counts[ticket.status] += 1;
    if (ticket.status === "open" && ticket.unblocked) effort.counts.frontier += 1;
  }
  return effort;
}

async function readEfforts(root) {
  const scratch = path.join(root, ".scratch");
  const efforts = [];
  const entries = (await listDir(scratch)).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).slice(0, LIMITS.efforts);
  for (const entry of entries) {
    const effort = await readEffort(root, path.join(scratch, entry.name), entry.name);
    if (effort.map || effort.spec || effort.tickets.length) efforts.push(effort);
  }
  // Efforts with open work first, then the most recently numbered.
  efforts.sort((a, b) => (b.counts.open + b.counts.claimed) - (a.counts.open + a.counts.claimed) || a.slug.localeCompare(b.slug));
  return efforts;
}

// ---- remote tracker: GitHub issues through gh -------------------------------

// gh runs without a shell (execFile finds gh.exe on PATH itself, and nothing
// here needs cmd.exe's parsing) and without Studio's MEFI_STUDIO_*_KEY /
// _TOKEN, like every other child. A missing platform.cjs leaves the env as is.
let withholdCredentials = (options) => options;
try { ({ withholdCredentials } = require("./platform.cjs")); } catch {}

function run(command, args, { cwd, timeoutMs = LIMITS.remoteMs } = {}) {
  return new Promise((resolve) => {
    let child = null;
    try {
      child = execFile(command, args, withholdCredentials({ cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, process.env), (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), error: error ? (error.killed ? `${command} timed out after ${timeoutMs} ms` : String(stderr || error.message).trim().split(/\r?\n/)[0]) : null });
      });
    } catch (error) {
      resolve({ ok: false, stdout: "", stderr: "", error: error.message });
    }
    if (!child) resolve({ ok: false, stdout: "", stderr: "", error: `${command} could not start` });
  });
}

async function readRemote(root, tracker, { exec = run } = {}) {
  if (tracker.kind !== "github") return null;
  const result = await exec("gh", ["issue", "list", "--state", "open", "--limit", "100", "--json", "number,title,labels,assignees,url,updatedAt"], { cwd: root });
  if (!result.ok) return { ok: false, provider: "github", maps: [], tickets: [], error: result.error || "gh issue list failed" };
  let rows;
  try { rows = JSON.parse(result.stdout || "[]"); } catch { return { ok: false, provider: "github", maps: [], tickets: [], error: "gh returned something other than JSON" }; }
  if (!Array.isArray(rows)) rows = [];
  const issues = rows.map((row) => ({
    number: Number(row.number) || null,
    title: clip(row.title, 160),
    url: typeof row.url === "string" ? row.url : null,
    labels: Array.isArray(row.labels) ? row.labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean) : [],
    assigned: Array.isArray(row.assignees) && row.assignees.length > 0,
    updatedAt: typeof row.updatedAt === "string" ? Date.parse(row.updatedAt) || null : null,
  }));
  const maps = issues.filter((issue) => issue.labels.includes("wayfinder:map"));
  const tickets = issues.filter((issue) => !issue.labels.includes("wayfinder:map"));
  return {
    ok: true, provider: "github", maps, tickets,
    counts: {
      open: tickets.length,
      wayfinder: tickets.filter((issue) => issue.labels.some((label) => label.startsWith("wayfinder:"))).length,
      readyForAgent: tickets.filter((issue) => issue.labels.includes("ready-for-agent")).length,
      claimed: tickets.filter((issue) => issue.assigned).length,
    },
    error: null,
  };
}

// ---- tooling: agents, skills, commands ---------------------------------------

async function namesIn(dir, { kind, scope, source }) {
  const out = [];
  for (const entry of (await listDir(dir)).slice(0, LIMITS.names)) {
    if (kind === "skill") {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(dir, entry.name, "SKILL.md");
      if (!isFile(skillFile)) continue;
      const meta = frontmatter(await head(skillFile, 4096));
      out.push({ name: meta.name || entry.name, scope, source, description: clip(meta.description || "", 140) || null, file: skillFile });
    } else {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const meta = frontmatter(await head(path.join(dir, entry.name), 4096));
      out.push({ name: entry.name.replace(/\.md$/i, ""), scope, source, description: clip(meta.description || "", 140) || null, file: path.join(dir, entry.name) });
    }
  }
  return out;
}

async function readOpencodeConfig(file, scope) {
  if (!isFile(file)) return { agents: [], commands: [] };
  try {
    const config = JSON.parse(await head(file, 256 * 1024));
    const agents = config && typeof config.agent === "object" && config.agent ? Object.keys(config.agent).map((name) => ({ name, scope, source: "opencode.json", description: clip(config.agent[name]?.description || "", 140) || null, file })) : [];
    const commands = config && typeof config.command === "object" && config.command ? Object.keys(config.command).map((name) => ({ name, scope, source: "opencode.json", description: clip(config.command[name]?.description || "", 140) || null, file })) : [];
    return { agents, commands };
  } catch { return { agents: [], commands: [] }; }
}

async function readPlugins(home) {
  const plugins = [];
  const pluginsDir = path.join(home, ".claude", "plugins");
  const registry = path.join(pluginsDir, "installed_plugins.json");
  let installed = null;
  if (isFile(registry)) { try { installed = JSON.parse(await head(registry, 256 * 1024)); } catch { installed = null; } }
  const seen = new Set();
  const addPlugin = async (name, dir) => {
    if (!name || seen.has(name) || !isDir(dir)) return;
    seen.add(name);
    const skills = [...await namesIn(path.join(dir, "skills"), { kind: "skill", scope: "plugin", source: name })];
    // Plugins may group skills one level deeper (skills/engineering/<skill>).
    for (const entry of await listDir(path.join(dir, "skills"))) {
      if (entry.isDirectory() && !isFile(path.join(dir, "skills", entry.name, "SKILL.md"))) skills.push(...await namesIn(path.join(dir, "skills", entry.name), { kind: "skill", scope: "plugin", source: name }));
    }
    const agents = await namesIn(path.join(dir, "agents"), { kind: "agent", scope: "plugin", source: name });
    const commands = await namesIn(path.join(dir, "commands"), { kind: "command", scope: "plugin", source: name });
    plugins.push({ name, dir, skills, agents, commands });
  };
  const rows = installed && typeof installed === "object" ? (Array.isArray(installed.plugins) ? installed.plugins : typeof installed.plugins === "object" && installed.plugins ? Object.entries(installed.plugins).map(([key, value]) => ({ name: key, ...(typeof value === "object" && value ? value : {}) })) : []) : [];
  for (const row of rows.slice(0, 100)) {
    const name = String(row?.name || row?.id || "").split("@")[0];
    const dir = typeof row?.installPath === "string" ? row.installPath : typeof row?.path === "string" ? row.path : null;
    if (dir) await addPlugin(name, dir);
    else if (name && typeof row?.marketplace === "string") await addPlugin(name, path.join(pluginsDir, "marketplaces", row.marketplace, "plugins", name));
  }
  // Marketplace checkouts that carry a plugin manifest at their root.
  for (const market of await listDir(path.join(pluginsDir, "marketplaces"))) {
    if (!market.isDirectory()) continue;
    const dir = path.join(pluginsDir, "marketplaces", market.name);
    let name = market.name;
    const manifest = path.join(dir, ".claude-plugin", "plugin.json");
    if (isFile(manifest)) { try { name = JSON.parse(await head(manifest, 4096)).name || name; } catch {} }
    await addPlugin(name, dir);
    for (const entry of await listDir(path.join(dir, "plugins"))) if (entry.isDirectory()) await addPlugin(entry.name, path.join(dir, "plugins", entry.name));
  }
  return plugins;
}

async function readTooling(root, { home = os.homedir(), includeUser = true } = {}) {
  const agents = [], skills = [], commands = [];
  const add = (target, rows) => { for (const row of rows) if (!target.some((seen) => seen.name === row.name && seen.scope === row.scope)) target.push(row); };
  const scopes = [["project", root]];
  if (includeUser && home) scopes.push(["user", home]);
  for (const [scope, base] of scopes) {
    add(agents, await namesIn(path.join(base, ".claude", "agents"), { kind: "agent", scope, source: ".claude/agents" }));
    add(skills, await namesIn(path.join(base, ".claude", "skills"), { kind: "skill", scope, source: ".claude/skills" }));
    add(commands, await namesIn(path.join(base, ".claude", "commands"), { kind: "command", scope, source: ".claude/commands" }));
    add(skills, await namesIn(path.join(base, ".agents", "skills"), { kind: "skill", scope, source: ".agents/skills" }));
    const opencodeBase = scope === "user" ? path.join(base, ".config", "opencode") : path.join(base, ".opencode");
    for (const [kind, target, names] of [["agent", agents, ["agent", "agents"]], ["command", commands, ["command", "commands"]], ["skill", skills, ["skill", "skills"]]]) {
      for (const name of names) add(target, await namesIn(path.join(opencodeBase, name), { kind, scope, source: `${scope === "user" ? "~/.config/opencode" : ".opencode"}/${name}` }));
    }
    for (const file of scope === "user" ? [path.join(opencodeBase, "opencode.json"), path.join(opencodeBase, "opencode.jsonc")] : [path.join(base, "opencode.json"), path.join(base, "opencode.jsonc"), path.join(base, ".opencode", "opencode.json")]) {
      const config = await readOpencodeConfig(file, scope);
      add(agents, config.agents); add(commands, config.commands);
    }
  }
  // A marketplace checkout or an LSP-only plugin adds nothing the planner
  // can call; only plugins that carry skills, agents or commands are listed.
  const plugins = (includeUser && home ? await readPlugins(home) : []).filter((plugin) => plugin.skills.length || plugin.agents.length || plugin.commands.length);
  for (const plugin of plugins) { add(skills, plugin.skills); add(agents, plugin.agents); add(commands, plugin.commands); }
  const docs = { agentsMd: isFile(path.join(root, "AGENTS.md")) ? "AGENTS.md" : null, claudeMd: isFile(path.join(root, "CLAUDE.md")) ? "CLAUDE.md" : null, mcp: isFile(path.join(root, ".mcp.json")) ? ".mcp.json" : null };
  const strip = (rows) => rows.map(({ file, ...row }) => row);
  return {
    agents: strip(agents), skills: strip(skills), commands: strip(commands),
    plugins: plugins.map((plugin) => ({ name: plugin.name, skills: plugin.skills.length, agents: plugin.agents.length, commands: plugin.commands.length })),
    docs,
    counts: { agents: agents.length, skills: skills.length, commands: commands.length, plugins: plugins.length },
  };
}

// ---- the summary --------------------------------------------------------------

const cache = new Map();

async function scanProjectWork(root, { remote = true, includeUser = true, home = os.homedir(), exec = run, now = Date.now(), fresh = false } = {}) {
  const canonical = typeof root === "string" && root ? path.resolve(root) : null;
  if (!canonical || !isDir(canonical)) return { ok: false, root: canonical, error: "The project folder is not available.", tracker: null, efforts: [], remote: null, tooling: null };
  const key = `${canonical}|${remote}|${includeUser}`;
  const hit = cache.get(key);
  if (!fresh && hit && now - hit.at < LIMITS.cacheMs) return hit.value;
  const tracker = await readTracker(canonical);
  const [efforts, remoteWork, tooling] = await Promise.all([
    readEfforts(canonical),
    remote ? readRemote(canonical, tracker, { exec }).catch((error) => ({ ok: false, provider: "github", maps: [], tickets: [], error: error.message })) : Promise.resolve(null),
    readTooling(canonical, { home, includeUser }),
  ]);
  const counts = {
    maps: efforts.filter((effort) => effort.map).length + (remoteWork?.maps?.length ?? 0),
    specs: efforts.filter((effort) => effort.spec).length,
    open: efforts.reduce((sum, effort) => sum + effort.counts.open + effort.counts.claimed, 0) + (remoteWork?.counts?.open ?? 0),
    frontier: efforts.reduce((sum, effort) => sum + effort.counts.frontier, 0),
    resolved: efforts.reduce((sum, effort) => sum + effort.counts.resolved, 0),
  };
  const value = { ok: true, root: canonical, scannedAt: now, tracker, efforts, remote: remoteWork, tooling, counts };
  cache.set(key, { at: now, value });
  return value;
}

// One or two sentences for the assistant's keyless reply and the chat facts.
function describeProjectWork(work) {
  if (!work?.ok) return null;
  const parts = [];
  const trackerName = { github: "GitHub issues", gitlab: "GitLab issues", linear: "Linear", local: "local markdown under .scratch/", other: "a custom tracker" }[work.tracker?.kind];
  if (work.tracker?.kind) parts.push(`Issue tracker: ${trackerName}${work.tracker.doc ? ` (${work.tracker.doc})` : ""}.`);
  for (const effort of work.efforts.slice(0, 3)) {
    const bits = [];
    if (effort.map) bits.push(`map "${effort.map.title}" (${effort.map.decisions} decided, ${effort.map.fog} in the fog)`);
    if (effort.tickets.length) bits.push(`${effort.counts.open + effort.counts.claimed} open ticket${effort.counts.open + effort.counts.claimed === 1 ? "" : "s"} (${effort.counts.frontier} on the frontier), ${effort.counts.resolved} resolved`);
    if (effort.spec && !effort.map) bits.push("spec saved");
    parts.push(`${effort.dir}: ${bits.join(", ") || "empty"}.`);
  }
  if (work.efforts.length > 3) parts.push(`+${work.efforts.length - 3} more efforts under .scratch/.`);
  if (work.remote) {
    parts.push(work.remote.ok
      ? `GitHub: ${work.remote.tickets.length} open issue${work.remote.tickets.length === 1 ? "" : "s"}${work.remote.maps.length ? `, ${work.remote.maps.length} wayfinder map${work.remote.maps.length === 1 ? "" : "s"}: ${work.remote.maps.slice(0, 2).map((map) => `"${map.title}"`).join(", ")}` : ""}${work.remote.counts.readyForAgent ? `, ${work.remote.counts.readyForAgent} ready-for-agent` : ""}.`
      : `GitHub issues could not be listed (${work.remote.error}).`);
  }
  if (work.tooling) {
    const { counts } = work.tooling;
    if (counts.agents || counts.skills || counts.commands) parts.push(`Tooling: ${counts.agents} agent${counts.agents === 1 ? "" : "s"}, ${counts.skills} skill${counts.skills === 1 ? "" : "s"}, ${counts.commands} command${counts.commands === 1 ? "" : "s"}${counts.plugins ? ` across ${counts.plugins} plugin${counts.plugins === 1 ? "" : "s"}` : ""}.`);
  }
  return parts.length ? parts.join(" ") : null;
}

module.exports = { scanProjectWork, describeProjectWork, readTracker, readEfforts, readRemote, readTooling, LIMITS, _clearCache: () => cache.clear() };
