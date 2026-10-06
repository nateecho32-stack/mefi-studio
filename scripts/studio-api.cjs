// Mefi's Studio AI+ — the Studio API's rules (docs/studio-api.md).
//
// Other apps on this PC (Claude Code, Codex, Cursor, a script, a hotkey tool)
// reach Studio through a small HTTP endpoint on 127.0.0.1 that the owner turns
// on in Settings › Other apps. They look (status, needs, made), talk to Mefi
// (say), file a task, leave a note, brake and resume, and read where Studio
// lives for setup help. scripts/studio-api-server.cjs listens,
// scripts/studio-link.mjs is the MCP server and command line the apps run,
// and main.cjs "Other apps" does the work. This module decides what a request
// may be, how each answer reads, the commands that connect an app, the setup
// prompt and the Claude Code skill.
//
// An app is treated like a message from Discord (scripts/remote.cjs): it may
// look, talk and file work, and the work it files waits for the owner's OK in
// every permission mode (origin.via "app", autonomy.remoteWork). Approving,
// answering Studio's questions and changing settings stay in Studio.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.
"use strict";

const remote = require("./remote.cjs");

const API_VERSION = 1;
// A fixed port keeps the address the same between launches; when another
// program holds it, the server takes any free port and the key file says which.
const DEFAULT_PORT = 47615;
const FILE_NAME = "studio-api.json";
const SERVER_NAME = "mefi-studio";
const SAY_MAX = 8000;
const TITLE_MAX = 90;
const DETAIL_MAX = 8000;
const NOTE_MAX = 400;
const NOTE_TITLE_MAX = 80;
const APP_MAX = 40;
const LOG_MAX = 30;
const BODY_MAX = 64 * 1024;
// How many calls a minute the endpoint answers: all of them, and the ones that
// start model work (a message to Mefi, a new task).
const RATE = Object.freeze({ all: 120, work: 12 });
// Work an app files: the owner's own kind of card, held for their OK.
const ORIGIN = Object.freeze({ kind: "chat", by: "owner", via: "app" });
const NOTE_LEVELS = Object.freeze(["info", "done", "warn"]);

const ROUTES = Object.freeze([
  { name: "hello", method: "GET", path: "/v1/hello", about: "Is Studio there: its version and the open project." },
  { name: "status", method: "GET", path: "/v1/status", about: "What the agents are doing and what waits on the owner." },
  { name: "needs", method: "GET", path: "/v1/needs", about: "Everything waiting on the owner, numbered." },
  { name: "made", method: "GET", path: "/v1/made", about: "What is being built now, and what finished or stopped today." },
  { name: "say", method: "POST", path: "/v1/say", work: true, about: "A message to Mefi, Studio's assistant. The answer comes back (up to three minutes)." },
  { name: "task", method: "POST", path: "/v1/tasks", work: true, about: "File a task on the open project. It waits for the owner's OK." },
  { name: "notify", method: "POST", path: "/v1/notify", about: "Show the owner a short note in Studio." },
  { name: "pause", method: "POST", path: "/v1/pause", about: "Nothing new starts until resume. Running work finishes." },
  { name: "resume", method: "POST", path: "/v1/resume", about: "Agents pick up work again." },
  { name: "setup", method: "GET", path: "/v1/setup", about: "Where Studio lives on this PC, its version, and what to read for setup help." },
]);

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneLine = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const block = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The saved choice: settings.studioApi = { on }. Off unless the owner turned it on. */
function normalizeSettings(raw) {
  return { on: object(raw) && raw.on === true };
}

