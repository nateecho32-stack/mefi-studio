// The Rules card in Agents › Team & models (renderer/agents.js, "rules card"):
// the text box with its character and token count, the two file switches, Save
// and Discard, and the "Who reads what" list, against a fake DOM and a fake
// bridge. The card's own code and the page's helper functions are the real ones,
// cut out of the source; the host's answers are stubs shaped like agents:state.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createDom } from "./fixtures/renderer-dom.mjs";

const require = createRequire(import.meta.url);
const rules = require("../scripts/agent-rules.cjs");
const source = (await readFile(new URL("../renderer/agents.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const card = (() => {
  const start = source.indexOf("  // ---- rules card ----"), end = source.indexOf("  // ---- end of rules card ----");
  assert.ok(start > 0 && end > start, "the rules card is still marked in renderer/agents.js");
  return source.slice(start, end);
})();
// The page's own small helpers, taken from the source so the card runs on the real ones.
const helper = (prefix) => {
  const line = source.split("\n").find((row) => row.startsWith(prefix));
  assert.ok(line, `agents.js still has ${prefix}`);
  return line;
};
const helpers = ["  const $ = ", "  const node = ", "  const clone = ", "  const api = ", "  function button(", "  function risky(", "  const plain = ", "  function card(", "  function say(", "  function field("].map(helper).join("\n");
const flush = async () => { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); };

const INFO = { limit: 4000, fileCap: 8000, disabled: false, overhead: rules.overhead(), readers: rules.readers(), files: {
  agents: { name: "AGENTS.md", note: "the project's own agent notes", found: true, problem: null, bytes: 1840, used: 1800, capped: false, same: null },
  claude: { name: "CLAUDE.md", note: "Claude Code's project notes", found: true, problem: null, bytes: 610, used: 600, capped: false, same: null },
} };
const savedView = (agentRules, extra = {}) => ({ ok: true, projectId: "p1", revision: 3, inherited: false, name: "Dungeon team", configuration: { aiProvider: "zen", ...(agentRules ? { agentRules } : {}) }, presets: [], rulesInfo: structuredClone(INFO), ...extra });

// One page: the card mounted, a draft for the project, and a bridge that answers agentsSave.
function page({ view = savedView({ text: "Use LÖVE 11.5.", agents: true, claude: false }), info, scope = "project", answer } = {}) {
  const dom = createDom({ ids: ["agents-save-status", "agents-team-summary", "agents-team-name"] });
  const calls = [];
  const bridge = { agentsSave: async (payload) => { calls.push(structuredClone(payload)); return answer ? answer(payload) : { ...view, revision: view.revision + 1, configuration: { ...view.configuration, agentRules: rules.normalize(payload.rules) ?? undefined } }; } };
  const armed = [];
  const window = { mefiStudio: bridge, MefiUi: { arm(button, { run, armed: label }) { let on = false, resting = null; button.addEventListener("click", (event) => { if (!on) { on = true; resting = button.textContent; button.textContent = label; armed.push(label); return; } on = false; button.textContent = resting; run(event); }); return button; }, plainError: (error, fallback) => String(error?.message || fallback) } };
  const drafts = new Map();
  const context = vm.createContext({ document: dom.document, window, drafts, scope, saving: false, JSON, Number, String, Object, Array, Math, structuredClone, projectId: () => "p1", draftKey: () => `p1:${context.scope}`, draft: () => drafts.get(`p1:${context.scope}`), dirty() { context.dirtied = true; }, renderConfiguration() { context.rendered = (context.rendered || 0) + 1; } });
  vm.runInContext(`${helpers}\n${card}\nthis.buildRules = buildRules; this.paintRules = paintRules; this.paintRulesLive = paintRulesLive; this.saveRules = saveRules; this.discardRules = discardRules; this.rulesChanged = rulesChanged; this.rulesCost = rulesCost; this.rulesUi = rulesUi; this.rulesAtRisk = rulesAtRisk;`, context);
  const box = context.buildRules();
  const item = { saved: { ...view, rulesInfo: info === undefined ? view.rulesInfo : info }, configuration: structuredClone(view.configuration), name: view.name, dirty: false };
  drafts.set(`p1:${scope}`, item);
  context.paintRules();
  const ui = context.rulesUi;
  const type = (text) => { ui.area.value = text; return ui.area.trigger("input"); };
  return { context, box, item, ui, calls, armed, dom, type, bridge, status: () => dom.get("agents-save-status").textContent };
}

