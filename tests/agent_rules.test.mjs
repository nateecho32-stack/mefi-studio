// Project rules (ZA8): the text the owner writes for a project, the two file
// switches, the block every prompt of a role on Studio's own models gets, and
// the team field they are stored in. Pure checks first, then the two project
// files read from real temp folders, then the team's inherit / save / preset
// rules. main.cjs's call sites are held in tests/agent_rules_host.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rules = require("../scripts/agent-rules.cjs");
const addons = require("../scripts/agent-addons.cjs");
const profiles = require("../scripts/agent-profiles.cjs");
const habits = require("../scripts/habits.cjs");

const ROLES = ["routine", "heavy", "companion", "scout", "overseer", "lead", "desk", "builder"];
async function project(fn) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temp, "mefi-rules-test-"));
  try { await fn(root); } finally { assert.equal(path.dirname(root), temp); await rm(root, { recursive: true, force: true }); }
}
async function withoutKillSwitch(fn) {
  const before = process.env.MEFI_STUDIO_NO_AGENT_RULES;
  delete process.env.MEFI_STUDIO_NO_AGENT_RULES;
  try { await fn(); } finally { if (before === undefined) delete process.env.MEFI_STUDIO_NO_AGENT_RULES; else process.env.MEFI_STUDIO_NO_AGENT_RULES = before; }
}
const RULES = { text: "Run `npm run check` before you say a task is done.", agents: true, claude: true };

// ---- the rules themselves ------------------------------------------------------

test("the limit is 4,000 characters: at the limit is fine, one over is refused with the words, and nothing is ever cut", () => {
  assert.equal(rules.LIMIT, 4000);
  assert.equal(rules.validate({ text: "a".repeat(4000) }), null);
  const refusal = rules.validate({ text: "a".repeat(4001) });
  assert.match(refusal, /4,001 characters and the limit is 4,000\. Nothing was cut\. Trim it/);
  assert.match(refusal, /move the detail into AGENTS\.md/);
  // A refused text is never stored shortened: there is no stored form at all.
  assert.equal(rules.normalize({ text: "a".repeat(4001) }), null);
  // A text that fits comes back whole, however long its lines are.
  const long = `${"word ".repeat(790)}end`;
  assert.equal(rules.normalize({ text: long }).text, long);
});

test("a CRLF is one line break: the count and the stored text are the text box's, not the file's", () => {
  // 1,999 lines of "a" + CRLF is 3,998 characters as typed, 5,997 if a CR were counted.
  const typed = "a\r\n".repeat(1999);
  assert.equal(rules.validate({ text: typed }), null);
  assert.equal(rules.normalize({ text: "one\r\ntwo\rthree\n" }).text, "one\ntwo\nthree");
  // 2,000 CRLF lines is 4,000 characters once, 6,000 if counted as written.
  assert.equal(rules.validate({ text: "b\r\n".repeat(2000) }), null);
  assert.ok(rules.validate({ text: "b\r\n".repeat(2001) }));
});

test("types and shapes: a text and two switches, nothing else, no invisible controls", () => {
  assert.equal(rules.validate({}), null, "an empty rules object is valid (and stores nothing)");
  assert.equal(rules.validate({ text: "Use LÖVE 11.5.\nTabs\tare fine.", agents: true, claude: false }), null);
  for (const value of [null, undefined, "text", 4, [], [{ text: "x" }]]) assert.match(rules.validate(value), /text and two file switches/, String(value));
  assert.match(rules.validate({ text: 5 }), /must be text/);
  assert.match(rules.validate({ text: {} }), /must be text/);
  assert.match(rules.validate({ agents: "yes" }), /AGENTS\.md must be on or off/);
  assert.match(rules.validate({ claude: 1 }), /CLAUDE\.md must be on or off/);
  assert.match(rules.validate({ text: "ok", extra: true }), /Unknown rules setting: extra/);
  assert.match(rules.validate(JSON.parse('{"__proto__": {"x": 1}}')), /Unknown rules setting/);
  for (const bad of ["a\u0000b", "a\u001bb", "a\u007fb", "a\u202eb", "a\u2066b"]) assert.match(rules.validate({ text: bad }), /control or direction/, JSON.stringify(bad));
  assert.equal(rules.validate({ text: "line\nbreak\r\nand\ttab" }), null);
});