/** The route a request names, or why it has none (404, or 405 for the wrong method). */
function route(method, url) {
  let pathname = "";
  try { pathname = new URL(String(url ?? ""), "http://127.0.0.1").pathname.replace(/\/+$/, "") || "/"; } catch { return { error: "Not here.", status: 404 }; }
  const matches = ROUTES.filter((row) => row.path === pathname);
  if (!matches.length) return { error: "Not here. GET /v1/hello lists what Studio answers.", status: 404 };
  const found = matches.find((row) => row.method === String(method ?? "").toUpperCase());
  return found ? { route: found } : { error: `Use ${matches[0].method} for ${pathname}.`, status: 405, allow: matches[0].method };
}

/**
 * Only this PC's loopback names, on the port Studio listens on: a web page that
 * points a name of its own at 127.0.0.1 (DNS rebinding) sends its own Host.
 */
function hostAllowed(host, port) {
  const value = String(host ?? "").trim().toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

/** The key a caller sent: `Authorization: Bearer <key>` or `X-Mefi-Token: <key>`. */
function presentedKey(headers = {}) {
  const auth = String(headers.authorization ?? "");
  const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return match ? match[1] : String(headers["x-mefi-token"] ?? "");
}

// The names MCP clients give themselves (clientInfo.name), as people know them.
const KNOWN_APPS = Object.freeze({
  "claude-code": "Claude Code", "claude-ai": "Claude Desktop", "codex": "Codex", "codex-mcp-client": "Codex",
  "cursor-vscode": "Cursor", "cursor": "Cursor", "visual studio code": "VS Code", "vscode": "VS Code",
  "windsurf-client": "Windsurf", "windsurf": "Windsurf", "opencode": "OpenCode", "gemini-cli-mcp-client": "Gemini CLI",
});

/** The name an app gave itself (X-Mefi-App), one short line; "An app" without one. */
function appName(value) {
  const name = oneLine(value, APP_MAX);
  return KNOWN_APPS[name.toLowerCase()] ?? (name || "An app");
}

/** What a route's body may hold, cut to size; `{ ok: false, error }` when it is missing what it needs. */
function fields(name, body) {
  const input = object(body) ? body : {};
  switch (name) {
    case "say": {
      const text = block(input.text, SAY_MAX + 1);
      if (!text) return { ok: false, error: "Send the message in `text`." };
      if (text.length > SAY_MAX) return { ok: false, error: `A message is at most ${SAY_MAX} characters.` };
      return { ok: true, fields: { text } };
    }
    case "task": {
      const title = oneLine(input.title, TITLE_MAX);
      if (!title) return { ok: false, error: "Name the task in `title` (one line)." };
      return { ok: true, fields: { title, detail: block(input.detail, DETAIL_MAX) } };
    }
    case "notify": {
      const text = block(input.text, NOTE_MAX);
      if (!text) return { ok: false, error: "Send the note in `text`." };
      const level = NOTE_LEVELS.includes(input.level) ? input.level : "info";
      return { ok: true, fields: { text, title: oneLine(input.title, NOTE_TITLE_MAX), level } };
    }
    default:
      return { ok: true, fields: {} };
  }
}

// ---- answers ------------------------------------------------------------------------------

const UNREAD = "Studio could not read the board just now. Try again in a minute.";

/** `hello`: who answered. */
function helloReply({ version = "", project = null } = {}) {
  return {
    text: `Mefi's Studio AI+ ${version} is here${project ? `, with ${project} open` : ", with no project open"}.`,
    data: { app: "Mefi's Studio AI+", version: String(version), api: API_VERSION, project: project || null, routes: ROUTES.map(({ method, path, about }) => ({ method, path, about })) },
  };
}

/** `status`: the loop's words, what is being built, and the tally. */
function statusReply(snapshot, { now }) {
  if (!snapshot) return { ok: false, text: UNREAD };
  return {
    text: remote.statusReply(snapshot, { now }).text,
    data: {
      project: snapshot.project ?? null, state: snapshot.state ?? null, headline: snapshot.headline ?? "",
      working: (snapshot.working ?? []).map(({ title, since, step }) => ({ title, since: since ?? null, step: step ?? null })),
      needsYou: snapshot.needsYou ?? 0, done: snapshot.done?.length ?? 0, failed: snapshot.failed?.length ?? 0,
    },
  };
}

/** `needs`: what waits on the owner. An app can read it; the owner answers it in Studio. */
function needsReply(needs) {
  if (!needs) return { ok: false, text: UNREAD };
  const items = Array.isArray(needs.items) ? needs.items : [];
  if (!items.length) return { text: "Nothing needs the owner in Studio right now.", data: { total: 0, items: [] } };
  const kindWord = { approval: "Approve", question: "Question", held: "Held", parked: "Stopped", review: "Review" };
  const lines = [`${plural(needs.total ?? items.length, "thing needs", "things need")} the owner in Studio:`];
  items.slice(0, 12).forEach((item, index) => lines.push(`${index + 1}. ${kindWord[item.kind] ?? "Needs you"}: ${remote.plain(item.title)}`));
  if (items.length > 12) lines.push(`…and ${items.length - 12} more.`);
  lines.push("The owner answers and approves these in Studio.");
  return { text: remote.clip(lines.join("\n"), 4000), data: { total: needs.total ?? items.length, items: items.map(({ kind, title, taskId, label, choices }) => ({ kind, title, ...(taskId ? { taskId } : {}), ...(label ? { label } : {}), ...(choices ? { choices } : {}) })) } };
}

/** `made`: what is being built now, and what finished or stopped today. */
function madeReply(snapshot, { now }) {
  if (!snapshot) return { ok: false, text: UNREAD };
  return { text: remote.madeReply(snapshot, { now }).text, data: { working: (snapshot.working ?? []).map(({ title }) => title), done: snapshot.done ?? [], failed: snapshot.failed ?? [] } };
}

/** Mefi's answer to `say`, with what its actions did. */
function sayReply(reply) {
  return { text: remote.sayReply(reply).text, data: { reply: String(reply?.text ?? ""), results: Array.isArray(reply?.results) ? reply.results.map(String) : [] } };
}

/** What filing a task did: a new card held for the OK, or the card already on the board. */
function taskReply(admission, { app = "An app" } = {}) {
  if (admission?.existing) {
    const item = admission.existing.item ?? {};
    const title = remote.plain(item.title ?? item.ref?.title ?? "that task");
    return { text: `That is already on the board: ${title}${item.status ? ` (${item.status})` : ""}. Nothing new was filed.`, data: { existing: true, title, status: item.status ?? null } };
  }
  const created = admission?.created;
  if (!created) return { ok: false, text: "Studio could not file that task." };
  return {
    text: `Filed "${remote.plain(created.title)}". It waits for the owner's OK in Studio, because it came from ${app}.`,
    data: { created: true, id: created.id ?? null, title: created.title ?? "", waitsForOk: true },
  };
}

// ---- connecting an app --------------------------------------------------------------------

// A path in commands the owner pastes: forward slashes on Windows (every shell
// and Node read them), in double quotes. A path with a character one of the
// shells would still expand is marked, and the card offers the JSON instead.
const RISKY = /["$`%!\n\r]/;
function quoted(value, platform) {
  const text = platform === "win32" ? String(value).replace(/\\/g, "/") : String(value);
  return { text: `"${text}"`, risky: RISKY.test(text) };
}

/**
 * How an app starts studio-link.mjs: plain `node` in a source checkout (it
 * needs Node anyway), else the app's own program run as Node.
 */
function launcher({ packaged = false, execPath = "", electron = false, script = "", platform = "win32" } = {}) {
  const command = packaged ? String(execPath) : "node";
  const env = packaged && electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  const scriptPath = platform === "win32" ? String(script).replace(/\\/g, "/") : String(script);
  const commandPath = packaged && platform === "win32" ? command.replace(/\\/g, "/") : command;
  return { command: commandPath, args: [scriptPath], env };
}

/** The commands and config that connect Claude Code, Codex and other MCP apps, and the command line. */
function connect(options = {}) {
  const platform = options.platform ?? "win32";
  const run = launcher(options);
  const exe = run.command === "node" ? { text: "node", risky: false } : quoted(run.command, platform);
  const script = quoted(run.args[0], platform);
  const risky = exe.risky || script.risky;
  const envPairs = Object.entries(run.env);
  const tail = `${exe.text} ${script.text}`;
  const claudeCode = `claude mcp add --scope user ${SERVER_NAME}${envPairs.map(([key, value]) => ` -e ${key}=${value}`).join("")} -- ${tail} mcp`;
  const codex = `codex mcp add ${SERVER_NAME}${envPairs.map(([key, value]) => ` --env ${key}=${value}`).join("")} -- ${tail} mcp`;
  const json = JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: run.command, args: [...run.args, "mcp"], ...(envPairs.length ? { env: run.env } : {}) } } }, null, 2);
  const bash = `${envPairs.map(([key, value]) => `${key}=${value} `).join("")}${tail}`;
  const powershell = envPairs.length
    ? `& { ${envPairs.map(([key, value]) => `$env:${key}='${value}'`).join("; ")}; & ${tail} @args; ${envPairs.map(([key]) => `Remove-Item Env:${key}`).join("; ")} }`
    : `& ${tail}`;
  return { name: SERVER_NAME, launch: run, claudeCode, codex, json, cli: { bash, powershell }, risky };
}

