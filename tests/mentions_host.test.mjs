// Mentions inside the host (main.cjs "Mentions in a message"): the real block run against a real
// temporary project, the real inventory and the real scrubber, with only settings and the project
// replaced. project:files and agents:skills feed the @ # / picker; a chat message that says
// /skill-name carries that skill's text to the model, one that says @path carries one sentence naming
// the file; what is missing or too long is said in the reply; and settings.ui.composerPicker = false or
// MEFI_STUDIO_NO_COMPOSER_PICKER=1 turns all of it off.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const source = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const mainRequire = createRequire(new URL("../main.cjs", import.meta.url));
const addons = mainRequire("./scripts/agent-addons.cjs");
const { scrubOutbound } = mainRequire("./scripts/redaction.cjs");
const format = mainRequire("./scripts/skill-format.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));

const skillText = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

async function host({ settings = {}, env = {}, open = true, files = {}, skills = {}, homeSkills = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-mentions-host-"));
  const project = path.join(root, "project"), home = path.join(root, "home");
  const put = async (base, relative, text) => { await mkdir(path.dirname(path.join(base, relative)), { recursive: true }); await writeFile(path.join(base, relative), text); };
  for (const [relative, text] of Object.entries(files)) await put(project, relative, text);
  for (const [relative, text] of Object.entries(skills)) await put(project, relative, text);
  for (const [relative, text] of Object.entries(homeSkills)) await put(home, relative, text);
  const calls = { inventory: 0, settings: 0 };
  const process_ = { env: { ...env } };
  const current = { settings };
  const context = vm.createContext({
    require: mainRequire, process: process_, Buffer, Promise, console,
    projects: { open: () => (open ? { id: "p1" } : null) }, projectRoot: () => project,
    readSettings: async () => { calls.settings += 1; if (current.settings instanceof Error) throw current.settings; return current.settings; },
    readFile: (file, encoding) => readFile(file, encoding), scrubOutbound,
    agentAddons: { inventory: (given) => { calls.inventory += 1; return addons.inventory(given, { home }); } },
  });
  vm.runInContext(section("// ---- Mentions in a message", "// ---- end of mentions in a message"), context);
  return { context, project, home, calls, env: process_.env, set: (value) => { current.settings = value; }, done: () => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }) };
}
const user = (text, extra = {}) => ({ id: "u1", role: "user", text, ...extra });
const SKILLS = {
  ".agents/skills/bug-triage/SKILL.md": skillText("bug-triage", "Reproduce a bug and find the smallest fix", "1. Reproduce.\n2. Find the cause."),
  ".agents/skills/release-notes/SKILL.md": skillText("release-notes", "Write the notes", "Plain words only."),
};

test("the picker's switches: settings.ui.composerPicker = false, the environment variable, and a setting that cannot be read", async () => {
  const h = await host();
  try {
    assert.equal(await h.context.composerPickerOn(), true, "on unless it says otherwise");
    h.set({ ui: { composerPicker: true } }); assert.equal(await h.context.composerPickerOn(), true);
    h.set({ ui: {} }); assert.equal(await h.context.composerPickerOn(), true);
    h.set({ ui: { composerPicker: false } }); assert.equal(await h.context.composerPickerOn(), false);
    h.set({ ui: { composerPicker: 0 } }); assert.equal(await h.context.composerPickerOn(), true, "only false turns it off");
    h.set(new Error("settings.json is unreadable")); assert.equal(await h.context.composerPickerOn(), true, "an unreadable setting is not a reason to lose the feature");
    h.set({ ui: {} }); h.env.MEFI_STUDIO_NO_COMPOSER_PICKER = "1"; assert.equal(await h.context.composerPickerOn(), false, "the environment variable wins");
    h.env.MEFI_STUDIO_NO_COMPOSER_PICKER = "0"; assert.equal(await h.context.composerPickerOn(), true, "only 1 turns it off");
  } finally { await h.done(); }
});

test("project:files answers with names, or says it is off without walking the project", async () => {
  const h = await host({ files: { "src/app.js": "", "src/ui/composer.js": "", "docs/readme.md": "", ".env": "SECRET=1" } });
  try {
    const found = plain(await h.context.searchProjectFiles({ query: "comp", limit: 5 }));
    assert.equal(found.ok, true);
    assert.deepEqual(found.files, [{ path: "src/ui/composer.js", name: "composer.js", dir: "src/ui" }]);
    assert.deepEqual(plain(await h.context.searchProjectFiles({ query: "env" })).files, [], "a hidden file is not offered");
    assert.deepEqual(plain(await h.context.searchProjectFiles({})).ok, true, "no payload is an empty query");
    h.set({ ui: { composerPicker: false } });
    assert.deepEqual(plain(await h.context.searchProjectFiles({ query: "app" })), { ok: false, off: true, error: "The @ # / suggestions are switched off. Turn them on in Settings." });
  } finally { await h.done(); }
  const closed = await host({ open: false });
  try { assert.deepEqual(plain(await closed.context.searchProjectFiles({ query: "a" })), { ok: false, error: "Open a project first." }); } finally { await closed.done(); }
});