test("nothing to say stores nothing; what is said is stored in the text box's form", () => {
  assert.equal(rules.normalize({ text: "", agents: false, claude: false }), null);
  assert.equal(rules.normalize({ text: "  \n\n" }), null);
  assert.equal(rules.normalize(undefined), null);
  assert.deepEqual(rules.normalize({ text: "", agents: true }), { text: "", agents: true, claude: false }, "a switch alone is something");
  assert.deepEqual(rules.normalize({ text: "Keep it short.\n\n", claude: true }), { text: "Keep it short.", agents: false, claude: true });
  // The text keeps its leading space and inner blank lines: only the end is trimmed.
  assert.equal(rules.normalize({ text: "  indented\n\nnext\n" }).text, "  indented\n\nnext");
});

test("the cost is four characters a token, rounded up, and is the block's own length", () => {
  assert.equal(rules.tokens(""), 0);
  assert.equal(rules.tokens("abcd"), 1);
  assert.equal(rules.tokens("abcde"), 2);
  const files = { agents: { text: "x".repeat(1000), bytes: 1000 } };
  const cost = rules.cost(RULES, { role: "lead", files });
  assert.equal(cost.chars, rules.block(RULES, { role: "lead", files }).length);
  assert.equal(cost.tokens, Math.ceil(cost.chars / 4));
  // A screen counts a draft as overhead + content per section, and agrees with the prompt.
  const over = rules.overhead();
  const estimate = over.text + RULES.text.length + over.agents + rules.used("agents", files.agents);
  assert.equal(estimate, cost.chars);
  assert.deepEqual(rules.cost({ text: "", agents: false }, { role: "lead" }), { chars: 0, tokens: 0 });
});

