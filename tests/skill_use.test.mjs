// How skills are used and where (scripts/skill-use.cjs), the answer styles that come with Studio
// (scripts/builtin-skills.cjs), and the catalog and prompt blocks agents get from them
// (scripts/agent-addons.cjs: skillCatalog, instructions, autoSkills, loadSkill).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const use = require("../scripts/skill-use.cjs");
const builtins = require("../scripts/builtin-skills.cjs");
const format = require("../scripts/skill-format.cjs");
const addons = require("../scripts/agent-addons.cjs");

async function project(fn) {
  const temp = await realpath(tmpdir());
  const base = await mkdtemp(path.join(temp, "mefi-skill-use-"));
  const root = path.join(base, "project"), home = path.join(base, "home");
  await mkdir(root); await mkdir(home);
  try { await fn({ root, home }); } finally { assert.equal(path.dirname(base), temp); addons.forget(); await rm(base, { recursive: true, force: true }); }
}
async function skill(base, folder, name, description, body) {
  await mkdir(path.join(base, folder, name), { recursive: true });
  await writeFile(path.join(base, folder, name, "SKILL.md"), description === null ? body : format.build({ name, description, body }));
}

test("every built-in skill is a skill the Skills page would accept, and the styles are the chat's choices", () => {
  const list = builtins.list();
  assert.ok(list.length >= 5);
  for (const skill of list) {
    const checked = format.check({ name: skill.name, description: skill.description, body: skill.body });
    assert.equal(checked.ok, true, `${skill.name}: ${JSON.stringify(checked.problems)}`);
    assert.equal(skill.text, checked.text, "its text is the file Copy to this project writes");
    assert.ok(skill.text.length < 2000, `${skill.name} stays small: it rides every chat request when on`);
    assert.equal(format.parse(skill.text).name, skill.name);
  }
  assert.deepEqual(builtins.styles().map((skill) => skill.name), builtins.NAMES.filter((name) => builtins.get(name).kind === "style"));
  assert.ok(builtins.NAMES.includes(use.DEFAULT_STYLE), "the default style is one that ships");
  assert.equal(builtins.get("nope"), null);
  // What it hands out is a copy.
  builtins.get("eli5").text = "changed";
  assert.notEqual(builtins.get("eli5").text, "changed");
});

test("defaults: ELI5 is the chat's style, other styles wait to be called, small skills pick themselves everywhere", () => {
  const styles = builtins.styles().map((skill) => ({ ...skill, chars: skill.text.length }));
  const small = { name: "bug-triage", kind: "skill", chars: 900 }, big = { name: "huge", kind: "skill", chars: 20000 };
  for (const place of use.PLACES) {
    assert.equal(use.useOf({}, small, place), "auto", place);
    assert.equal(use.useOf({}, big, place), "call", `${place}: a skill over 16,000 characters only loads when called`);
    for (const style of styles) assert.equal(use.useOf({}, style, place), place === "chat" && style.name === "eli5" ? "always" : "call", `${style.name} in ${place}`);
  }
  const plan = use.plan({}, [small, ...styles, big], "companion");
  assert.equal(plan.place, "chat");
  assert.deepEqual(plan.always.map((row) => row.name), ["eli5"]);
  assert.deepEqual(plan.auto.map((row) => row.name), ["bug-triage"]);
  assert.deepEqual(use.plan({}, [small, ...styles], "builder").always, []);
  assert.equal(use.placeOf("lead"), "agents"); assert.equal(use.placeOf("builder"), "builders"); assert.equal(use.placeOf("unknown"), "agents");
  // The first skill of a name counts (the project's before Studio's own), and `except` leaves a skill out.
  const own = { name: "eli5", kind: "skill", chars: 400 };
  assert.deepEqual(use.plan({}, [own, ...styles], "companion").always, [], "the project's eli5 is a plain skill");
  assert.deepEqual(use.plan({}, [small], "companion", { except: ["bug-triage"] }).auto, []);
});