// ---- the setup prompt and the skill --------------------------------------------------------

const DOCS_URL = "https://github.com/nateecho32-stack/mefi-studio/blob/main";

/**
 * The prompt the owner pastes into Claude Code, Codex or another AI helper so
 * it can help set Studio up: where Studio lives on this PC, what to read
 * first, what to check, and what it must leave alone (keys, Studio's own
 * files). `info` is setupInfo's answer.
 */
function setupPrompt(info = {}) {
  const folders = info.folders ?? {};
  const docs = info.docs ?? [];
  const link = info.link ?? null;
  const lines = [
    "I'm setting up Mefi's Studio AI+ on this PC and I'd like your help. Read the files below first, then walk me through it one step at a time, in plain words.",
    "",
    "Where Studio is on this PC:",
    `- Studio's folder: ${folders.studio || "(unknown)"}${info.packaged ? " (the portable app; run it with the .exe there)" : " (a source checkout; run it with `npm start` there)"}`,
  ];
  if (folders.app && folders.app !== folders.studio) lines.push(`- Studio's app files (scripts, README): ${folders.app}`);
  if (folders.data) lines.push(`- Studio's settings and data: ${folders.data}`);
  lines.push(`- The project open in Studio: ${folders.project || "none yet"}`);
  lines.push(`- Version ${info.version || "?"} on ${info.os || info.platform || "this PC"}`);
  lines.push("", "Read these first:");
  for (const doc of docs) lines.push(`- ${doc}`);
  lines.push(
    "",
    "Help me with:",
    "1. Check what Studio needs on this PC and tell me what is missing: run `git --version`, `node --version`, `gh auth status`, and the coding tools I might use (`claude --version`, `codex --version`, `opencode --version`).",
    "2. Get one AI connected in Studio (an account I already pay for, like Claude or ChatGPT, or an API key) and one builder (Claude Code, Codex or OpenCode), and tell me which Studio screen to use for each.",
    "3. Open my first project folder in Studio and give it one small, clear task.",
    "4. If something fails, read Studio's log and the docs above and tell me what went wrong.",
    "",
    "Ground rules:",
    "- Never open, print, copy or edit my keys: auth.json, any .env file, API keys or tokens. When a key is needed, tell me where to paste it in Studio.",
    "- Change Studio's settings through Studio's own screens, not by editing its files. Tell me what to click.",
    "- Ask me before you install anything or change files outside my project.",
    "- Don't move or delete anything in Studio's data folder.",
  );
  if (link?.on) {
    lines.push(
      "",
      "Studio's API is on, so you can talk to Studio directly on this PC:",
      `- Connect it as an MCP server (Claude Code): ${link.claudeCode}`,
      `- Or Codex: ${link.codex}`,
      "- The tools are studio_status, studio_needs, studio_message, studio_add_task, studio_notify and studio_setup_info. Tasks you file wait for my OK in Studio.",
    );
  } else {
    lines.push("", "Studio can also let you talk to it directly (Settings › Other apps › Let apps on this PC talk to Studio). It's off right now; tell me if turning it on would help.");
  }
  return lines.join("\n");
}

