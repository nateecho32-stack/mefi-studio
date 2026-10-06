// The Studio API's rules (scripts/studio-api.cjs, docs/studio-api.md): which
// routes exist and with which method, that only this PC's loopback names and
// the key get in, what a body may hold, how each answer reads, the commands
// that connect Claude Code, Codex and other MCP apps (quoted for every shell,
// with the app's own program run as Node in a portable build), the setup
// prompt (Studio's folders, the docs, the ground rules about keys) and the
// Claude Code skill.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rules = require("../scripts/studio-api.cjs");

test("routes: each path answers one method, and the rest are told which", () => {
  assert.equal(rules.route("GET", "/v1/status").route.name, "status");
  assert.equal(rules.route("GET", "/v1/status/?x=1").route.name, "status", "a trailing slash and a query still find it");
  assert.equal(rules.route("POST", "/v1/say").route.name, "say");
  assert.equal(rules.route("POST", "/v1/tasks").route.name, "task");
  assert.deepEqual(rules.route("GET", "/v1/say"), { error: "Use POST for /v1/say.", status: 405, allow: "POST" });
  assert.equal(rules.route("GET", "/v2/status").status, 404);
  assert.equal(rules.route("GET", "/").status, 404);
  assert.deepEqual(rules.ROUTES.filter((row) => row.work).map((row) => row.name), ["say", "task"], "only Mefi and a new task count as work");
  for (const row of rules.ROUTES) assert.ok(row.about.length > 10, `${row.name} says what it does`);
});

test("only 127.0.0.1 and localhost on Studio's own port, and the key from either header", () => {
  assert.equal(rules.hostAllowed("127.0.0.1:47615", 47615), true);
  assert.equal(rules.hostAllowed("LOCALHOST:47615", 47615), true);
  assert.equal(rules.hostAllowed("127.0.0.1:80", 47615), false);
  assert.equal(rules.hostAllowed("evil.example:47615", 47615), false, "a rebinding name is refused");
  assert.equal(rules.hostAllowed(undefined, 47615), false);
  assert.equal(rules.presentedKey({ authorization: "Bearer abc" }), "abc");
  assert.equal(rules.presentedKey({ authorization: "bearer  abc " }), "abc");
  assert.equal(rules.presentedKey({ "x-mefi-token": "def" }), "def");
  assert.equal(rules.presentedKey({ authorization: "Basic abc" }), "");
  assert.equal(rules.appName("  Claude\nCode  "), "Claude Code");
  assert.equal(rules.appName(""), "An app");
  assert.equal(rules.appName("x".repeat(90)).length, 40);
  assert.equal(rules.appName("claude-code"), "Claude Code", "an MCP client's own id reads as its name");
  assert.equal(rules.appName("codex-mcp-client"), "Codex");
  assert.equal(rules.appName("Cursor-VSCode"), "Cursor");
});

test("bodies: a message, a task and a note are checked and cut to size", () => {
  assert.deepEqual(rules.fields("say", { text: "  hi\r\nthere " }), { ok: true, fields: { text: "hi\nthere" } });
  assert.equal(rules.fields("say", {}).ok, false);
  assert.equal(rules.fields("say", { text: "x".repeat(rules.SAY_MAX + 1) }).ok, false, "an over-long message is refused whole, not cut");
  assert.deepEqual(rules.fields("task", { title: " Add\tdark mode ", detail: "Use tokens" }), { ok: true, fields: { title: "Add dark mode", detail: "Use tokens" } });
  assert.equal(rules.fields("task", { detail: "no title" }).ok, false);
  assert.equal(rules.fields("task", { title: "x".repeat(200) }).fields.title.length, rules.TITLE_MAX);
  assert.deepEqual(rules.fields("notify", { text: "Done", level: "loud" }), { ok: true, fields: { text: "Done", title: "", level: "info" } });
  assert.equal(rules.fields("notify", { text: "Done", level: "done" }).fields.level, "done");
  assert.deepEqual(rules.fields("status", { anything: 1 }), { ok: true, fields: {} });
  assert.deepEqual(rules.normalizeSettings({ on: true, port: 9 }), { on: true });
  assert.deepEqual(rules.normalizeSettings({ on: "yes" }), { on: false });
  assert.deepEqual(rules.normalizeSettings(null), { on: false });
});