test("choices: one use per place, the auto switches, and the style picker keeps only what differs", () => {
  const styles = builtins.styles();
  let policy = use.setUse({}, { name: "bug-triage", place: "builders", use: "always" });
  assert.deepEqual(policy, { skills: { "bug-triage": { builders: "always" } } });
  assert.equal(use.useOf(policy, { name: "bug-triage", kind: "skill", chars: 10 }, "builders"), "always");
  policy = use.setUse(policy, { name: "bug-triage", place: "builders", use: "default" });
  assert.deepEqual(policy, { skills: {} });
  for (const bad of [{ name: "../x", place: "chat", use: "always" }, { name: "ok", place: "desk", use: "always" }, { name: "ok", place: "chat", use: "sometimes" }]) assert.deepEqual(use.setUse({}, bad), { skills: {}, auto: { chat: true, agents: true, builders: true } });
  policy = use.setAuto({}, { place: "chat", on: false });
  assert.deepEqual(policy, { skills: {}, auto: { chat: false } });
  assert.equal(use.useOf(policy, { name: "bug-triage", kind: "skill", chars: 10 }, "chat"), "call", "with the switch off, auto acts as call");
  assert.equal(use.useOf(policy, { name: "bug-triage", kind: "skill", chars: 10 }, "builders"), "auto");
  // The picker: one style on in the chat, the default one turned off by name, nothing else kept.
  policy = use.setStyle({}, { style: "brief", styles });
  assert.deepEqual(policy.skills, { eli5: { chat: "call" }, brief: { chat: "always" } });
  assert.deepEqual(use.chatStyles(policy, styles), ["brief"]);
  assert.deepEqual(use.chatStyles(use.setStyle(policy, { style: null, styles }), styles), []);
  assert.deepEqual(use.setStyle(policy, { style: "eli5", styles }).skills, {}, "back to the default keeps nothing");
  // A choice made elsewhere for another place survives the picker.
  policy = use.setUse({}, { name: "brief", place: "builders", use: "always" });
  assert.deepEqual(use.setStyle(policy, { style: "teach-me", styles }).skills, { brief: { builders: "always" }, eli5: { chat: "call" }, "teach-me": { chat: "always" } });
});

test("a saved settings.skillUse is validated strictly and read leniently", () => {
  assert.equal(use.validate({ skills: { eli5: { chat: "call" } }, auto: { builders: false } }), null);
  for (const bad of [null, [], "x", { other: 1 }, { auto: { chat: "yes" } }, { auto: { desk: true } }, { skills: { "Bad Name": { chat: "always" } } }, { skills: { ok: { chat: "sometimes" } } }, { skills: { ok: { lead: "always" } } }, { skills: { ok: "always" } }]) assert.ok(use.validate(bad), JSON.stringify(bad));
  assert.deepEqual(use.normalize({ skills: { ok: { chat: "always", nope: "x" }, "../bad": { chat: "always" }, empty: { chat: "sometimes" } }, auto: { chat: false, desk: false } }), { skills: { ok: { chat: "always" } }, auto: { chat: false, agents: true, builders: true } });
  const summary = use.summary({ skills: { "bug-triage": { chat: "always" } } }, [{ name: "bug-triage", kind: "skill", chars: 10 }, { name: "eli5", kind: "style", chars: 10 }]);
  assert.deepEqual(summary.rows[0], { name: "bug-triage", uses: { chat: "always", agents: "auto", builders: "auto" }, chosen: { chat: "always", agents: null, builders: null }, defaults: { chat: "auto", agents: "auto", builders: "auto" } });
  assert.equal(summary.rows[1].uses.chat, "always");
});