test("the card shows the saved rules, the two switches, what each file adds, and what every request costs", () => {
  const { ui, box } = page();
  assert.equal(box.id, "agents-rules");
  assert.equal(box.querySelector("h3").textContent, "Rules");
  assert.match(box.querySelector("p").textContent, /Standing rules every model on this project reads\. Write what you would tell a new teammate on their first day\./);
  assert.equal(ui.area.value, "Use LÖVE 11.5.");
  assert.equal(ui.chars.textContent, "14 of 4,000 characters");
  assert.equal(ui.tokens.textContent, "about 4 tokens");
  assert.equal(ui.switches.agents.input.checked, true); assert.equal(ui.switches.claude.input.checked, false);
  assert.equal(ui.switches.agents.note.textContent, "1.8 KB · about 450 tokens · the project's own agent notes");
  assert.equal(ui.switches.claude.note.textContent, "610 bytes · about 150 tokens · Claude Code's project notes");
  // The total is what the prompt counts: the text's heading and text, and AGENTS.md's heading and content.
  const over = rules.overhead(), expected = Math.ceil((over.text + 14 + over.agents + 1800) / 4);
  assert.equal(ui.sum.textContent, `about ${expected} tokens`);
  assert.equal(ui.state.textContent, "Saved"); assert.equal(ui.state.dataset.tone, "good");
  assert.equal(ui.save.disabled, true, "nothing to save yet"); assert.equal(ui.discard.disabled, true);
  assert.equal(ui.warn.hidden, true);
  assert.equal(ui.scopeNote.hidden, true, "a project with its own team needs no note");
});

test("the card's count is the prompt's count, for any text and either switch", () => {
  const p = page({ view: savedView(undefined) });
  const files = { agents: { text: "x".repeat(1800), bytes: 1840 }, claude: { text: "y".repeat(600), bytes: 610 } };
  for (const [text, agents, claude] of [["", false, false], ["One rule.", false, false], ["Rule.\nAnother rule.", true, false], ["Rule.", true, true], ["", false, true], ["é".repeat(3999), true, true]]) {
    const item = p.item; item.rules = { text, agents, claude };
    const shown = p.context.rulesCost(item).tokens, real = rules.cost({ text, agents, claude }, { role: "lead", files }).tokens;
    assert.equal(shown, real, JSON.stringify({ text: text.slice(0, 12), agents, claude }));
  }
  // A CLAUDE.md that repeats AGENTS.md is counted once, only while AGENTS.md is on too.
  p.item.saved.rulesInfo.files.claude.same = "agents"; p.item.saved.rulesInfo.files.claude.used = 1800;
  p.item.rules = { text: "", agents: true, claude: true };
  const same = { agents: { text: "x".repeat(1800), bytes: 1840 }, claude: { text: "x".repeat(1800), bytes: 1840 } };
  assert.equal(p.context.rulesCost(p.item).tokens, rules.cost({ text: "", agents: true, claude: true }, { role: "lead", files: same }).tokens);
  p.item.rules = { text: "", agents: false, claude: true };
  assert.equal(p.context.rulesCost(p.item).tokens, rules.cost({ text: "", agents: false, claude: true }, { role: "lead", files: same }).tokens);
});