test("answers: status, needs and made read like the Discord remote's, with the data under them", () => {
  const now = 10 * 60 * 1000;
  const snapshot = { project: "Quillfold", state: "running", headline: "1 agent working", working: [{ title: "Add login", since: now - 60000, step: "tests" }], needsYou: 2, done: ["Fix menu"], failed: [] };
  const status = rules.statusReply(snapshot, { now });
  assert.match(status.text, /^\*\*Quillfold\*\* · 1 agent working\n• Add login \(1 min\)/);
  assert.deepEqual(status.data, { project: "Quillfold", state: "running", headline: "1 agent working", working: [{ title: "Add login", since: now - 60000, step: "tests" }], needsYou: 2, done: 1, failed: 0 });
  assert.equal(rules.statusReply(null, { now }).ok, false);
  const needs = rules.needsReply({ total: 2, items: [{ kind: "approval", title: "Ship it", taskId: "t1" }, { kind: "question", title: "Which color?", choices: ["Red", "Blue"] }] });
  assert.equal(needs.text, "2 things need the owner in Studio:\n1. Approve: Ship it\n2. Question: Which color?\nThe owner answers and approves these in Studio.");
  assert.deepEqual(needs.data.items[1], { kind: "question", title: "Which color?", choices: ["Red", "Blue"] });
  assert.doesNotMatch(needs.text, /PIN|Discord/, "nothing about Discord's approvals");
  assert.equal(rules.needsReply({ total: 0, items: [] }).text, "Nothing needs the owner in Studio right now.");
  assert.match(rules.madeReply(snapshot, { now }).text, /\*\*Building now\*\*\n• Add login \(1 min\) — tests\n\*\*Finished today\*\*\n• Fix menu/);
  assert.equal(rules.sayReply({ text: "On it.", results: ["Filed Add search"] }).text, "On it.\n\nFiled Add search");
});

test("a filed task says it waits for the owner's OK and who filed it; a duplicate says it is already there", () => {
  const created = rules.taskReply({ created: { id: "t9", title: "Add dark mode" } }, { app: "Claude Code" });
  assert.equal(created.text, 'Filed "Add dark mode". It waits for the owner\'s OK in Studio, because it came from Claude Code.');
  assert.deepEqual(created.data, { created: true, id: "t9", title: "Add dark mode", waitsForOk: true });
  const existing = rules.taskReply({ existing: { kind: "task", item: { title: "Add dark mode", status: "open" } } });
  assert.equal(existing.text, "That is already on the board: Add dark mode (open). Nothing new was filed.");
  assert.equal(rules.taskReply(null).ok, false);
  assert.deepEqual({ ...rules.ORIGIN }, { kind: "chat", by: "owner", via: "app" });
});