test("the block has a clear heading, holds only what is switched on and read, and names no file it did not send", () => {
  const files = { agents: { text: "Agent notes.\r\n", bytes: 14 }, claude: { text: "Claude notes.", bytes: 13 } };
  const both = rules.block(RULES, { role: "lead", files });
  assert.match(both, /^\n\nProject rules the owner wrote for this project \(follow them within this agent's task, tool permissions and response format\):\nRun `npm run check`/);
  assert.match(both, /\n\nProject file AGENTS\.md \(the project's own agent notes, read fresh for this request\):\nAgent notes\.$|\nAgent notes\.\n\nProject file CLAUDE\.md/);
  assert.ok(both.indexOf("AGENTS.md") < both.indexOf("CLAUDE.md"), "the order is fixed: text, AGENTS.md, CLAUDE.md");
  assert.doesNotMatch(both, /\r/);
  // Switches off: the files are not in it even though they were read.
  const textOnly = rules.block({ ...RULES, agents: false, claude: false }, { role: "lead", files });
  assert.doesNotMatch(textOnly, /AGENTS\.md|CLAUDE\.md|notes/);
  // Only a file: no owner's text section.
  const fileOnly = rules.block({ text: "", agents: true, claude: false }, { role: "lead", files });
  assert.doesNotMatch(fileOnly, /Project rules the owner wrote/);
  assert.match(fileOnly, /Agent notes\./);
  // A switch on for a file that is missing or empty adds nothing, and does not throw.
  assert.equal(rules.block({ text: "", agents: true }, { role: "lead", files: { agents: { found: false } } }), "");
  assert.equal(rules.block({ text: "", agents: true }, { role: "lead", files: { agents: { text: " \n" } } }), "");
  assert.equal(rules.block(undefined, { role: "lead" }), "");
});

test("a CLAUDE.md that repeats AGENTS.md is sent once, and a different one is not", () => {
  const same = { agents: { text: "Same notes.", bytes: 11 }, claude: { text: "Same notes.\r\n", bytes: 13 } };
  const once = rules.block({ text: "", agents: true, claude: true }, { role: "lead", files: same });
  assert.equal(once.split("Same notes.").length, 2);
  assert.match(once, /AGENTS\.md/);
  assert.doesNotMatch(once, /CLAUDE\.md/);
  // With AGENTS.md switched off, CLAUDE.md is the only copy and goes.
  assert.match(rules.block({ text: "", agents: false, claude: true }, { role: "lead", files: same }), /CLAUDE\.md/);
  const differ = rules.block({ text: "", agents: true, claude: true }, { role: "lead", files: { ...same, claude: { text: "Other notes." } } });
  assert.match(differ, /AGENTS\.md[\s\S]*CLAUDE\.md/);
});

test("a file cut at the cap says so at its end, with how much is there", () => {
  const files = { agents: { text: "x".repeat(7000), bytes: 65432, capped: true } };
  const block = rules.block({ text: "", agents: true }, { role: "lead", files });
  assert.match(block, /\[Only the first 7,000 characters of AGENTS\.md \(63\.9 KB\) are included here\.\]$/);
  assert.equal(rules.used("agents", files.agents), 7000 + block.split("\n[Only")[1].length + "\n[Only".length);
  const whole = rules.block({ text: "", agents: true }, { role: "lead", files: { agents: { text: "x".repeat(7000), bytes: 7000, capped: false } } });
  assert.doesNotMatch(whole, /\[Only/);
});

test("who receives what: every role gets the files, except a builder on a CLI that reads them itself; the list is that table", () => {
  for (const role of ROLES) for (const cli of [undefined, "opencode", "claude", "codex", "grok", "antigravity"]) {
    const expected = !(role === "builder" && ["opencode", "claude", "codex"].includes(cli));
    assert.equal(rules.deliversFiles(role, cli), expected, `${role} on ${cli}`);
  }
  // The "Who reads what" rows are generated from the same table: for every role
  // and CLI the row that names them says what deliversFiles does.
  const rows = rules.readers();
  for (const role of ROLES) {
    const clis = role === "builder" ? ["opencode", "claude", "codex", "grok", "antigravity"] : [undefined];
    for (const cli of clis) {
      const row = rows.find((item) => item.roles.includes(role) && (!item.clis || item.clis.includes(cli)));
      assert.ok(row, `${role} on ${cli} is in the list`);
      assert.equal(row.files, rules.deliversFiles(role, cli), `${row.title} for ${role} on ${cli}`);
    }
  }
  assert.equal(new Set(rows.flatMap((row) => row.roles.map((role) => `${role}/${(row.clis || [""]).join(",")}`))).size, rows.reduce((sum, row) => sum + row.roles.length, 0), "no role is listed twice");
  // The list is a copy: a caller cannot change what the next one gets.
  rules.readers()[0].roles.push("hacked"); assert.equal(rules.readers()[0].roles.includes("hacked"), false);
});

// ---- the two project files, read for a prompt ------------------------------------

test("the files are read fresh for every prompt: a missing one is nothing, an edit shows at once", () => withoutKillSwitch(() => project(async (root) => {
  const settings = { agentRules: RULES };
  // No AGENTS.md, no CLAUDE.md: the owner's text only, and no error.
  const bare = await addons.instructions(root, settings, "lead");
  assert.match(bare, /Run `npm run check`/);
  assert.doesNotMatch(bare, /Project file/);
  await writeFile(path.join(root, "AGENTS.md"), "First notes.\n");
  assert.match(await addons.instructions(root, settings, "lead"), /Project file AGENTS\.md[^\n]*\nFirst notes\./);
  await writeFile(path.join(root, "AGENTS.md"), "Second notes.\n");
  const again = await addons.instructions(root, settings, "lead");
  assert.match(again, /Second notes\./); assert.doesNotMatch(again, /First notes/);
  // CLAUDE.md alone, with the AGENTS.md switch off.
  await writeFile(path.join(root, "CLAUDE.md"), "Claude only.\n");
  const claudeOnly = await addons.instructions(root, { agentRules: { text: "", agents: false, claude: true } }, "lead");
  assert.match(claudeOnly, /Project file CLAUDE\.md/); assert.doesNotMatch(claudeOnly, /AGENTS\.md|Second notes/);
  // A folder or a missing root is not a file and not a failure.
  await rm(path.join(root, "AGENTS.md")); await mkdir(path.join(root, "AGENTS.md"));
  assert.doesNotMatch(await addons.instructions(root, settings, "lead"), /Project file AGENTS\.md/);
  assert.match(await addons.instructions(path.join(root, "gone"), settings, "lead"), /Run `npm run check`/);
  assert.match(await addons.instructions(null, settings, "lead"), /Run `npm run check`/);
})));

test("CRLF, a byte order mark and a huge file: line endings are LF, and a file is read to a cap and says so", () => withoutKillSwitch(() => project(async (root) => {
  await writeFile(path.join(root, "AGENTS.md"), "﻿Use tabs.\r\nNo trailing spaces.\r\n");
  const text = await addons.instructions(root, { agentRules: { text: "", agents: true } }, "desk");
  assert.match(text, /\nUse tabs\.\nNo trailing spaces\.$/);
  assert.doesNotMatch(text, /\r|﻿/);
  // 300 KB of lines: read to the cap only, cut at a line end, with the marker.
  const big = Array.from({ length: 30000 }, (_, index) => `rule number ${index}`).join("\n");
  await writeFile(path.join(root, "AGENTS.md"), big);
  const read = await addons.readRuleFile(root, "AGENTS.md");
  assert.equal(read.capped, true);
  assert.equal(read.bytes, Buffer.byteLength(big));
  assert.ok(read.text.length <= rules.FILE_CAP && read.text.length > rules.FILE_CAP * 0.75, `cut near the cap, not at a tenth of it (${read.text.length})`);
  assert.match(read.text, /rule number \d+$/, "cut at a line end, not inside a rule");
  const capped = await addons.instructions(root, { agentRules: { text: "", agents: true } }, "desk");
  assert.ok(capped.length < rules.FILE_CAP + 400, `bounded (${capped.length})`);
  assert.match(capped, /\[Only the first [\d,]+ characters of AGENTS\.md \(\d+\.\d KB\) are included here\.\]$/);
  // Multi-byte text is cut by characters, never in the middle of one.
  await writeFile(path.join(root, "AGENTS.md"), "😀".repeat(20000));
  const emoji = await addons.readRuleFile(root, "AGENTS.md");
  assert.equal(emoji.capped, true); assert.ok(emoji.text.length <= rules.FILE_CAP);
  assert.equal(emoji.text.includes("�"), false);
  assert.equal(/[\ud800-\udbff]$/.test(emoji.text), false, "no half of a surrogate pair");
})));

test("a binary file, a link out of the project and a link inside it", async (t) => withoutKillSwitch(() => project(async (root) => {
  const settings = { agentRules: { text: "", agents: true, claude: true } };
  await writeFile(path.join(root, "AGENTS.md"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
  const binary = await addons.readRuleFile(root, "AGENTS.md");
  assert.equal(binary.problem, "binary"); assert.equal(binary.text, undefined);
  assert.equal(await addons.instructions(root, settings, "lead"), "", "a binary file adds nothing");
  await rm(path.join(root, "AGENTS.md"));
  const outside = await mkdtemp(path.join(await realpath(tmpdir()), "mefi-rules-outside-"));
  try {
    await writeFile(path.join(outside, "secret.md"), "OUTSIDE SECRET");
    try { await symlink(path.join(outside, "secret.md"), path.join(root, "AGENTS.md")); } catch { t.skip("this account cannot create symlinks"); return; }
    const refused = await addons.readRuleFile(root, "AGENTS.md");
    assert.equal(refused.problem, "outside"); assert.equal(refused.text, undefined);
    assert.doesNotMatch(await addons.instructions(root, settings, "lead"), /OUTSIDE SECRET/);
    await rm(path.join(root, "AGENTS.md"));
    // A link to a file inside the project is followed, and a CLAUDE.md that links AGENTS.md is sent once.
    await writeFile(path.join(root, "NOTES.md"), "Shared notes.");
    await symlink(path.join(root, "NOTES.md"), path.join(root, "AGENTS.md"));
    await symlink(path.join(root, "NOTES.md"), path.join(root, "CLAUDE.md"));
    const text = await addons.instructions(root, settings, "lead");
    assert.equal(text.split("Shared notes.").length, 2);
  } finally { await rm(outside, { recursive: true, force: true }); }
})));

test("what the card shows: both files are read whatever the switches say, and the Studio defaults read none", () => withoutKillSwitch(() => project(async (root) => {
  await writeFile(path.join(root, "AGENTS.md"), "x".repeat(1840));
  await writeFile(path.join(root, "CLAUDE.md"), "x".repeat(1840));
  const state = await addons.rulesState(root);
  assert.equal(state.limit, 4000); assert.equal(state.fileCap, 8000); assert.equal(state.disabled, false);
  assert.deepEqual(Object.keys(state.files), ["agents", "claude"]);
  assert.equal(state.files.agents.found, true); assert.equal(state.files.agents.bytes, 1840);
  assert.equal(state.files.agents.used, 1840); assert.equal(state.files.agents.same, null);
  assert.equal(state.files.claude.same, "agents", "identical text is counted once");
  assert.deepEqual(state.overhead, rules.overhead());
  assert.deepEqual(state.readers, rules.readers());
  assert.equal((await addons.rulesState(root, { files: false })).files, null);
  assert.equal((await addons.rulesState(null)).files, null);
  const none = await addons.rulesState(path.join(root, "gone"));
  assert.deepEqual([none.files.agents.found, none.files.claude.found], [false, false], "a folder that is not there has neither file, and is not an error");
  await rm(path.join(root, "CLAUDE.md"));
  assert.equal((await addons.rulesState(root)).files.claude.found, false);
})));

// ---- every role's prompt -----------------------------------------------------------

test("every role on Studio's own models gets the text and the files; a builder on a CLI that reads them gets the text only", () => withoutKillSwitch(() => project(async (root) => {
  await writeFile(path.join(root, "AGENTS.md"), "AGENTS-FILE-CONTENT");
  await writeFile(path.join(root, "CLAUDE.md"), "CLAUDE-FILE-CONTENT");
  for (const role of ["routine", "heavy", "companion", "scout", "overseer", "lead", "desk"]) {
    const text = await addons.instructions(root, { agentRules: RULES }, role);
    assert.match(text, /Run `npm run check`/, role);
    assert.match(text, /AGENTS-FILE-CONTENT/, role); assert.match(text, /CLAUDE-FILE-CONTENT/, role);
  }
  for (const cli of ["opencode", "claude", "codex"]) {
    const text = await addons.instructions(root, { agentRules: RULES }, "builder", { cli });
    assert.match(text, /Run `npm run check`/, cli);
    assert.doesNotMatch(text, /AGENTS-FILE-CONTENT|CLAUDE-FILE-CONTENT|Project file/, cli);
  }
  for (const options of [{ cli: "grok" }, { cli: "antigravity" }, {}, undefined]) {
    const text = await addons.instructions(root, { agentRules: RULES }, "builder", options);
    assert.match(text, /AGENTS-FILE-CONTENT/, JSON.stringify(options)); assert.match(text, /CLAUDE-FILE-CONTENT/);
  }
  // Nothing set, nothing sent, for every role.
  for (const role of ROLES) assert.equal(await addons.instructions(root, {}, role), "", role);
  assert.equal(await addons.instructions(root, { agentRules: { text: "", agents: false, claude: false } }, "lead"), "");
  // A stored value that is not valid rules (a hand-edited settings file) sends nothing and does not throw.
  for (const bad of ["text", 7, [], { text: "a".repeat(4001) }, { text: 5 }, { agents: "yes" }]) assert.equal(await addons.instructions(root, { agentRules: bad }, "lead"), "", JSON.stringify(bad).slice(0, 30));
})));

test("the rules come first, then the skills, then the habits, and each is there once", () => withoutKillSwitch(() => project(async (root) => {
  await mkdir(path.join(root, ".agents", "skills", "testing"), { recursive: true });
  await writeFile(path.join(root, ".agents", "skills", "testing", "SKILL.md"), "SKILL-BODY");
  const [skill] = await addons.catalog(root, { home: null });
  const settings = { agentRules: { text: "RULE-TEXT" }, agentSkills: { lead: [skill.id] }, agentHabits: { lead: { "small-steps": { variant: "small", mode: "brief" } } } };
  const text = await addons.instructions(root, settings, "lead", { home: null });
  const at = (needle) => { assert.equal(text.split(needle).length, 2, `${needle} appears once`); return text.indexOf(needle); };
  assert.ok(at("RULE-TEXT") < at("SKILL-BODY") && at("SKILL-BODY") < at("Small steps"));
  // The other blocks are exactly what they were without rules.
  assert.equal(text.slice(text.indexOf("\n\nSelected agent skills")), await addons.instructions(root, { ...settings, agentRules: undefined }, "lead", { home: null }));
  assert.equal(habits.instructions(settings.agentHabits.lead), text.slice(text.indexOf("\n\nHabits the owner set")));
})));

test("MEFI_STUDIO_NO_AGENT_RULES=1 sends no rules to any role and keeps the saved ones", () => project(async (root) => {
  await writeFile(path.join(root, "AGENTS.md"), "AGENTS-FILE-CONTENT");
  const before = process.env.MEFI_STUDIO_NO_AGENT_RULES;
  try {
    process.env.MEFI_STUDIO_NO_AGENT_RULES = "1";
    for (const role of ROLES) for (const cli of [undefined, "grok", "claude"]) assert.equal(await addons.instructions(root, { agentRules: RULES }, role, { cli }), "", `${role} on ${cli}`);
    assert.equal((await addons.rulesState(root)).disabled, true);
    // The field is only not sent: the team still holds it, valid and unchanged.
    const settings = { agentRules: RULES };
    assert.equal(profiles.validate(profiles.extract(settings)), null);
    assert.deepEqual(profiles.view(settings, "p").configuration.agentRules, RULES);
    // Any other value leaves the rules on (the switch is exactly "1").
    for (const value of ["0", "", "true", "yes"]) { process.env.MEFI_STUDIO_NO_AGENT_RULES = value; assert.match(await addons.instructions(root, { agentRules: RULES }, "lead"), /Run `npm run check`/, value); }
    delete process.env.MEFI_STUDIO_NO_AGENT_RULES;
    assert.match(await addons.instructions(root, { agentRules: RULES }, "lead"), /AGENTS-FILE-CONTENT/);
  } finally { if (before === undefined) delete process.env.MEFI_STUDIO_NO_AGENT_RULES; else process.env.MEFI_STUDIO_NO_AGENT_RULES = before; }
}));

// ---- the team field ------------------------------------------------------------------

const base = () => ({ aiProvider: "zen", aiModels: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, autopilot: { enabled: false }, zenApiKeyEncrypted: "secret" });
const revision = (settings, projectId) => profiles.view(settings, projectId).revision;
const saveRules = (settings, projectId, value, extra = {}) => profiles.mutate(settings, { action: "rules", revision: revision(settings, projectId), rules: value, ...extra }, { projectId });

test("agentRules is a team field: validated with the team, 4,000 characters of paragraphs allowed, nothing else in it", () => {
  assert.ok(profiles.FIELDS.includes("agentRules"));
  const long = `${"A rule of about sixty characters, one to a line, is the usual.\n".repeat(60)}`.slice(0, 4000);
  assert.equal(profiles.validate({ agentRules: { text: long, agents: true } }), null, "a team's other strings stop at 160 characters, the rules do not");
  assert.equal(profiles.validate({ agentRules: { text: "a".repeat(4000) } }), null);
  assert.match(profiles.validate({ agentRules: { text: "a".repeat(4001) } }), /Nothing was cut\. Trim it/);
  for (const agentRules of [null, "text", [], { text: 5 }, { agents: "on" }, { text: "x", stray: true }, { text: "a\u0000" }]) assert.ok(profiles.validate({ agentRules }), JSON.stringify(agentRules));
  // The 160-character line bound still holds for the rest of the team.
  assert.equal(profiles.validate({ agentRules: { text: "ok" }, agentSeats: { lead: { model: "x".repeat(200) } } }) === null, false);
  assert.equal(profiles.validate({ aiProvider: "zen" }), null);
});

test("saving the team refuses too-long rules whole, leaving the settings and the revision untouched", () => {
  const settings = base(), before = JSON.stringify(settings);
  const refused = profiles.mutate(settings, { action: "save", revision: 0, configuration: { agentRules: { text: "a".repeat(4001) } } }, { projectId: "a" });
  assert.equal(refused.ok, false); assert.match(refused.error, /Nothing was cut/);
  const refusedRules = saveRules(settings, "a", { text: "a".repeat(4001) });
  assert.equal(refusedRules.ok, false); assert.match(refusedRules.error, /Nothing was cut/);
  assert.equal(JSON.stringify(settings), before);
  assert.equal(saveRules(settings, "a", { text: "a".repeat(4000) }).ok, true);
});

test("a rules save changes only the rules; a project with no team gets one, a copy of the Studio defaults with them", () => {
  const settings = { ...base(), agentHabits: { lead: { "small-steps": { variant: "small", mode: "brief" } } } };
  assert.equal(profiles.view(settings, "a").inherited, true);
  const saved = saveRules(settings, "a", { text: "Use LÖVE 11.5.\r\nRun test/run-check.ps1.", agents: true, claude: false });
  assert.equal(saved.ok, true); assert.equal(saved.revision, 1); assert.equal(saved.inherited, false);
  assert.deepEqual(saved.configuration.agentRules, { text: "Use LÖVE 11.5.\nRun test/run-check.ps1.", agents: true, claude: false });
  assert.equal(saved.configuration.aiProvider, "zen", "the team it copied is the defaults'");
  assert.deepEqual(saved.configuration.agentHabits, settings.agentHabits);
  assert.equal(saved.configuration.zenApiKeyEncrypted, undefined, "no credential rides a team");
  assert.equal(settings.agentRules, undefined, "the Studio defaults are not touched");
  assert.equal(saved.name, "Project team");
  // Another project still follows the defaults and has no rules.
  assert.equal(profiles.effective(settings, "b").agentRules, undefined);
  // A second save changes the rules and nothing else, and keeps the team's name.
  profiles.mutate(settings, { action: "save", revision: 1, name: "Dungeon team", configuration: { ...saved.configuration, aiProvider: "codex" } }, { projectId: "a" });
  const again = saveRules(settings, "a", { text: "Different rules." });
  assert.equal(again.ok, true); assert.equal(again.name, "Dungeon team"); assert.equal(again.configuration.aiProvider, "codex");
  assert.deepEqual(again.configuration.agentRules, { text: "Different rules.", agents: false, claude: false });
  assert.equal(again.revision, 3);
});

test("a stale rules save is refused and changes nothing, like any team save", () => {
  const settings = base();
  assert.equal(saveRules(settings, "a", { text: "First." }).ok, true);
  const stale = profiles.mutate(settings, { action: "rules", revision: 0, rules: { text: "Old draft." } }, { projectId: "a" });
  assert.equal(stale.ok, false); assert.equal(stale.stale, true); assert.match(stale.error, /Agent settings changed/);
  assert.equal(profiles.view(settings, "a").configuration.agentRules.text, "First.");
  assert.equal(profiles.mutate(settings, { action: "rules", revision: 1, rules: { text: "x" } }, { projectId: "project_none" }).ok, false);
  assert.equal(profiles.mutate(settings, { action: "rules", revision: 1, rules: { text: "x" } }, {}).ok, false);
  assert.equal(profiles.mutate(settings, { action: "rules", revision: 1 }, { projectId: "a" }).ok, false, "no rules given is not a save");
});

test("inherited defaults: a project with no team reads the defaults' rules; one with a team keeps its own, and returning follows the defaults again", () => {
  const settings = base();
  // Rules saved for the Studio defaults reach every project that follows them.
  const defaults = saveRules(settings, "a", { text: "Default rules.", agents: true }, { scope: "defaults" });
  assert.equal(defaults.ok, true);
  assert.deepEqual(settings.agentRules, { text: "Default rules.", agents: true, claude: false });
  for (const projectId of ["a", "b"]) {
    assert.equal(profiles.view(settings, projectId).inherited, true);
    assert.equal(profiles.effective(settings, projectId).agentRules.text, "Default rules.");
    assert.equal(profiles.view(settings, projectId).configuration.agentRules.text, "Default rules.");
  }
  // Project a keeps its own rules from here on.
  assert.equal(saveRules(settings, "a", { text: "Project A rules." }).ok, true);
  assert.equal(profiles.effective(settings, "a").agentRules.text, "Project A rules.");
  assert.equal(profiles.effective(settings, "b").agentRules.text, "Default rules.");
  // A later change to the defaults does not reach the project's own copy.
  assert.equal(saveRules(settings, "b", { text: "Newer defaults." }, { scope: "defaults" }).ok, true);
  assert.equal(profiles.effective(settings, "a").agentRules.text, "Project A rules.");
  assert.equal(profiles.effective(settings, "b").agentRules.text, "Newer defaults.");
  // Use Studio defaults drops the project's team, its rules with it.
  const back = profiles.mutate(settings, { action: "inherit", revision: revision(settings, "a") }, { projectId: "a" });
  assert.equal(back.inherited, true); assert.equal(back.configuration.agentRules.text, "Newer defaults.");
  // The whole-team save on the defaults carries rules too, and a save without them clears them.
  const teamDefaults = profiles.mutate(settings, { action: "save", scope: "defaults", revision: revision(settings, "a"), configuration: { aiProvider: "zen", agentRules: { text: "From the team save.", claude: true } } }, { projectId: "a" });
  assert.equal(teamDefaults.ok, true); assert.deepEqual(settings.agentRules, { text: "From the team save.", claude: true });
  assert.equal(profiles.mutate(settings, { action: "save", scope: "defaults", revision: revision(settings, "a"), configuration: { aiProvider: "zen" } }, { projectId: "a" }).ok, true);
  assert.equal(settings.agentRules, undefined);
});

test("clearing the rules removes the field: nothing to say stores nothing", () => {
  const settings = base();
  saveRules(settings, "a", { text: "Something.", agents: true });
  const cleared = saveRules(settings, "a", { text: "", agents: false, claude: false });
  assert.equal(cleared.ok, true); assert.equal("agentRules" in cleared.configuration, false);
  assert.equal("agentRules" in settings.agentTeams.projects.a.configuration, false);
  saveRules(settings, "a", { text: "Defaults." }, { scope: "defaults" });
  saveRules(settings, "a", { text: "" }, { scope: "defaults" });
  assert.equal("agentRules" in settings, false);
});

test("a saved team never carries the rules, and applying one leaves the project's rules as they were", () => {
  const settings = { ...base(), agentRules: { text: "Default rules.", agents: false, claude: false } };
  const change = (action, extra, projectId = "a", id = "team-one") => profiles.mutate(settings, { action, revision: revision(settings, projectId), ...extra }, { projectId, id });
  // Saving the team as a preset drops the rules the draft holds.
  const preset = change("preset-save", { name: "Calm team", configuration: { aiProvider: "codex", agentRules: { text: "Project A words.", agents: true } } });
  assert.equal(preset.ok, true);
  assert.equal("agentRules" in preset.presets[0].configuration, false);
  assert.equal("agentRules" in settings.agentTeams.presets[0].configuration, false);
  // Project a follows the defaults, so it has their rules; applying the preset copies the team, not the rules.
  const applied = change("apply", { id: "team-one" });
  assert.equal(applied.ok, true); assert.equal(applied.inherited, false);
  assert.equal(applied.configuration.aiProvider, "codex");
  assert.deepEqual(applied.configuration.agentRules, { text: "Default rules.", agents: false, claude: false }, "the rules it had, inherited ones included, stay in effect");
  // A project with rules of its own keeps them through another apply, and one with none stays without.
  saveRules(settings, "a", { text: "Project A words.", agents: true });
  assert.equal(change("apply", { id: "team-one" }).configuration.agentRules.text, "Project A words.");
  delete settings.agentRules;
  const bare = change("apply", { id: "team-one" }, "c");
  assert.equal("agentRules" in bare.configuration, false);
  // Updating a preset in place drops the rules the same way.
  assert.equal("agentRules" in change("preset-save", { id: "team-one", name: "Calm team", configuration: { aiProvider: "codex", agentRules: { text: "x" } } }).presets[0].configuration, false);
});

test("a run keeps the rules it started with; the file text is read again when its prompt is built", () => withoutKillSwitch(() => project(async (root) => {
  const settings = { ...base(), agentRules: { text: "Rules at the start.", agents: true } };
  await writeFile(path.join(root, "AGENTS.md"), "Notes at the start.");
  const snapshot = profiles.capture(settings, "a");
  assert.equal(snapshot.configuration.agentRules.text, "Rules at the start.");
  // The owner changes the rules and the file while the run is going.
  settings.agentRules = { text: "Rules changed later.", agents: true };
  await writeFile(path.join(root, "AGENTS.md"), "Notes changed later.");
  const running = profiles.effective(settings, "a", snapshot);
  const text = await addons.instructions(root, running, "lead");
  assert.match(text, /Rules at the start\./); assert.doesNotMatch(text, /Rules changed later/, "the switches and the text are the run's");
  assert.match(text, /Notes changed later\./, "the file is the project's own, read fresh");
  assert.equal(profiles.resume(snapshot, "a"), false, "resume only inside a dispatch context");
  assert.equal(profiles.validate(snapshot.configuration), null, "a captured team with rules still resumes");
})));