test("typing counts as you go, marks the change, and refuses to save past 4,000 characters without cutting a word", async () => {
  const p = page({ view: savedView(undefined) });
  assert.equal(p.ui.area.value, ""); assert.equal(p.ui.state.textContent, "Saved");
  await p.type("Run `npm run check` first.");
  assert.equal(p.ui.chars.textContent, "26 of 4,000 characters"); assert.equal(p.ui.tokens.textContent, "about 7 tokens");
  assert.equal(p.ui.state.textContent, "Unsaved changes");
  assert.equal(p.ui.save.disabled, false); assert.equal(p.ui.discard.disabled, false);
  // At the limit: fine. One over: said in words, Save waits, the text is untouched.
  const limit = "a".repeat(4000);
  await p.type(limit);
  assert.equal(p.ui.chars.textContent, "4,000 of 4,000 characters"); assert.equal(p.ui.warn.hidden, true); assert.equal(p.ui.save.disabled, false);
  await p.type(`${limit}b`);
  assert.equal(p.ui.chars.textContent, "4,001 of 4,000 characters");
  assert.equal(p.ui.warn.hidden, false); assert.match(p.ui.warn.textContent, /Too long to save.*Nothing was cut\. Trim it, or move the detail into AGENTS\.md and switch that file on below\./);
  assert.equal(p.ui.box.dataset.over, "true"); assert.equal(p.ui.state.textContent, "Unsaved changes"); assert.equal(p.ui.state.dataset.tone, "bad");
  assert.equal(p.ui.save.disabled, true);
  await p.ui.save.click(); await flush();
  assert.equal(p.calls.length, 0, "an over-length text never reaches the host");
  assert.equal(p.ui.area.value.length, 4001, "and is not cut in the box");
  assert.equal(p.ui.area.attrs.maxlength, undefined, "the box has no maxlength, which would cut a paste silently");
  assert.equal(p.ui.area.maxLength, undefined);
});

test("a switch marks the change and moves the total by what that file adds", async () => {
  const p = page({ view: savedView({ text: "Rule.", agents: false, claude: false }) });
  const before = Number(/(\d+)/.exec(p.ui.sum.textContent)[1]);
  p.ui.switches.claude.input.checked = true; await p.ui.switches.claude.input.trigger("change");
  assert.equal(p.ui.state.textContent, "Unsaved changes");
  const after = Number(/(\d+)/.exec(p.ui.sum.textContent)[1]);
  const over = rules.overhead();
  assert.equal(after - before, Math.ceil((over.text + 5 + over.claude + 600) / 4) - Math.ceil((over.text + 5) / 4));
  p.ui.switches.claude.input.checked = false; await p.ui.switches.claude.input.trigger("change");
  assert.equal(p.ui.state.textContent, "Saved", "switching it back is no change");
  assert.equal(Number(/(\d+)/.exec(p.ui.sum.textContent)[1]), before);
});

test("Save sends only the rules to the host, keeps the rest of the team draft as edited, and follows the host's copy", async () => {
  const p = page();
  // A half-edited team: another card's change is in the draft and must survive a rules save.
  p.item.configuration.aiProvider = "codex"; p.item.dirty = true;
  await p.type("Use LÖVE 11.5.\nRun test/run-check.ps1.  \n\n");
  p.ui.switches.claude.input.checked = true; await p.ui.switches.claude.input.trigger("change");
  await p.ui.save.click(); await flush();
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0], { action: "rules", projectId: "p1", scope: "project", revision: 3, rules: { text: "Use LÖVE 11.5.\nRun test/run-check.ps1.  \n\n", agents: true, claude: true } });
  assert.equal(p.calls[0].configuration, undefined, "the team is not sent");
  assert.equal(p.item.saved.revision, 4, "the draft follows the host's new revision");
  assert.equal(p.item.configuration.aiProvider, "codex", "another card's unsaved change is untouched");
  assert.equal(p.item.dirty, true, "and the page still says there is a draft");
  assert.equal(p.ui.area.value, "Use LÖVE 11.5.\nRun test/run-check.ps1.", "the box shows the host's normalised copy");
  assert.equal(p.ui.state.textContent, "Rules saved. New requests use them. Running tasks keep the rules they started with.");
  assert.equal(p.ui.state.dataset.tone, "good");
  assert.equal(p.ui.save.disabled, true);
  assert.equal(p.context.saving, false);
  assert.deepEqual(p.item.configuration.agentRules, { text: "Use LÖVE 11.5.\nRun test/run-check.ps1.", agents: true, claude: true }, "a later Apply carries the saved rules");
  // Typing again clears the message and marks a new change.
  await p.type("Different."); assert.equal(p.ui.state.textContent, "Unsaved changes");
});