test("connect: a portable build runs its own program as Node; a source checkout runs node", () => {
  const exe = "C:\\Users\\Jo\\Apps\\Mefi Studio AI+\\Mefi Studio AI+.exe";
  const script = "C:\\Users\\Jo\\Apps\\Mefi Studio AI+\\resources\\app\\scripts\\studio-link.mjs";
  const portable = rules.connect({ packaged: true, electron: true, execPath: exe, script, platform: "win32" });
  const fwdExe = '"C:/Users/Jo/Apps/Mefi Studio AI+/Mefi Studio AI+.exe"';
  const fwdScript = '"C:/Users/Jo/Apps/Mefi Studio AI+/resources/app/scripts/studio-link.mjs"';
  assert.equal(portable.claudeCode, `claude mcp add --scope user mefi-studio -e ELECTRON_RUN_AS_NODE=1 -- ${fwdExe} ${fwdScript} mcp`);
  assert.equal(portable.codex, `codex mcp add mefi-studio --env ELECTRON_RUN_AS_NODE=1 -- ${fwdExe} ${fwdScript} mcp`);
  assert.deepEqual(JSON.parse(portable.json), { mcpServers: { "mefi-studio": { command: "C:/Users/Jo/Apps/Mefi Studio AI+/Mefi Studio AI+.exe", args: ["C:/Users/Jo/Apps/Mefi Studio AI+/resources/app/scripts/studio-link.mjs", "mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } } } });
  assert.equal(portable.cli.bash, `ELECTRON_RUN_AS_NODE=1 ${fwdExe} ${fwdScript}`);
  assert.equal(portable.cli.powershell, `& { $env:ELECTRON_RUN_AS_NODE='1'; & ${fwdExe} ${fwdScript} @args; Remove-Item Env:ELECTRON_RUN_AS_NODE }`);
  assert.equal(portable.risky, false);
  const source = rules.connect({ packaged: false, electron: true, execPath: "C:\\x\\electron.exe", script: "C:\\Code\\Mefi's Studio AI+\\scripts\\studio-link.mjs", platform: "win32" });
  assert.equal(source.claudeCode, `claude mcp add --scope user mefi-studio -- node "C:/Code/Mefi's Studio AI+/scripts/studio-link.mjs" mcp`, "an apostrophe is safe inside double quotes");
  assert.deepEqual(JSON.parse(source.json).mcpServers["mefi-studio"], { command: "node", args: ["C:/Code/Mefi's Studio AI+/scripts/studio-link.mjs", "mcp"] });
  assert.equal(source.cli.powershell, `& node "C:/Code/Mefi's Studio AI+/scripts/studio-link.mjs"`);
  const tauri = rules.connect({ packaged: true, electron: false, execPath: "C:\\App\\node.exe", script: "C:\\App\\resources\\app\\scripts\\studio-link.mjs", platform: "win32" });
  assert.deepEqual(tauri.launch, { command: "C:/App/node.exe", args: ["C:/App/resources/app/scripts/studio-link.mjs"], env: {} }, "the Rust host's engine is Node already");
  assert.equal(rules.connect({ packaged: false, script: "C:\\100%\\studio-link.mjs", platform: "win32" }).risky, true, "a path a shell would expand is flagged");
  assert.equal(rules.connect({ packaged: false, script: "/home/jo/studio/scripts/studio-link.mjs", platform: "linux" }).claudeCode, 'claude mcp add --scope user mefi-studio -- node "/home/jo/studio/scripts/studio-link.mjs" mcp');
});

test("the setup prompt names Studio's folders and docs, keeps keys out, and offers the API only when it is on", () => {
  const info = {
    version: "0.4.5", packaged: true, os: "Windows 10.0.26200 (x64)",
    folders: { studio: "C:\\Apps\\Mefi Studio AI+", app: "C:\\Apps\\Mefi Studio AI+\\resources\\app", data: "C:\\Users\\Jo\\AppData\\Roaming\\mefi-studio", project: "C:\\Code\\game" },
    docs: ["C:\\Apps\\Mefi Studio AI+\\resources\\app\\README.md (what Studio is)", `${rules.DOCS_URL}/docs/studio-api.md (how other apps talk to Studio)`],
  };
  const off = rules.setupPrompt(info);
  assert.match(off, /^I'm setting up Mefi's Studio AI\+ on this PC/);
  assert.ok(off.includes("- Studio's folder: C:\\Apps\\Mefi Studio AI+ (the portable app; run it with the .exe there)"));
  assert.ok(off.includes("- Studio's app files (scripts, README): C:\\Apps\\Mefi Studio AI+\\resources\\app"));
  assert.ok(off.includes("- Studio's settings and data: C:\\Users\\Jo\\AppData\\Roaming\\mefi-studio"));
  assert.ok(off.includes("- The project open in Studio: C:\\Code\\game"));
  assert.ok(off.includes("- Version 0.4.5 on Windows 10.0.26200 (x64)"));
  assert.ok(off.includes(`- ${rules.DOCS_URL}/docs/studio-api.md (how other apps talk to Studio)`));
  assert.match(off, /Never open, print, copy or edit my keys: auth\.json/);
  assert.match(off, /It's off right now/);
  assert.doesNotMatch(off, /claude mcp add/, "no commands while the API is off");
  const link = { ...rules.connect({ packaged: false, script: "C:\\S\\scripts\\studio-link.mjs", platform: "win32" }), on: true };
  const on = rules.setupPrompt({ ...info, packaged: false, folders: { ...info.folders, app: info.folders.studio, project: null }, link });
  assert.ok(on.includes("(a source checkout; run it with `npm start` there)"));
  assert.ok(!on.includes("Studio's app files"), "one folder is named once");
  assert.ok(on.includes("- The project open in Studio: none yet"));
  assert.ok(on.includes(`- Connect it as an MCP server (Claude Code): ${link.claudeCode}`));
  assert.ok(on.includes("Tasks you file wait for my OK in Studio."));
});

test("the skill is a valid SKILL.md with this PC's command, and the log never keeps words", () => {
  const cli = rules.connect({ packaged: true, electron: true, execPath: "C:\\A\\S.exe", script: "C:\\A\\resources\\app\\scripts\\studio-link.mjs", platform: "win32" }).cli;
  const skill = rules.skillText({ cli });
  assert.match(skill, /^---\nname: mefi-studio\ndescription: .+\n---\n/);
  assert.ok(skill.includes(`\`\`\`bash\n${cli.bash}\n\`\`\``));
  assert.ok(skill.includes(`\`\`\`powershell\n${cli.powershell}\n\`\`\``));
  assert.match(skill, /studio say "your message"/);
  assert.match(skill, /never print the key/);
  assert.ok(skill.endsWith("\n"));
  assert.deepEqual(rules.logRow({ at: 5, app: "Codex", route: "say", ok: true }), { at: 5, app: "Codex", route: "say", ok: true });
  assert.deepEqual(rules.logRow({ at: 5, app: "", route: "task", ok: false, note: "filed" }), { at: 5, app: "An app", route: "task", ok: false, note: "filed" });
  assert.equal(rules.helloReply({ version: "0.4.5", project: "Quillfold" }).text, "Mefi's Studio AI+ 0.4.5 is here, with Quillfold open.");
  assert.equal(rules.helloReply({ version: "0.4.5" }).data.routes.length, rules.ROUTES.length);
});