/** The Claude Code skill (SKILL.md): when to reach for Studio and how. */
function skillText({ cli = null } = {}) {
  const run = cli?.bash || "node <Studio's folder>/scripts/studio-link.mjs";
  const lines = [
    "---",
    "name: mefi-studio",
    "description: Talk to Mefi's Studio AI+, the agent studio running on this PC. Use it to see what Studio's agents are doing or what waits on the owner, to message Mefi (Studio's assistant), to hand a task to Studio's agents, to leave the owner a note in Studio, or to find where Studio is installed when helping set it up. Use when the user mentions Studio, Mefi, or handing work to their agents.",
    "---",
    "",
    "# Mefi's Studio AI+",
    "",
    "Studio runs on this PC and answers only on 127.0.0.1, while the owner has Settings › Other apps › \"Let apps on this PC talk to Studio\" turned on. Its address and key are in `~/.mefi-studio/studio-api.json`; never print the key.",
    "",
    "## How to call it",
    "",
    "Use the `mefi-studio` MCP tools when they are connected: `studio_status`, `studio_needs`, `studio_message`, `studio_add_task`, `studio_notify`, `studio_setup_info`, `studio_control`.",
    "",
    "Without them, use Studio's command line. Below, `studio` stands for:",
    "",
    "```bash",
    run,
    "```",
  ];
  if (cli?.powershell) lines.push("", "In PowerShell it is:", "", "```powershell", cli.powershell, "```");
  lines.push(
    "",
    "```bash",
    "studio status                 # what the agents are doing",
    "studio needs                  # what waits on the owner",
    "studio made                   # built now, finished today",
    "studio say \"your message\"     # talk to Mefi; prints the reply",
    "studio task \"Title\" --detail \"What to do, and why\"",
    "studio notify \"Short note for the owner\"",
    "studio setup                  # where Studio lives, version, docs",
    "```",
  );
  lines.push(
    "",
    "Add `--json` for the full answer as JSON.",
    "",
    "## Rules",
    "",
    "- A task you file waits for the owner's OK in Studio. Tell the user that when you file one.",
    "- Approving work, answering Studio's questions and changing Studio's settings happen in Studio, never from here.",
    "- `say` can take a minute or two: Mefi may run tools before it answers.",
    "- If Studio can't be reached, ask the user to open Studio and turn on Settings › Other apps.",
  );
  return `${lines.join("\n")}\n`;
}

/** One row of the card's log: who called and what, never the words. */
function logRow({ at, app, route: name, ok = true, note = "" } = {}) {
  return { at, app: appName(app), route: String(name ?? ""), ok: ok !== false, ...(note ? { note: oneLine(note, 80) } : {}) };
}

module.exports = {
  API_VERSION, DEFAULT_PORT, FILE_NAME, SERVER_NAME, SAY_MAX, TITLE_MAX, DETAIL_MAX, NOTE_MAX, LOG_MAX, BODY_MAX, RATE, ORIGIN, ROUTES, DOCS_URL,
  normalizeSettings, route, hostAllowed, presentedKey, appName, fields,
  helloReply, statusReply, needsReply, madeReply, sayReply, taskReply,
  launcher, connect, setupPrompt, skillText, logRow,
};