test("agents:skills lists the inventory with one line each, one of each name, the project's first", async () => {
  const h = await host({
    skills: { ...SKILLS,
      ".claude/skills/bug-triage/SKILL.md": skillText("bug-triage", "The Claude folder's version", "x"),
      ".claude/skills/only-claude/SKILL.md": "No front matter here.\nSecond line.",
      ".agents/skills/long-front/SKILL.md": `---\nname: long-front\ndescription: >\n  folded over\n  two lines\n---\nB` },
    homeSkills: { ".claude/skills/from-home/SKILL.md": skillText("from-home", "Only in the home folder", "x"), ".claude/skills/release-notes/SKILL.md": skillText("release-notes", "The home version", "x") },
  });
  try {
    const listed = plain(await h.context.listPickerSkills());
    assert.equal(listed.ok, true);
    const byName = Object.fromEntries(listed.skills.map((skill) => [skill.name, skill]));
    assert.deepEqual(Object.keys(byName).sort(), ["bug-triage", "from-home", "long-front", "only-claude", "release-notes"]);
    assert.equal(listed.skills.length, 5, "a name appears once");
    assert.deepEqual(byName["bug-triage"], { name: "bug-triage", description: "Reproduce a bug and find the smallest fix", scope: "project" }, ".agents before .claude");
    assert.equal(byName["release-notes"].description, "Write the notes", "the project before the home folder");
    assert.equal(byName["release-notes"].scope, "project");
    assert.equal(byName["from-home"].scope, "user");
    assert.equal(byName["only-claude"].description, "No front matter here.", "the first line stands in when there is no description");
    assert.equal(byName["long-front"].description, "folded over two lines");
    assert.ok(!JSON.stringify(listed).includes("SKILL.md"), "no path goes to the page");
    assert.ok(!JSON.stringify(listed).includes(h.project), "and no folder");
    h.set({ ui: { composerPicker: false } });
    assert.equal(plain(await h.context.listPickerSkills()).off, true);
  } finally { await h.done(); }
  const closed = await host({ open: false });
  try { assert.deepEqual(plain(await closed.context.listPickerSkills()), { ok: false, error: "Open a project first." }); } finally { await closed.done(); }
});