test("the always-on budget and the list a model can load from stay short", () => {
  const found = [{ name: "a", text: "x".repeat(9000) }, { name: "b", text: "y".repeat(9000) }, { name: "c", text: "z".repeat(100) }];
  const fit = use.fitAlways(found);
  assert.deepEqual(fit.used.map((item) => item.name), ["a", "c"]);
  assert.deepEqual(fit.skipped, [{ name: "b", reason: "room" }]);
  assert.deepEqual(use.fitAlways(found, { count: 1 }).skipped.map((item) => item.reason), ["limit", "limit"]);
  assert.equal(use.alwaysBlock([], "chat"), "");
  assert.match(use.alwaysBlock([{ name: "c", text: "BODY" }], "builders"), /turned on for the builders[\s\S]*Skill: c\nBODY/);
  const many = Array.from({ length: 40 }, (_, index) => ({ name: `skill-${index}`, description: "d".repeat(400) }));
  const line = use.catalogLine(many);
  assert.ok(line.length <= 4400, `${line.length}`);
  assert.match(line, /skill-0: d+…/);
  assert.doesNotMatch(line, /skill-39/);
  assert.equal(use.catalogLine([]), "");
});

test("the catalog resolves a name project first, then the home folder, then Studio, and reads changed files again", () => project(async ({ root, home }) => {
  await skill(root, ".agents/skills", "bug-triage", "Project triage", "PROJECT-BODY");
  await skill(home, ".claude/skills", "bug-triage", "Home triage", "HOME-BODY");
  await skill(home, ".claude/skills", "brief", "My own brief", "MY-BRIEF");
  await skill(root, ".codex/skills", "Weird Name!", "bad", "x");
  const rows = await addons.skillCatalog(root, { home });
  const names = rows.map((row) => `${row.scope}:${row.name}`);
  assert.deepEqual(names.slice(0, 2), ["project:bug-triage", "user:brief"]);
  assert.ok(names.includes("builtin:eli5") && !names.includes("builtin:brief"), "a home skill named brief stands in for Studio's");
  assert.ok(!names.some((name) => name.includes("Weird")), "a folder name that can't stand in a prompt is not listed");
  assert.equal(rows[0].description, "Project triage");
  assert.equal(await addons.skillText(rows[0]), format.build({ name: "bug-triage", description: "Project triage", body: "PROJECT-BODY" }));
  assert.equal(JSON.stringify(rows.filter((row) => row.scope === "builtin")).includes(root), false);
  // A file that changed is read again.
  await skill(root, ".agents/skills", "bug-triage", "Changed triage", "CHANGED-BODY-WITH-ANOTHER-SIZE");
  assert.equal((await addons.skillCatalog(root, { home }))[0].description, "Changed triage");
}));

test("instructions: the chat gets its style, a task's /name brings that skill, and nothing is in a prompt twice", () => project(async ({ root, home }) => {
  await skill(root, ".agents/skills", "bug-triage", "Reproduce a bug first", "TRIAGE-BODY");
  const chat = await addons.instructions(root, {}, "companion", { home });
  assert.match(chat, /turned on for the chat[\s\S]*Skill: eli5/);
  assert.doesNotMatch(chat, /TRIAGE-BODY/, "a skill that picks itself is offered by use_skill, not pasted in");
  assert.equal(await addons.instructions(root, { skillUse: { skills: { eli5: { chat: "call" } } } }, "companion", { home }), "", "the owner turned the style off");
  // Another style, and one for the builders.
  const brief = await addons.instructions(root, { skillUse: use.setStyle({}, { style: "brief", styles: builtins.styles() }) }, "companion", { home });
  assert.match(brief, /Skill: brief/); assert.doesNotMatch(brief, /Skill: eli5/);
  const builder = await addons.instructions(root, { skillUse: { skills: { "bug-triage": { builders: "always" } } } }, "builder", { home });
  assert.match(builder, /turned on for the builders[\s\S]*TRIAGE-BODY/);
  // A task that names the skill brings it, once, even when it is also on.
  const named = await addons.instructions(root, {}, "builder", { home, text: "Fix the login /bug-triage please, see /src/app.js" });
  assert.match(named, /named in this task[\s\S]*TRIAGE-BODY/);
  assert.equal(named.split("TRIAGE-BODY").length, 2);
  const both = await addons.instructions(root, { skillUse: { skills: { "bug-triage": { builders: "always" } } } }, "builder", { home, text: "/bug-triage" });
  assert.equal(both.split("TRIAGE-BODY").length, 2, "on and named: in the prompt once");
  assert.equal(await addons.instructions(root, {}, "builder", { home, text: "/not-a-skill and /tmp" }), "");
  // The team's own pick for the companion counts once too.
  const [triage] = (await addons.catalog(root, { home })).filter((row) => row.name === "bug-triage");
  const picked = await addons.instructions(root, { agentSkills: { companion: [triage.id] }, skillUse: { skills: { "bug-triage": { chat: "always" } } } }, "companion", { home });
  assert.equal(picked.split("TRIAGE-BODY").length, 2);
  assert.deepEqual(await addons.alwaysNames(root, { agentSkills: { companion: [triage.id] } }, "companion", { home }), ["bug-triage", "eli5"]);
}));