test("saving from a project that follows the Studio defaults says it will give the project its own team, and the page's summary follows", async () => {
  const view = savedView({ text: "Default rules.", agents: false, claude: false }, { inherited: true, name: "Studio defaults" });
  const p = page({ view, answer: (payload) => ({ ...savedView(payload.rules, { inherited: false, name: "Project team", revision: 1 }) }) });
  assert.equal(p.ui.scopeNote.hidden, false);
  assert.match(p.ui.scopeNote.textContent, /follows the Studio defaults.*Saving here gives it a team of its own: a copy of the defaults plus these rules\./);
  await p.type("Project rules."); await p.ui.save.click(); await flush();
  assert.equal(p.item.saved.inherited, false); assert.equal(p.item.name, "Project team", "an unedited team name follows the saved one");
  assert.equal(p.dom.get("agents-team-summary").textContent, "Project team · Project team");
  assert.equal(p.ui.scopeNote.hidden, true, "the note goes when the team is the project's own");
  assert.equal(p.status(), "Independent project team · Saved");
});

test("the Studio defaults' rules say so, save with scope defaults and read no project's files", async () => {
  const view = savedView({ text: "Everywhere.", agents: true }, { inherited: false, name: "Studio defaults", rulesInfo: { ...structuredClone(INFO), files: null } });
  const p = page({ view, scope: "defaults" });
  assert.match(p.ui.scopeNote.textContent, /These are the Studio defaults' rules: every project without a team of its own reads them\./);
  assert.equal(p.ui.switches.agents.note.textContent, "Read from each project's own folder");
  await p.type("Everywhere, again."); await p.ui.save.click(); await flush();
  assert.equal(p.calls[0].scope, "defaults");
  assert.equal(p.calls[0].action, "rules");
});

test("a refused save keeps the text, says why in plain words and leaves Save ready", async () => {
  for (const [answer, words] of [
    [() => ({ ok: false, stale: true, error: "Agent settings changed. Reload the saved version or keep your draft and try again." }), /Agent settings changed\. Reload the saved version/],
    [() => ({ ok: false, error: "The rules are 4,001 characters and the limit is 4,000. Nothing was cut. Trim it, or move the detail into AGENTS.md and switch that file on." }), /Nothing was cut/],
    [() => { throw new Error("Error invoking remote method 'agents:save': Error: the host went away"); }, /host went away/],
  ]) {
    const p = page({ answer });
    await p.type("A new draft of the rules."); await p.ui.save.click(); await flush();
    assert.match(p.ui.state.textContent, words); assert.equal(p.ui.state.dataset.tone, "bad");
    assert.equal(p.ui.area.value, "A new draft of the rules.", "the typed text is still here");
    assert.equal(p.item.saved.revision, 3, "the saved copy did not change");
    assert.equal(p.ui.save.disabled, false, "and can be tried again"); assert.equal(p.context.saving, false);
  }
  // No bridge at all (a browser preview) is a sentence, not a crash.
  const p = page(); p.context.window.mefiStudio = {};
  await p.type("Draft."); await p.ui.save.click(); await flush();
  assert.match(p.ui.state.textContent, /rules were not saved/);
});

test("Discard asks twice, then puts the saved rules back", async () => {
  const p = page();
  await p.type("Something I will regret typing."); p.ui.switches.claude.input.checked = true; await p.ui.switches.claude.input.trigger("change");
  await p.ui.discard.click();
  assert.deepEqual(p.armed, ["Discard your rules edits?"]);
  assert.equal(p.ui.area.value, "Something I will regret typing.", "the first press only asks");
  await p.ui.discard.click();
  assert.equal(p.ui.area.value, "Use LÖVE 11.5.");
  assert.equal(p.ui.switches.claude.input.checked, false);
  assert.equal(p.ui.state.textContent, "Saved");
  assert.equal(p.calls.length, 0, "nothing was sent");
});

test("the kill switch is said in words, and the rules are shown as kept", () => {
  const p = page({ info: { ...structuredClone(INFO), disabled: true } });
  assert.match(p.ui.state.textContent, /switched off for this session \(MEFI_STUDIO_NO_AGENT_RULES\)\. Nothing here is sent, and your rules are kept\./);
  assert.equal(p.ui.state.dataset.tone, "warn");
  assert.equal(p.ui.area.value, "Use LÖVE 11.5.", "the field is kept and shown");
});

test("who reads what comes from the host's table: text and files for Studio's models, the owner's text for the CLIs that read the files themselves", () => {
  const p = page();
  const rows = p.ui.list.children;
  assert.equal(rows.length, rules.readers().length);
  const chips = rows.map((row) => [row.querySelector("strong").textContent, row.querySelector(".agents-rules-chip").textContent]);
  assert.deepEqual(chips, rules.readers().map((row) => [row.title, row.files ? "Text and files" : "Your text"]));
  assert.ok(chips.some(([title, chip]) => /Claude Code, Codex or OpenCode/.test(title) && chip === "Your text"));
  assert.ok(chips.filter(([, chip]) => chip === "Text and files").length >= 3);
  assert.equal(p.ui.readers.hidden, false);
  // A host that sends no table (an older one) shows no list rather than a made-up one.
  const bare = page({ info: {} });
  assert.equal(bare.ui.readers.hidden, true); assert.equal(bare.ui.list.children.length, 0);
  assert.equal(bare.ui.switches.agents.note.textContent, "Read from each project's own folder", "and does not invent file sizes");
});

test("a file that is missing, a link out of the project, a binary and a big one each say so", () => {
  const info = structuredClone(INFO);
  info.files.agents = { name: "AGENTS.md", note: "the project's own agent notes", found: false, problem: null, bytes: 0, used: 0, capped: false, same: null };
  info.files.claude = { name: "CLAUDE.md", note: "Claude Code's project notes", found: true, problem: "outside", bytes: 0, used: 0, capped: false, same: null };
  let p = page({ info });
  assert.equal(p.ui.switches.agents.note.textContent, "Not in this project's folder · the project's own agent notes");
  assert.equal(p.ui.switches.claude.note.textContent, "A link that leaves the project: not read");
  info.files.agents = { ...INFO.files.agents, problem: "binary", used: 0 }; info.files.claude = { ...INFO.files.claude, bytes: 65432, used: 8000, capped: true };
  p = page({ info });
  assert.equal(p.ui.switches.agents.note.textContent, "Not a text file: not read");
  assert.equal(p.ui.switches.claude.note.textContent, "63.9 KB · about 2000 tokens · only the first 8,000 characters are sent · Claude Code's project notes");
  info.files.claude = { ...INFO.files.claude, same: "agents", used: 1800 };
  p = page({ info });
  assert.match(p.ui.switches.claude.note.textContent, /^Same text as AGENTS\.md · sent once/);
});

test("a whole-team Apply keeps typed rules and gives the rules buttons back when it is done", async () => {
  const start = source.indexOf("  async function save(action, id) {"), end = source.indexOf("  function discard() {");
  assert.ok(start > 0 && end > start, "save() is still in renderer/agents.js");
  const p = page();
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const applied = [];
  p.context.window.mefiStudio.agentsSave = async (payload) => { applied.push(structuredClone(payload)); await gate; return { ...savedView({ text: "Use LÖVE 11.5.", agents: true, claude: false }, { revision: 4 }) }; };
  p.context.say = () => {}; p.context.dirty = () => {}; p.context.scope = "project";
  vm.runInContext(`${source.slice(start, end)}\nthis.saveTeam = save;`, p.context);
  await p.type("Half-typed rules");
  assert.equal(p.ui.save.disabled, false);
  const saving = p.context.saveTeam("save");
  await flush();
  assert.equal(p.context.saving, true);
  assert.deepEqual(applied[0].configuration.agentRules, { text: "Use LÖVE 11.5.", agents: true, claude: false }, "the team carries the saved rules, not the half-typed ones");
  p.context.paintRulesLive(p.context.draft());
  assert.equal(p.ui.save.disabled, true, "while a save is out the rules wait");
  release(); await saving; await flush();
  assert.equal(p.context.saving, false);
  assert.equal(p.ui.save.disabled, false, "and are ready again when it is done");
  assert.equal(p.ui.discard.disabled, false);
  assert.equal(p.ui.area.value, "Half-typed rules"); assert.equal(p.ui.state.textContent, "Unsaved changes");
  assert.equal(p.context.draft().rules.text, "Half-typed rules", "the new draft still holds the typed text");
});

test("Use Studio defaults, which drops the project's team and its rules, asks twice while there are rules to lose and never otherwise", async () => {
  const start = source.indexOf("  // Like risky(), but it asks only while"), end = source.indexOf("  const plain = ");
  assert.ok(start > 0 && end > start);
  const rows = [
    ["a project with saved rules", savedView({ text: "Mine.", agents: false, claude: false }), true],
    ["a project with only a switch on", savedView({ text: "", agents: true, claude: false }), true],
    ["a project with no rules", savedView(undefined), false],
    ["a project that follows the defaults", savedView({ text: "Default rules." }, { inherited: true, name: "Studio defaults" }), false],
  ];
  for (const [label, view, asks] of rows) {
    const p = page({ view });
    const timers = [];
    p.context.setTimeout = (fn) => { timers.push(fn); return timers.length; }; p.context.clearTimeout = () => {};
    let inherited = 0;
    p.context.save = (action) => { if (action === "inherit") inherited += 1; };
    vm.runInContext(`${source.slice(start, end)}\nthis.button = riskyIf("Use Studio defaults", rulesAtRisk, () => save("inherit"), "Drop this team and its rules?", "ghost mini");`, p.context);
    const button = p.context.button;
    await button.click();
    if (asks) {
      assert.equal(inherited, 0, `${label}: the first press only asks`);
      assert.equal(button.textContent, "Drop this team and its rules?"); assert.ok(button.classList.contains("danger-armed"));
      await button.click();
      assert.equal(inherited, 1, `${label}: the second press does it`); assert.equal(button.textContent, "Use Studio defaults");
    } else assert.equal(inherited, 1, `${label}: nothing to lose, so one press does it`);
  }
  // Typed but unsaved rules on a project with a team of its own are at risk too, and Escape or the timeout puts the question away.
  const p = page({ view: savedView(undefined) });
  await p.type("Half a paragraph I have not saved.");
  assert.equal(p.context.rulesAtRisk(), true);
  const timers = []; p.context.setTimeout = (fn) => { timers.push(fn); return timers.length; }; p.context.clearTimeout = () => {}; p.context.save = () => assert.fail("no second press");
  vm.runInContext(`${source.slice(source.indexOf("  // Like risky(), but it asks only while"), source.indexOf("  const plain = "))}\nthis.button = riskyIf("Use Studio defaults", rulesAtRisk, () => save("inherit"), "Sure?", "ghost mini");`, p.context);
  await p.context.button.click(); assert.equal(p.context.button.textContent, "Sure?");
  timers.at(-1)(); assert.equal(p.context.button.textContent, "Use Studio defaults", "the question goes after a few seconds");
  await p.context.button.click(); await p.context.button.trigger("keydown", { key: "Escape" }); assert.equal(p.context.button.textContent, "Use Studio defaults", "Escape puts it away");
  assert.match(source, /riskyIf\("Use Studio defaults", rulesAtRisk, \(\) => save\("inherit"\), "Drop this team and its rules\?", "ghost mini"\)/, "the page's button is this one");
});

test("the page wires the card in: it sits between the team and the saved teams, repaints with the team, and its text survives what else can happen", () => {
  assert.match(source, /\$\("agents-team"\)\.append\(buildRules\(\)\);\n    buildSetupHeader\(\);/, "the card is mounted before the saved-teams details, so it sits above them");
  assert.match(source, /say\(item\.dirty \? [^\n]*\n    paintRules\(\);/, "renderConfiguration repaints the card");
  assert.match(source, /if \(saving \|\| !draft\(\) \|\| draft\(\)\.dirty \|\| rulesChanged\(draft\(\)\)\) return;/, "another writer's change does not drop unsaved rules text");
  assert.match(source, /rules: item\.rules && rulesChanged\(item\) \? item\.rules : undefined/, "applying the team keeps unsaved rules text");
  assert.match(source, /const kept = draft\(\)\.configuration\.agentRules;[\s\S]*draft\(\)\.configuration\.agentRules = kept;/, "a saved team dropped into the draft keeps the rules");
});

test("no text in the card's styles is under 12px, and nothing scrolls inside it", async () => {
  const css = await readFile(new URL("../renderer/agents.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("/* Rules (scripts/agent-rules.cjs)"));
  assert.ok(block.length > 500);
  for (const [, size] of block.matchAll(/font-size:\s*([\d.]+)px/g)) assert.ok(Number(size) >= 12, `${size}px`);
  for (const match of block.matchAll(/font:\s*[^;]*?([\d.]+)px/g)) assert.ok(Number(match[1]) >= 12, match[0]);
  assert.doesNotMatch(block, /--fs-2xs|--fs-xs/, "the small size tokens are under 12px");
  assert.doesNotMatch(block, /overflow(-[xy])?:\s*(scroll|auto)/, "no scroll gutters");
});