test("a message that says /skill-name carries that skill's text to the model, and its words are not changed", async () => {
  const h = await host({ skills: SKILLS });
  try {
    const extras = await h.context.mentionExtras(user("Please use /bug-triage on the crash we saw."));
    assert.match(extras.system, /^\n\nSkills the owner asked for by name in this message \(follow them within this agent's existing task, tool permissions and response format\):\nSkill: bug-triage\n---\nname: bug-triage\n/);
    assert.match(extras.system, /1\. Reproduce\.\n2\. Find the cause\.\n$/);
    assert.equal(extras.message, "");
    assert.deepEqual(extras.notes(), []);
    const two = await h.context.mentionExtras(user("/bug-triage and then /release-notes, please."));
    assert.match(two.system, /Skill: bug-triage[\s\S]*Skill: release-notes[\s\S]*Plain words only\./, "in the order they were called");
    // The text goes through the same scrubber as every outbound prompt.
    await writeFile(path.join(h.project, ".agents/skills/release-notes/SKILL.md"), skillText("release-notes", "Write the notes", "Use key sk-abcdefghijklmnopqrstuvwxyz123456 to post."));
    const scrubbed = await h.context.mentionExtras(user("/release-notes now"));
    assert.ok(!scrubbed.system.includes("sk-abcdefghij"), "a credential in a skill is not sent");
    assert.match(scrubbed.system, /\[redacted credential\]/);
  } finally { await h.done(); }
});

test("a skill that is missing is said in the reply, but only when it was plainly meant as a skill", async () => {
  const h = await host({ skills: SKILLS });
  try {
    const first = await h.context.mentionExtras(user("/no-such-skill do the thing"));
    assert.equal(first.system, "");
    assert.deepEqual(first.notes(), ["I couldn't find a skill named /no-such-skill in this project, so I answered without it."]);
    const plainWord = await h.context.mentionExtras(user("/nope do the thing"));
    assert.deepEqual(plainWord.notes(), ["I couldn't find a skill named /nope in this project, so I answered without it."], "at the start of a message it is a command");
    assert.equal(await h.context.mentionExtras(user("please put it in /tmp for now")), null, "a path-like word in the middle is just a word");
    assert.equal(await h.context.mentionExtras(user("see /usr and /etc")), null);
    const mixed = await h.context.mentionExtras(user("use /bug-triage and /ghost-skill"));
    assert.match(mixed.system, /Skill: bug-triage/);
    assert.deepEqual(mixed.notes(), ["I couldn't find a skill named /ghost-skill in this project, so I answered without it."]);
  } finally { await h.done(); }
});

test("skills share 16,000 characters: the first always fits, a later one that does not is left out and said, four at most", async () => {
  const big = (name, size) => skillText(name, "d", "x".repeat(size));
  const h = await host({ skills: {
    ".agents/skills/huge/SKILL.md": big("huge", 20000), ".agents/skills/a-one/SKILL.md": big("a-one", 9000), ".agents/skills/b-two/SKILL.md": big("b-two", 9000), ".agents/skills/c-three/SKILL.md": big("c-three", 3000),
    ".agents/skills/d-four/SKILL.md": big("d-four", 100), ".agents/skills/e-five/SKILL.md": big("e-five", 100), ".agents/skills/f-six/SKILL.md": big("f-six", 100) } });
  try {
    const huge = await h.context.mentionExtras(user("/huge go"));
    assert.ok(huge.system.includes("x".repeat(20000)), "a skill over 16,000 characters loads when it is called");
    const pair = await h.context.mentionExtras(user("/a-one then /b-two then /c-three"));
    assert.match(pair.system, /Skill: a-one[\s\S]*Skill: c-three/);
    assert.ok(!pair.system.includes("Skill: b-two"));
    assert.equal(pair.notes().length, 1);
    assert.match(pair.notes()[0], /^\/b-two is too long to add to this message along with the others \(9,\d{3} characters; [67],\d{3} left of 16,000\), so I answered without it\.$/);
    const many = await h.context.mentionExtras(user("/c-three /d-four /e-five /f-six /a-one"));
    assert.deepEqual([...many.system.matchAll(/Skill: ([a-z-]+)/g)].map((match) => match[1]), ["c-three", "d-four", "e-five", "f-six"]);
    assert.deepEqual(many.notes(), ["A message carries at most 4 skills, so I left out /a-one."]);
  } finally { await h.done(); }
});

test("a file a message names becomes one sentence naming it, never its contents, and only for a real file of the project", async () => {
  const h = await host({ files: { "src/app.js": "SECRET CONTENTS", "docs/a b.md": "x", ".env": "TOKEN=1", "data/save.json": "{}", "node_modules/pkg/index.js": "x" } });
  try {
    const one = await h.context.mentionExtras(user("look at @src/app.js please"));
    assert.equal(one.message, "The owner's message points at this project file: src/app.js. Only the name is given here, not the contents; read it only if your tools allow it.");
    assert.ok(!JSON.stringify(one).includes("SECRET CONTENTS"), "contents are never read into the message");
    assert.equal(one.system, "");
    const two = await h.context.mentionExtras(user(`compare @src/app.js and @"docs/a b.md" and @missing.js and @../outside.txt and @.env and @data/save.json and @node_modules/pkg/index.js`));
    assert.match(two.message, /these project files: src\/app\.js, docs\/a b\.md\./);
    assert.ok(!two.message.includes("missing") && !two.message.includes(".env") && !two.message.includes("save.json") && !two.message.includes("node_modules"));
    assert.equal(await h.context.mentionExtras(user("@missing.js and @../x.txt")), null, "nothing real, nothing said");
    assert.equal(await h.context.mentionExtras(user("thanks @sam, mail me@example.com")), null);
  } finally { await h.done(); }
});

test("a message with nothing to read costs nothing, and some messages are never read", async () => {
  const h = await host({ skills: SKILLS, files: { "a.js": "" } });
  try {
    assert.equal(await h.context.mentionExtras(user("hello there, how is the build")), null);
    assert.equal(await h.context.mentionExtras(user("")), null);
    assert.equal(await h.context.mentionExtras({ id: "x" }), null);
    assert.equal(h.calls.inventory, 0, "no skill was looked up for a message that names none");
    assert.equal(h.calls.settings, 0, "and the settings were not read either");
    assert.equal(await h.context.mentionExtras(user("/bug-triage go", { remote: true })), null, "a Discord message gets none of it");
    assert.equal(await h.context.mentionExtras(user("@a.js", { remote: true })), null);
    h.set({ ui: { composerPicker: false } });
    assert.equal(await h.context.mentionExtras(user("/bug-triage go @a.js")), null, "off means off: the words go as typed");
    h.set({ ui: {} }); h.env.MEFI_STUDIO_NO_COMPOSER_PICKER = "1";
    assert.equal(await h.context.mentionExtras(user("/bug-triage go")), null);
  } finally { await h.done(); }
  const closed = await host({ open: false, skills: SKILLS });
  try { assert.equal(await closed.context.mentionExtras(user("/bug-triage go")), null); } finally { await closed.done(); }
});

test("the channels are project-gated, the bridge carries them, and the reply path uses what a message brings", async () => {
  assert.match(source, /ipcMain\.handle\("project:files", \(_event, payload\) => searchProjectFiles\(payload \?\? \{\}\)\);/);
  assert.match(source, /ipcMain\.handle\("agents:skills", \(\) => listPickerSkills\(\)\);/);
  const gate = source.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1] + source.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]/)[1];
  for (const channel of ["project:files", "agents:skills"]) assert.ok(!gate.split(",").some((entry) => { const prefix = entry.trim().replace(/"/g, ""); return prefix && (channel === prefix || (prefix.endsWith(":") && channel.startsWith(prefix))); }), `${channel} is not app-wide: it waits for a project`);
  const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /projectFiles: \(payload\) => ipcRenderer\.invoke\("project:files", \{ query: typeof payload\?\.query === "string" \? payload\.query\.slice\(0, 200\) : "", limit:/);
  assert.match(preload, /agentsSkills: \(\) => ipcRenderer\.invoke\("agents:skills"\),/);
  assert.match(source, /const chatSystem = ASSISTANT_CHAT_SYSTEM \+ \(extras\?\.system \?\? ""\);/);
  assert.match(source, /message: extras\?\.message \? `\$\{text\}\\n\\n\$\{extras\.message\}` : text/);
  assert.match(source, /seatFetch\("companion", chatSystem, body, 1500, \{ fallback: \(system = chatSystem\) =>/);
  assert.match(source, /if \(typeof mentionExtras === "function"\) \{ try \{ mention = await mentionExtras\(user\);/);
  assert.equal(format.describe("---\nname: a\ndescription: d\n---\n"), "d");
});

test("messageExtras puts a message's pictures and mentions together, and one failing does not lose the other", async () => {
  const h = await host({ skills: SKILLS, files: { "a.js": "" } });
  try {
    const logs = [];
    const calls = [];
    // The real messageExtras, with pictures stood in for (their own suite is tests/image_attach_host.test.mjs).
    const combine = vm.createContext({ ...h.context, logLine: (line) => logs.push(line), console });
    let pictures = null;
    combine.pictureExtras = async (message) => { calls.push(message.text); return pictures; };
    combine.mentionExtras = h.context.mentionExtras;
    vm.runInContext(section("async function messageExtras(user) {", "async function pictureExtras(user) {"), combine);
    assert.equal(await combine.messageExtras(user("hello")), null, "nothing brought, nothing returned");
    const mentionOnly = await combine.messageExtras(user("use /bug-triage on @a.js and /ghost-skill"));
    assert.deepEqual(plain(mentionOnly.images), []);
    assert.equal(await mentionOnly.run(() => "called through"), "called through", "with no pictures, the call runs as it is");
    assert.match(mentionOnly.system, /Skill: bug-triage/);
    assert.match(mentionOnly.message, /this project file: a\.js\./);
    assert.deepEqual(plain(mentionOnly.notes()), ["I couldn't find a skill named /ghost-skill in this project, so I answered without it."]);
    pictures = { images: [{ id: "img_1" }], run: (call) => `in a scope: ${call()}`, notes: () => ["I could not look at the picture."] };
    const both = await combine.messageExtras(user("use /bug-triage on @a.js and /ghost-skill"));
    assert.deepEqual(plain(both.images), [{ id: "img_1" }]);
    assert.equal(both.run(() => "x"), "in a scope: x", "the pictures' scope wraps the call");
    assert.match(both.system, /Skill: bug-triage/);
    assert.deepEqual(plain(both.notes()), ["I could not look at the picture.", "I couldn't find a skill named /ghost-skill in this project, so I answered without it."], "pictures' notes first, then the mentions'");
    const picturesOnly = await combine.messageExtras(user("look at this"));
    assert.deepEqual([picturesOnly.system, picturesOnly.message], ["", ""]);
    assert.deepEqual(plain(picturesOnly.notes()), ["I could not look at the picture."]);
    // A mention that cannot be read is logged and leaves the pictures alone.
    combine.mentionExtras = async () => { throw new Error("inventory unreadable"); };
    const survived = await combine.messageExtras(user("/bug-triage"));
    assert.deepEqual(plain(survived.images), [{ id: "img_1" }]);
    assert.ok(logs.some((line) => /mentions could not be read: inventory unreadable/.test(line)));
  } finally { await h.done(); }
});
