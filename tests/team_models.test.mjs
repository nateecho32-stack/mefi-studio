// Team › Seats and models and Team › Providers, made simple (renderer/team-models.js),
// run in a vm against the shared fake DOM and a fake bridge. The page is built
// from a sample team draft (agents:state's shape: configuration, seats, the
// applied choices and the thinking settings) and a report card shaped like
// main.cjs teamReport; every edit is read back from the draft, and every host
// call from its recorded payload.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createDom, Element } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/team-models.js", import.meta.url), "utf8");
const flush = async () => { for (let turn = 0; turn < 30; turn += 1) await Promise.resolve(); };
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const CLAUDE = ["low", "medium", "high", "xhigh", "max"];

const SAVED = {
  aiProvider: "zen", aiRoleProviders: { routine: "zen", heavy: "claude" },
  aiModelsByProvider: { zen: { routine: "gpt-6-luna" }, claude: { heavy: "opus" } },
  executorCli: "opencode", executorModels: { opencode: "opencode-go/deepseek-v4.1-flash" },
  agentSeats: { lead: { provider: "zen", model: "gpt-6-luna", effort: "medium", fast: false } },
  agentThinking: { mode: "auto", climb: true, askMax: true, explore: true },
};
const SEATS = {
  lead: { provider: "zen", model: "gpt-6-luna", effort: "medium", fast: false },
  desk: { provider: "zen", model: "gpt-6.1-sol", effort: "medium", fast: false },
  companion: { provider: "zen", model: "gpt-6-luna", effort: "medium", fast: true },
  scout: { provider: "zen", model: "gpt-6-luna", effort: "low", fast: true },
  overseer: { provider: "auto", model: "gpt-6.1-sol", effort: "medium", fast: false },
};
const luna = { ok: true, provider: "zen", model: "gpt-6-luna", efforts: EFFORTS };
const CHOICES = {
  routine: { ...luna, reason: "Selected route" },
  heavy: { ok: true, provider: "claude", model: "opus", efforts: CLAUDE, reason: "Selected route" },
  companion: luna, scout: luna, lead: luna,
  desk: { ok: true, provider: "zen", model: "gpt-6.1-sol", efforts: EFFORTS },
  overseer: { ok: true, provider: "claude", model: "opus", efforts: CLAUDE, inherited: true, reason: "Follows the planning and review route" },
  builder: { ok: true, provider: "opencode", model: "opencode-go/deepseek-v4.1-flash", efforts: ["low", "medium", "high", "max"] },
};
const kind = (taskType, label, wins, settled, verdict) => ({ taskType, label, wins, losses: settled - wins, settled, rate: wins / settled, verdict });
const REPORT = {
  ok: true, thinking: SAVED.agentThinking, selection: "jev",
  builder: { cli: "opencode", model: "opencode-go/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  checked: 275, from: Date.UTC(2026, 8, 23, 12), to: Date.UTC(2026, 8, 30, 12),
  models: [{ key: "opencode::deepseek-v4.1-flash", provider: "opencode", model: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", wins: 122, losses: 153, settled: 275, rate: 122 / 275, kinds: [
    kind("coding-explore", "Exploring a codebase", 8, 44, "weak"),
    kind("coding-fix", "Fixing bugs", 2, 3, "few"),
    kind("coding-implement", "Building features", 52, 77, "good"),
    kind("coding", "General coding", 47, 105, "ok"),
  ] }],
  untried: [{ cli: "claude", model: "opus", name: "Opus" }, { cli: "codex", model: "", name: "Codex's default" }],
  kinds: { "coding-analyze": { cli: "claude", model: "sonnet", name: "Sonnet", label: "Analysing code", by: "studio", trial: { size: 5, left: 3, wins: 1, losses: 1 }, kept: null } },
  suggestions: [{ id: "coding-explore:claude:opus", taskType: "coding-explore", label: "Exploring a codebase", to: { cli: "claude", model: "opus", name: "Opus" }, text: "Send exploring a codebase jobs to Opus on Claude Code.", detail: "DeepSeek V4.1 Flash passes 8 of 44 of them (18%)." }],
};
const ACCOUNTS = { ok: true, providers: [
  { id: "claude", name: "Claude Code", installed: true, max: 6, accounts: [{ id: "claude-main", provider: "claude", label: "Main login", main: true, limited: false, answering: true }] },
  { id: "codex", name: "Codex", installed: false, max: 6, accounts: [{ id: "codex-main", provider: "codex", label: "Main login", main: true }] },
] };