test("autoSkills offers what may pick itself, and loadSkill reads only what was offered", () => project(async ({ root, home }) => {
  await skill(root, ".agents/skills", "bug-triage", "Reproduce a bug first", "TRIAGE-BODY");
  await skill(root, ".agents/skills", "huge", "Too big to load by itself", "h".repeat(17000));
  await skill(root, ".agents/skills", "quiet", "Only when called", "QUIET-BODY");
  const settings = { skillUse: { skills: { quiet: { agents: "call", builders: "call", chat: "call" } } } };
  const offered = await addons.autoSkills(root, settings, "lead", { home });
  assert.deepEqual(offered.map((row) => row.name), ["bug-triage"]);
  assert.deepEqual(Object.keys(offered[0]).sort(), ["chars", "description", "name", "scope", "title"], "no path leaves the host");
  assert.deepEqual((await addons.autoSkills(root, settings, "companion", { home })).map((row) => row.name), ["bug-triage"], "the chat's always-on style is not offered again");
  assert.deepEqual(await addons.autoSkills(root, { skillUse: { auto: { agents: false } } }, "lead", { home }), [], "the place's switch is off");
  const loaded = await addons.loadSkill(root, settings, "lead", "bug-triage", { home });
  assert.equal(loaded.name, "bug-triage"); assert.match(loaded.text, /TRIAGE-BODY/);
  for (const name of ["quiet", "huge", "eli5", "../secret", ""]) await assert.rejects(addons.loadSkill(root, settings, "lead", name, { home }), /no skill named|No skills/i, name);
}));

test("MEFI_STUDIO_NO_SKILL_USE=1 sends no skill by its place and offers none to load; the team's own picks still go", () => project(async ({ root, home }) => {
  await skill(root, ".agents/skills", "bug-triage", "Reproduce a bug first", "TRIAGE-BODY");
  const [triage] = (await addons.catalog(root, { home })).filter((row) => row.name === "bug-triage");
  const before = process.env.MEFI_STUDIO_NO_SKILL_USE;
  try {
    process.env.MEFI_STUDIO_NO_SKILL_USE = "1";
    assert.equal(await addons.instructions(root, {}, "companion", { home }), "", "no answer style");
    assert.equal(await addons.instructions(root, { skillUse: { skills: { "bug-triage": { builders: "always" } } } }, "builder", { home, text: "/bug-triage" }), "", "nothing always on, nothing named");
    assert.deepEqual(await addons.autoSkills(root, {}, "lead", { home }), []);
    await assert.rejects(addons.loadSkill(root, {}, "lead", "bug-triage", { home }), /No skills can be loaded/);
    assert.match(await addons.instructions(root, { agentSkills: { builder: [triage.id] } }, "builder", { home }), /Selected agent skills[\s\S]*TRIAGE-BODY/);
    process.env.MEFI_STUDIO_NO_SKILL_USE = "0";
    assert.match(await addons.instructions(root, {}, "companion", { home }), /Skill: eli5/, "only 1 switches it off");
  } finally { if (before === undefined) delete process.env.MEFI_STUDIO_NO_SKILL_USE; else process.env.MEFI_STUDIO_NO_SKILL_USE = before; }
}));