function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
}
function team(configuration = SAVED) {
  return {
    saved: { ok: true, projectId: "p1", revision: 4, configuration: structuredClone(SAVED), seats: structuredClone(SEATS), choices: structuredClone(CHOICES), thinking: structuredClone(SAVED.agentThinking) },
    configuration: structuredClone(configuration), name: "Dungeon team", dirty: false,
  };
}
// One page: the module loaded with a bridge, mounted on a root with a context
// like agents.js hands it (changed() repaints, as renderConfiguration does).
function page({ bridge = {}, ui = {}, item = team(), local = storage(), nav = undefined } = {}) {
  const dom = createDom();
  const calls = [];
  const record = (name, answer) => async (...args) => { calls.push([name, ...structuredClone(args)]); return typeof answer === "function" ? answer(...args) : structuredClone(answer); };
  const api = {
    teamReport: record("teamReport", REPORT), cliAccounts: record("cliAccounts", ACCOUNTS),
    ...Object.fromEntries(Object.entries(bridge).map(([name, answer]) => [name, answer === null ? undefined : record(name, answer)])),
  };
  for (const [name, value] of Object.entries(api)) if (value === undefined) delete api[name];
  const window = { mefiStudio: api, MefiUi: ui, MefiNav: nav, localStorage: local, dispatchEvent() {} };
  const context = vm.createContext({ window, document: dom.document, console, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  const models = window.MefiTeamModels;
  const ctx = {
    changes: 0, went: [], revealed: [], reloads: 0, kinds: 0,
    draft: () => item, projectId: () => "p1",
    changed() { ctx.changes += 1; item.dirty = true; models.render(); },
    // Cloned: an object made inside the vm has the vm's prototypes, which deepStrictEqual compares.
    go: (id, params) => ctx.went.push(structuredClone([id, params])), reveal: (id) => ctx.revealed.push(id),
    reload() { ctx.reloads += 1; return true; }, kindsChanged() { ctx.kinds += 1; },
  };
  const root = new Element("div");
  dom.body.append(root);
  return { dom, window, models, ctx, root, item, calls, local };
}
const mounted = async (options) => { const p = page(options); p.models.mount(p.root, p.ctx); await flush(); return p; };
const text = (el) => el?.textContent ?? "";
const row = (p, job) => p.root.querySelector(`.tm-tr[data-job="${job}"]`);
const cell = (p, job, name) => p.root.querySelector(`.tm-tr[data-job="${job}"] .${name}`);
const press = (p, key, value) => p.root.querySelector(`[data-choice="${key}"] [data-value="${value}"]`).click();
const flip = async (p, key, on) => { const input = p.root.querySelector(`[data-choice="${key}"] input`); input.checked = on; await input.trigger("change"); };
const pick = async (p, job, value) => { const select = p.root.querySelector(`#tm-think-${job}`); select.value = value; await select.trigger("change"); };
const buttonNamed = (root, words) => root.querySelectorAll("button").find((el) => el.textContent === words);

test("Who does what: one row per job, from the draft and the routes the host applied", async () => {
  const item = team({ ...SAVED, agentEfforts: { heavy: "high" } });
  const p = await mounted({ item });
  assert.deepEqual(p.root.querySelectorAll(".tm-tbody .tm-tr").map((el) => el.dataset.job), ["companion", "routine", "heavy", "builder", "lead", "desk", "scout", "overseer"]);
  assert.deepEqual(p.root.querySelectorAll(".tm-td-job b").map(text), ["Talks with you", "Quick answers and checks", "Plans and reviews", "Writes the code", "Leads big jobs", "Unsticks workers", "Finds the starting files", "Watches the whole team"]);
  // Readable names, where each runs, and what each is good for.
  const model = (job) => text(cell(p, job, "tm-td-model"));
  assert.match(model("heavy"), /^Opus 5\.5Claude login · Good for: Planning, review and hard bugs$/);
  assert.match(model("routine"), /^GPT-6 LunaOpenCode Zen · Good for: Reading, checking and quick answers$/);
  assert.match(model("builder"), /^DeepSeek V4\.1 FlashOpenCode Go · Good for: Everyday building at low cost$/);
  assert.match(model("desk"), /^GPT-6\.1 Sol/);
  assert.match(model("overseer"), /^Opus 5\.5Claude login/, "a seat on Automatic shows the route the host resolved");
  assert.equal(cell(p, "heavy", "tm-dot").dataset.provider, "claude");
  // Thinking: the levels each route takes, the owner's own pick marked.
  const options = (job) => p.root.querySelector(`#tm-think-${job}`).children.map((option) => [option.value, option.textContent]);
  assert.deepEqual(options("routine"), [["", "Auto"], ["light", "Light"], ["balanced", "Balanced"], ["deep", "Deep"], ["max", "Max (asks you)"]]);
  assert.deepEqual(options("builder").map(([value]) => value), ["", "light", "balanced", "deep", "max"], "the coding worker always offers the four levels");
  assert.equal(p.root.querySelector("#tm-think-heavy").value, "deep");
  assert.equal(cell(p, "heavy", "tm-set").hidden, false, "You set this under an explicit level");
  assert.equal(cell(p, "routine", "tm-set").hidden, true);
  assert.equal(p.root.querySelector("#tm-think-overseer").hidden, true, "a seat on Automatic takes no level of its own");
  assert.equal(p.root.querySelector(".tm-tr[data-job=\"overseer\"] .tm-none").hidden, false);
  // Results on this PC: the coding worker's record, everyone else not checked by tests.
  assert.equal(text(cell(p, "builder", "tm-td-result")), "122 of 275 passed checks");
  assert.equal(cell(p, "builder", "tm-bar").children[0].style.width, "44%");
  assert.equal(text(cell(p, "routine", "tm-td-result")), "Not checked by tests");
  // Change opens that job's card.
  await buttonNamed(row(p, "desk"), "Change").click();
  assert.deepEqual(p.ctx.revealed, ["desk"]);
  // Right now: who does what in a sentence per model, and the chips.
  assert.equal(text(p.root.querySelector(".tm-lead")), "GPT-6 Luna on OpenCode Zen talks with you, answers quick questions, leads big jobs and finds the starting files. Opus 5.5 on your Claude login plans and reviews and watches the team. DeepSeek V4.1 Flash on OpenCode Go writes the code. GPT-6.1 Sol on OpenCode Zen unsticks workers.");
  assert.equal(text(p.root.querySelector(".tm-lead-2")), "Every job starts with light thinking and thinks harder only when it gets stuck.");
  assert.deepEqual(p.root.querySelectorAll(".tm-chip").map(text), ["Studio picks the best model per job", "Subscriptions first", "1 Claude login"]);
  await buttonNamed(p.root, "Add a second one in Providers").click();
  assert.deepEqual(p.ctx.went, [["agents", { place: "providers", target: "team-subscriptions" }]]);
});

test("a job the draft moved shows the draft's choice until Apply, with the levels its own route takes", async () => {
  const item = team({ ...SAVED, aiRoleProviders: { routine: "claude", heavy: "claude" }, aiModelsByProvider: { ...SAVED.aiModelsByProvider, claude: { heavy: "opus", routine: "haiku" } } });
  const p = await mounted({ item });
  assert.match(text(cell(p, "routine", "tm-td-model")), /^HaikuClaude login/);
  assert.equal(text(cell(p, "routine", "tm-pending")), "After you apply");
  assert.equal(p.root.querySelector("#tm-think-routine").hidden, true, "Haiku on Claude Code takes no thinking level");
  assert.equal(cell(p, "heavy", "tm-pending"), null, "an unchanged job shows no marker");
});

test("the six choices write the team fields, and their hints follow", async () => {
  const p = await mounted();
  const config = () => p.item.configuration, hint = (key) => text(p.root.querySelector(`[data-choice="${key}"] .tm-hint`));
  assert.equal(p.root.querySelector('[data-choice="pick"] [data-value="jev"]').getAttribute("aria-pressed"), "true");
  await press(p, "pick", "fixed");
  assert.equal(config().modelSelection, "fixed");
  assert.equal(hint("pick"), "Studio uses exactly the models below for every kind of job.");
  assert.equal(hint("explore"), "Only while Pick models for me is on Auto.");
  assert.equal(p.root.querySelector('[data-choice="pick"] [data-value="fixed"]').getAttribute("aria-pressed"), "true");
  await press(p, "mode", "deep");
  assert.deepEqual({ ...config().agentThinking }, { mode: "deep", climb: true, askMax: true, explore: true });
  assert.equal(hint("mode"), "Always deep. Best for hard work, heavy on your plan.");
  assert.equal(hint("climb"), "After two misses, a stronger model takes the job. Thinking stays deep.", "with a fixed level Step up only moves the model");
  assert.equal(p.root.querySelector("#tm-think-routine").value, "deep", "a job with no level of its own follows the team's fixed level");
  await press(p, "climb", "same");
  assert.equal(config().agentThinking.climb, false);
  assert.equal(hint("climb"), "Retries use the same model and thinking. A job that keeps failing waits for you.");
  assert.equal(p.root.querySelector(".tm-rungs").dataset.climb, "off");
  await flip(p, "askMax", false);
  assert.equal(config().agentThinking.askMax, false);
  assert.equal(p.root.querySelector("#tm-think-builder").children.at(-1).textContent, "Max", "Max asks you only while the ask is on");
  await flip(p, "explore", false);
  assert.equal(config().agentThinking.explore, false);
  await flip(p, "subs", false);
  assert.equal(config().aiSubscriptionFirst, false);
  assert.equal(hint("subs"), "Studio follows your provider order, keys included.");
  assert.deepEqual(p.root.querySelectorAll(".tm-chip").slice(0, 2).map(text), ["You pick each model", "Your provider order first"]);
  assert.deepEqual(Object.keys(config().agentThinking).sort(), ["askMax", "climb", "explore", "mode"], "only the four fields agent-profiles accepts");
  assert.equal(p.ctx.changes, 6, "each choice marks the draft dirty once");
  // Pressing the chosen value again changes nothing.
  await press(p, "pick", "fixed");
  assert.equal(p.ctx.changes, 6);
});

test("each job's thinking writes its effort: roles and the coding worker by role, seats on the seat", async () => {
  const p = await mounted();
  await pick(p, "routine", "deep");
  assert.equal(p.item.configuration.agentEfforts.routine, "high");
  await pick(p, "builder", "max");
  assert.equal(p.item.configuration.agentEfforts.builder, "max");
  await pick(p, "lead", "light");
  assert.deepEqual({ ...p.item.configuration.agentSeats.lead }, { provider: "zen", model: "gpt-6-luna", effort: "low", fast: false });
  await pick(p, "companion", "balanced");
  assert.equal(p.item.configuration.agentSeats.companion.effort, "medium");
  assert.equal(p.item.configuration.agentSeats.companion.model, "gpt-6-luna", "the seat keeps its route");
  await pick(p, "routine", "");
  assert.equal(p.item.configuration.agentEfforts.routine, "", "Auto clears the owner's level");
  assert.equal(cell(p, "builder", "tm-set").hidden, false);
  assert.equal(p.ctx.changes, 5);
});

test("the report card: verdicts best first, what has not been tried, and the routes on trial", async () => {
  const p = await mounted();
  assert.deepEqual(p.calls.filter(([name]) => name === "teamReport"), [["teamReport", { projectId: "p1" }]]);
  assert.match(text(p.root.querySelector("#tm-report .tm-sub")), /^275 checked tasks on this PC, /);
  assert.match(text(p.root.querySelector(".tm-rc-model .tm-model")), /^DeepSeek V4\.1 FlashOpenCode Go · 275 checked$/);
  assert.deepEqual(p.root.querySelectorAll(".tm-skill").map((el) => el.dataset.kind), ["coding-implement", "coding", "coding-explore", "coding-fix"]);
  assert.deepEqual(p.root.querySelectorAll(".tm-verdict").map(text), ["Good · 68%", "OK · 45%", "Weak · 18%", "Too few to tell"]);
  assert.deepEqual(p.root.querySelectorAll(".tm-verdict").map((el) => el.dataset.verdict), ["good", "ok", "weak", "few"]);
  assert.equal(text(p.root.querySelector(".tm-skill .tm-skill-k small")), "52 of 77 passed");
  assert.equal(text(p.root.querySelector(".tm-untried")), "Not tried for coding yet: Opus (Claude login) and Codex's default (ChatGPT login). Studio has built with one model so far, so it has had nothing to compare.");
  assert.equal(text(p.root.querySelector(".tm-route-words")), "Analysing code → Sonnet (trying, 2 of 5 done)");
  assert.match(text(p.root.querySelector(".tm-idea")), /^SuggestionSend exploring a codebase jobs to Opus on Claude Code\./);
});

test("the report card's empty state, and a bridge without the report", async () => {
  const empty = await mounted({ bridge: { teamReport: { ok: true, checked: 0, models: [], untried: [], kinds: {}, suggestions: [] } } });
  assert.equal(text(empty.root.querySelector(".tm-report-body")), "Results show up here after Studio checks a few coding tasks.");
  assert.equal(empty.root.querySelector("#tm-report .tm-sub").hidden, true);
  assert.equal(text(cell(empty, "builder", "tm-td-result")), "No checked results yet");
  const missing = await mounted({ bridge: { teamReport: null, cliAccounts: null } });
  assert.equal(text(missing.root.querySelector(".tm-report-body")), "Results show up here after Studio checks a few coding tasks.");
  assert.equal(missing.root.querySelectorAll(".tm-chip").length, 2, "no logins chip without the logins call");
  const refused = await mounted({ bridge: { teamReport: { ok: false, error: "The report card could not be read: disk" } } });
  assert.match(text(refused.root.querySelector(".tm-report-body")), /^The results could not be read\. Try again$/);
});

test("Try it starts a trial, Not now remembers, Stop sends the kind back: each with the right payload", async () => {
  const after = { ...structuredClone(REPORT), suggestions: [], kinds: { ...REPORT.kinds, "coding-explore": { cli: "claude", model: "opus", name: "Opus", label: "Exploring a codebase", by: "owner", trial: { size: 5, left: 5, wins: 0, losses: 0 }, kept: null } } };
  const p = await mounted({ bridge: { teamKindRoute: after } });
  await p.root.querySelector('[data-suggestion="coding-explore:claude:opus"] button.primary').click();
  await flush();
  assert.deepEqual(p.calls.filter(([name]) => name === "teamKindRoute"), [["teamKindRoute", { projectId: "p1", taskType: "coding-explore", cli: "claude", model: "opus", trial: true }]]);
  assert.equal(p.ctx.kinds, 1, "the draft takes the new routes");
  assert.equal(p.root.querySelector(".tm-idea"), null, "the fresh report has no suggestion left");
  assert.deepEqual(p.root.querySelectorAll(".tm-route-words").map(text), ["Analysing code → Sonnet (trying, 2 of 5 done)", "Exploring a codebase → Opus (trying, 0 of 5 done)"]);
  assert.match(text(p.root.querySelector("#tm-report .tm-say")), /^Trying Opus on the next 5 jobs of this kind \(exploring a codebase\)\./);
  await buttonNamed(p.root.querySelector('.tm-route[data-kind="coding-analyze"]'), "Stop").click();
  await flush();
  assert.deepEqual(p.calls.filter(([name]) => name === "teamKindRoute").at(-1), ["teamKindRoute", { projectId: "p1", taskType: "coding-analyze", clear: true }]);
  assert.equal(p.ctx.kinds, 2);

  const local = storage();
  const later = await mounted({ local });
  await buttonNamed(later.root.querySelector(".tm-idea"), "Not now").click();
  assert.equal(later.root.querySelector(".tm-idea"), null);
  assert.deepEqual(JSON.parse(local.map.get("mefiStudio.teamModels.notNow")), ["coding-explore:claude:opus"]);
  assert.equal(later.calls.filter(([name]) => name === "teamKindRoute").length, 0);
  const again = await mounted({ local });
  assert.equal(again.root.querySelector(".tm-idea"), null, "the dismissal outlives the visit");

  const refusing = await mounted({ bridge: { teamKindRoute: { ok: false, error: "That model cannot take a kind of job." } } });
  await refusing.root.querySelector(".tm-idea button.primary").click();
  await flush();
  assert.equal(text(refusing.root.querySelector("#tm-report .tm-say")), "That model cannot take a kind of job.");
  assert.equal(refusing.root.querySelector("#tm-report .tm-say").dataset.tone, "bad");
  assert.equal(refusing.ctx.kinds, 0);
});

test("a job's line and its picker survive its own change, so the focus stays where it was", async () => {
  const p = await mounted();
  const line = row(p, "routine"), select = p.root.querySelector("#tm-think-routine");
  await pick(p, "routine", "balanced");
  assert.equal(row(p, "routine"), line);
  assert.equal(p.root.querySelector("#tm-think-routine"), select);
  assert.equal(select.value, "balanced");
  const tryIt = p.root.querySelector(".tm-idea button.primary");
  await press(p, "mode", "light");
  assert.equal(p.root.querySelector(".tm-idea button.primary"), tryIt, "a draft edit leaves the report card's buttons alone");
});

test("a second failure in a row still says why, not Saving", async () => {
  const p = await mounted({ bridge: { teamKindRoute: { ok: false, error: "The active project changed." } } });
  for (let turn = 0; turn < 2; turn += 1) {
    await p.root.querySelector(".tm-idea button.primary").click();
    await flush();
    assert.equal(text(p.root.querySelector("#tm-report .tm-say")), "The active project changed.");
    assert.equal(p.root.querySelector(".tm-idea button.primary").disabled, false, "Try it can be pressed again");
  }
});

test("Search finds the new parts by their Team place and opens the place at them", async () => {
  const entries = [];
  const p = page({ nav: { register(entry) { entries.push(entry); return entry; } } });
  p.models.mount(p.root, p.ctx);
  const providers = new Element("div");
  p.dom.body.append(providers);
  p.models.providers(providers, p.ctx);
  await flush();
  assert.deepEqual(entries.map((entry) => [entry.id, entry.label]), [
    ["settings:tm-choice-pick", "Team › Seats and models › Pick models for me"],
    ["settings:tm-choice-mode", "Team › Seats and models › How hard to think"],
    ["settings:tm-choice-climb", "Team › Seats and models › When a job gets stuck"],
    ["settings:tm-choice-askMax", "Team › Seats and models › Ask me before Max thinking"],
    ["settings:tm-choice-explore", "Team › Seats and models › Try other models now and then"],
    ["settings:tm-choice-subs", "Team › Seats and models › Use my subscriptions first"],
    ["settings:tm-who-title", "Team › Seats and models › Who does what"],
    ["settings:tm-report-title", "Team › Seats and models › Report card"],
    ["settings:tm-ladder-title", "Team › Seats and models › How thinking works"],
    ["settings:team-one-provider-pick", "Team › Providers › Use one provider for everything"],
    ["settings:team-subscriptions", "Team › Providers › Your subscriptions"],
  ]);
  assert.ok(entries.every((entry) => entry.desc.length <= 160 && entry.showIn.palette === true));
  entries[1].run(); entries.at(-1).run();
  assert.deepEqual(p.ctx.went, [["agents", { place: "seats", target: "tm-choice-mode" }], ["agents", { place: "providers", target: "team-subscriptions" }]]);
  assert.equal(p.root.querySelector("#tm-choice-mode").tabIndex, -1, "the target takes the focus openTeam gives it");
});

test("the ladder marks where a job starts", async () => {
  const p = await mounted({ item: team({ ...SAVED, agentThinking: { mode: "balanced", climb: true, askMax: false, explore: true } }) });
  const rungs = p.root.querySelectorAll(".tm-rung");
  assert.deepEqual(rungs.map((el) => text(el.querySelector("b"))), ["Light", "Balanced", "Stronger model", "Deep", "Max"]);
  assert.equal(rungs[1].getAttribute("aria-current"), "step");
  assert.equal(text(p.root.querySelector(".tm-lead-2")), "Every job thinks at a balanced level.");
});

test("tip() uses the shared MefiUi.info when it is there, and a focusable i otherwise", () => {
  const plainPage = page();
  const fallback = plainPage.models.tip("Starts light.", "About thinking");
  assert.equal(fallback.className, "tm-tip");
  assert.equal(fallback.textContent, "i");
  assert.equal(fallback.tabIndex, 0);
  assert.equal(fallback.title, "Starts light.");
  assert.equal(fallback.getAttribute("aria-label"), "About thinking: Starts light.");
  const asked = [];
  const shared = page({ ui: { info(content, options) { asked.push([content, { ...options }]); const el = new Element("button"); el.className = "shared-info"; return el; } } });
  assert.equal(shared.models.tip("Starts light.", "About thinking").className, "shared-info");
  assert.deepEqual(asked, [["Starts light.", { label: "About thinking" }]]);
});

test("model names, where they run and what they are good for", () => {
  const { models } = page();
  assert.equal(models.modelName("claude-opus-5-5", "claude"), "Opus 5.5");
  assert.equal(models.modelName("opus", "claude"), "Opus 5.5");
  assert.equal(models.modelName("gpt-6-luna", "zen"), "GPT-6 Luna");
  assert.equal(models.modelName("opencode-go/deepseek-v4.1-flash", "opencode"), "DeepSeek V4.1 Flash");
  assert.equal(models.modelName("openai/gpt-7-nova", "openrouter"), "GPT-7 Nova", "an unknown id is tidied");
  assert.equal(models.modelName("kimi-k2.6", "opencode"), "Kimi K2.6");
  assert.equal(models.modelName("Tool default", "claude"), "Claude Code's default");
  assert.equal(models.modelName("", "auto"), "Picked automatically");
  assert.equal(models.viaOf("opencode", "opencode/kimi-k2.6", { builder: true }).name, "OpenCode Zen");
  assert.equal(models.viaOf("opencode", "deepseek-v4.1-flash", { builder: true }).name, "OpenCode Go");
  assert.equal(models.viaOf("mystery").name, "mystery");
  assert.equal(models.goodFor("sonnet", "claude", { builder: true }), "Everyday building with its own tools");
  assert.equal(models.goodFor("sonnet", "claude"), "Balanced building and writing");
  assert.equal(models.goodFor("glm-5.3", "zai"), "Tidying, summaries and small fixes");
  assert.equal(models.ledgerKey("claude", ""), "claude::claude-default");
  assert.equal(models.ledgerKey("opencode", "opencode-go/deepseek-v4.1-flash"), "opencode::deepseek-v4.1-flash");
  assert.equal(models.ledgerKey("opencode", "mefi-zai/glm-5.3"), "zai::glm-5.3");
});

test("Providers: one provider for everything is checked before it is used, and the logins list adds, signs in and asks before removing", async () => {
  const armed = [];
  const arm = (button, { run, armed: words }) => { button.addEventListener("click", (event) => { if (!button.dataset.armed) { button.dataset.armed = "1"; armed.push(words); return; } delete button.dataset.armed; return run(event); }); return button; };
  const accounts = structuredClone(ACCOUNTS);
  accounts.providers[0].accounts.push({ id: "claude-ab12cd", provider: "claude", label: "Login 2", main: false, limited: true, untilText: "6 pm" });
  const p = page({ ui: { arm }, bridge: {
    cliSetupStatus: { ok: true, clis: [{ id: "claude", name: "Claude Code", installed: true, signedIn: true, subscription: true }, { id: "codex", name: "Codex", installed: false, signedIn: null, subscription: true }, { id: "opencode", name: "OpenCode", installed: true, subscription: false }] },
    cliSetupCheck: { ok: true, message: "Connection works. You can use this subscription for the whole studio." },
    cliSetupUse: { ok: true, provider: "claude", message: "Your subscription now handles chat, mapping, planning, agent roles and coding." },
    cliAccounts: accounts,
    cliAccountAdd: { ok: true, account: { id: "claude-ef34gh", provider: "claude", label: "Login 3" } },
    cliAccountLogin: { ok: true, message: "Sign-in window opened." },
    cliAccountRemove: { ok: true, message: "Login 2 removed." },
  } });
  const root = new Element("div");
  p.dom.body.append(root);
  p.models.providers(root, p.ctx);
  p.models.openProviders();
  await flush();
  const select = root.querySelector("#team-one-provider-pick");
  assert.deepEqual(select.children.map((option) => [option.value, option.textContent]), [["claude", "Claude Code"], ["codex", "Codex · not installed"]], "subscription tools only");
  assert.equal(select.value, "claude");
  const use = buttonNamed(root, "Use for everything"), check = buttonNamed(root, "Check");
  assert.equal(use.disabled, true, "Use waits for a check");
  await check.click(); await flush();
  assert.deepEqual(p.calls.filter(([name]) => name === "cliSetupCheck"), [["cliSetupCheck", "claude"]]);
  assert.equal(use.disabled, false);
  await use.click(); await flush();
  assert.deepEqual(p.calls.filter(([name]) => name === "cliSetupUse"), [["cliSetupUse", "claude"]]);
  assert.equal(text(root.querySelector("#team-one-provider .tm-say")), "Your subscription now handles chat, mapping, planning, agent roles and coding.");
  assert.equal(p.ctx.reloads, 1, "the team is read again");
  // Your subscriptions: Claude Code only (Codex is not installed and has one login).
  assert.deepEqual(root.querySelectorAll(".tm-login-title").map(text), ["Claude Code"]);
  assert.deepEqual(root.querySelectorAll(".tm-login").map((el) => text(el.querySelector(".tm-login-words"))), ["Main loginAnswering now", "Login 2Topped out until 6 pm"]);
  assert.equal(buttonNamed(root.querySelector('[data-account="claude-main"]'), "Remove"), undefined, "the main login stays");
  await buttonNamed(root, "Add another Claude Code login").click(); await flush();
  assert.deepEqual(p.calls.filter(([name]) => ["cliAccountAdd", "cliAccountLogin"].includes(name)), [["cliAccountAdd", { provider: "claude", label: "" }], ["cliAccountLogin", "claude-ef34gh"]]);
  const remove = buttonNamed(root.querySelector('[data-account="claude-ab12cd"]'), "Remove");
  await remove.click(); await flush();
  assert.deepEqual(armed, ["Remove this login?"]);
  assert.equal(p.calls.filter(([name]) => name === "cliAccountRemove").length, 0, "the first press only asks");
  await remove.click(); await flush();
  assert.deepEqual(p.calls.filter(([name]) => name === "cliAccountRemove"), [["cliAccountRemove", "claude-ab12cd"]]);
});

test("Providers without the setup calls says so instead of failing", async () => {
  const p = page({ bridge: { cliAccounts: null } });
  const root = new Element("div");
  p.dom.body.append(root);
  p.models.providers(root, p.ctx);
  p.models.openProviders();
  await flush();
  assert.equal(text(root.querySelector("#team-one-provider .tm-pill")), "Desktop app only");
  assert.equal(buttonNamed(root, "Check").disabled, true);
  assert.equal(buttonNamed(root, "Use for everything").disabled, true);
  assert.match(text(root.querySelector(".tm-login-groups")), /^No Claude Code or Codex sign-in on this PC yet\./);
});