test("a project's copy of a built-in style is still that style, so Copy to this project keeps ELI5 on", () => project(async ({ root, home }) => {
  const eli5 = builtins.get("eli5");
  await skill(root, ".agents/skills", "eli5", eli5.description, `${eli5.body}\n- And use our team's words.`);
  const row = (await addons.skillCatalog(root, { home })).find((item) => item.name === "eli5");
  assert.deepEqual([row.scope, row.kind, row.title], ["project", "style", "Explain like I'm 5"]);
  const chat = await addons.instructions(root, {}, "companion", { home });
  assert.match(chat, /Skill: eli5[\s\S]*our team's words/, "the project's copy is the one in use, still on for the chat");
  assert.deepEqual(await addons.autoSkills(root, {}, "builder", { home }), [], "and still only called by builders and agents");
}));

test("a skill named the way another tool names them (pdf_tools) can be listed and its use changed", () => project(async ({ root, home }) => {
  await skill(home, ".claude/skills", "pdf_tools", "Work with PDF files", "PDF-BODY");
  await skill(home, ".claude/skills", "My Skill", "Spaces are not a name", "x");
  const names = (await addons.skillCatalog(root, { home })).map((row) => row.name);
  assert.ok(names.includes("pdf_tools")); assert.ok(!names.includes("My Skill"));
  const policy = use.setUse({}, { name: "pdf_tools", place: "builders", use: "always" });
  assert.deepEqual(policy.skills, { pdf_tools: { builders: "always" } });
  assert.equal(use.validate(policy), null);
  assert.match(await addons.instructions(root, { skillUse: policy }, "builder", { home }), /PDF-BODY/);
  for (const bad of ["__proto__", "constructor", "../x", "a b", ""]) assert.equal(use.validName(bad), false, bad);
}));

test("a /word in a task's prose is not a call: only a name that starts the words or has a dash", () => project(async ({ root, home }) => {
  await skill(root, ".agents/skills", "test", "Run the tests", "TEST-BODY");
  await skill(root, ".agents/skills", "bug-triage", "Reproduce a bug first", "TRIAGE-BODY");
  assert.equal(await addons.instructions(root, {}, "builder", { home, text: "Fix the /test route so it returns 200" }), "");
  assert.match(await addons.instructions(root, {}, "builder", { home, text: "/test the checkout flow" }), /TEST-BODY/);
  assert.match(await addons.instructions(root, {}, "builder", { home, text: "then run /bug-triage on it" }), /TRIAGE-BODY/);
}));

test("what counts as on for a role is what its prompt carries: the team's picks leave less room", () => project(async ({ root, home }) => {
  await skill(root, ".agents/skills", "big-pick", "A big team pick", "p".repeat(15600));
  await skill(root, ".agents/skills", "house-rules", "Our conventions", "r".repeat(600));
  const [big] = (await addons.catalog(root, { home })).filter((row) => row.name === "big-pick");
  const settings = { agentSkills: { companion: [big.id] }, skillUse: { skills: { "house-rules": { chat: "always" } } } };
  const prompt = await addons.instructions(root, settings, "companion", { home });
  const names = await addons.alwaysNames(root, settings, "companion", { home });
  assert.ok(names.includes("big-pick"));
  for (const name of ["house-rules", "eli5"]) assert.equal(names.includes(name), prompt.includes(`Skill: ${name}\n`), `${name}: named on exactly when it is sent`);
}));
