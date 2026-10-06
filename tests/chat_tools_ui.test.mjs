// The chat's chip at the message box (renderer/chat-tools.js) and the Skills page's "How skills are used"
// (renderer/skills.js useNode), in a bare context with the shared fake DOM and a recording bridge: what the chip
// says, what its menu offers and sends (a style, the chat's "picks skills by itself", a connector for the chat),
// the chips under a reply, and the per-place choices on the Skills page. Real geometry is the Electron
// fixtures' (today_render, sessions_render, team_render).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createDom, Element } from "./fixtures/renderer-dom.mjs";

const chatSource = readFileSync(new URL("../renderer/chat-tools.js", import.meta.url), "utf8");
const skillsSource = readFileSync(new URL("../renderer/skills.js", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const words = (node) => node.textContent.replace(/\s+/g, " ").trim();

const STYLES = [
  { name: "eli5", title: "Explain like I'm 5", short: "ELI5", description: "Plain words a five-year-old could follow." },
  { name: "brief", title: "Short answers", short: "Short", description: "One or two sentences." },
];
function chatEnvironment(view = {}) {
  const dom = createDom();
  const calls = [], toasts = [], registered = [], nav = [];
  const state = { view: { ok: true, styles: STYLES, style: ["eli5"], auto: true, picks: [{ name: "bug-triage", title: "bug-triage", description: "Reproduce a bug" }], tools: { webSearch: true, webRead: true, projectRead: false }, connectors: [{ id: "github", title: "GitHub", status: "ready", places: ["builders"], on: false, tools: 8 }, { id: "memory", title: "Memory", status: "needs-approval", places: ["builders"], on: false, tools: 0 }], editable: true, ...view } };
  const bridge = {
    chatTools: async () => { calls.push(["chatTools"]); return structuredClone(state.view); },
    skillsSetUse: async (payload) => {
      calls.push(["skillsSetUse", plain(payload)]);
      if (Object.hasOwn(payload, "style")) state.view.style = payload.style ? [payload.style] : [];
      if (typeof payload.auto === "boolean") state.view.auto = payload.auto;
      return { ok: true };
    },
    connectorsUpdate: async (payload) => { calls.push(["connectorsUpdate", plain(payload)]); const row = state.view.connectors.find((item) => item.id === payload.id); row.places = payload.places; row.on = payload.places.includes("chat"); return { ok: true }; },
    onSettingsChanged: () => {},
  };
  const window = {
    mefiStudio: bridge, addEventListener() {},
    MefiToast: (text, tone = "good") => toasts.push({ text, tone }),
    MefiNav: { register: (entry) => registered.push(entry), go: (...args) => nav.push(args) },
  };
  vm.runInNewContext(chatSource, { window, document: dom.document, Array, JSON, Promise, String, Number, Math, Set, Map, Date, Error, Object, setTimeout, clearTimeout });
  return { dom, window, calls, toasts, registered, nav, state, tools: window.MefiChatTools };
}
const chipOf = (root) => root.querySelector(".chat-tools-chip");
const menuOf = (root) => root.querySelector(".chat-tools-popover");

test("the chip says the chat's style, and its menu offers the styles, the skills switch, the tools and the connectors", async () => {
  const t = chatEnvironment();
  const root = new Element("span", "vibe-chat-tools");
  t.tools.mount(root, { id: "vibe-chat-tools-chip" });
  assert.equal(chipOf(root).id, "vibe-chat-tools-chip");
  assert.equal(words(chipOf(root)), "Answer style", "before the host answered");
  await settle();
  assert.equal(words(chipOf(root)), "ELI5");
  assert.match(chipOf(root).title, /Mefi answers: Explain like I'm 5/);
  assert.equal(menuOf(root).hidden, true);
  await chipOf(root).click();
  assert.equal(menuOf(root).hidden, false); assert.equal(chipOf(root).getAttribute("aria-expanded"), "true");
  const radios = root.querySelectorAll(".chat-tools-style");
  assert.deepEqual(radios.map((radio) => radio.dataset.style), ["plain", "eli5", "brief"]);
  assert.deepEqual(radios.map((radio) => radio.getAttribute("aria-checked")), ["false", "true", "false"]);
  assert.match(words(menuOf(root)), /Use my skills when they fit/);
  assert.match(words(menuOf(root)), /It can pick from 1 skill: bug-triage/);
  assert.match(words(menuOf(root)), /Search the web: on/); assert.match(words(menuOf(root)), /Read project files: off/);
  assert.match(words(menuOf(root)), /GitHub8 tools/); assert.match(words(menuOf(root)), /Waiting for your approval in Connectors/);
  assert.match(words(menuOf(root)), /Type \/ in the box to use any skill for one message/);
  assert.equal(t.registered[0].id, "chat-style", "Search can open it");
});

test("choosing a style, plain answers, the skills switch and a connector send exactly that, and the chip follows", async () => {
  const t = chatEnvironment();
  const root = new Element("span", "today-build-chat-tools");
  t.tools.mount(root, { id: "today-build-chat-tools-chip" });
  await settle();
  await chipOf(root).click();
  await root.querySelectorAll(".chat-tools-style").find((radio) => radio.dataset.style === "brief").click();
  await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "skillsSetUse").map(([, payload]) => payload), [{ style: "brief" }]);
  assert.equal(words(chipOf(root)), "Short");
  assert.match(t.toasts.at(-1).text, /Mefi now answers: Short answers/);
  assert.equal(menuOf(root).hidden, false, "the menu stays open across the repaint");
  await root.querySelectorAll(".chat-tools-style").find((radio) => radio.dataset.style === "plain").click();
  await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "skillsSetUse").at(-1)[1], { style: null });
  assert.equal(words(chipOf(root)), "Plain answers");
  // Pressing the style already in force sends nothing.
  const before = t.calls.length;
  await root.querySelectorAll(".chat-tools-style").find((radio) => radio.dataset.style === "plain").click();
  assert.equal(t.calls.length, before);
  // The skills switch and a connector.
  const switches = root.querySelectorAll(".chat-tools-switch");
  switches[0].checked = false; await switches[0].trigger("change"); await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "skillsSetUse").at(-1)[1], { place: "chat", auto: false });
  const github = root.querySelectorAll(".chat-tools-switch")[1];
  assert.equal(github.disabled, false);
  github.checked = true; await github.trigger("change"); await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "connectorsUpdate")[1], { id: "github", places: ["builders", "chat"] });
  assert.equal(root.querySelectorAll(".chat-tools-switch")[2].disabled, false, "a connector waiting for approval still shows, its switch leads nowhere harmful");
  // The links go where they say.
  await root.querySelectorAll(".chat-tools-link").find((link) => link.textContent === "Connectors").click();
  assert.deepEqual(plain(t.nav.at(-1)), ["agents", { place: "connectors" }]);
  assert.equal(menuOf(root).hidden, true, "following a link closes the menu");
});

test("a failed save says why and leaves the chip as it was", async () => {
  const t = chatEnvironment();
  t.window.mefiStudio.skillsSetUse = async () => ({ ok: false, error: "Choose one of the answer styles." });
  const root = new Element("span");
  t.tools.mount(root, {});
  await settle(); await chipOf(root).click();
  await root.querySelectorAll(".chat-tools-style").find((radio) => radio.dataset.style === "brief").click();
  await settle();
  assert.deepEqual(t.toasts.at(-1), { text: "Choose one of the answer styles.", tone: "bad" });
  assert.equal(words(chipOf(root)), "ELI5");
});

test("used() draws what a reply used, and nothing for a reply that used nothing", () => {
  const t = chatEnvironment();
  const row = t.tools.used({ role: "assistant", used: [{ kind: "skill", name: "eli5", label: "Explain like I'm 5" }, { kind: "skill", name: "bug-triage", label: "bug-triage", loaded: true }, { kind: "tool", name: "web_search", label: "Searched the web", ok: true, count: 2 }, { kind: "tool", name: "mcp__github__list_issues", label: "github: list issues", ok: false }] });
  assert.equal(row.className, "chat-used");
  const chips = row.querySelectorAll(".chat-used-chip");
  assert.deepEqual(chips.map((chip) => words(chip)), ["Explain like I'm 5", "bug-triage", "Searched the web ×2", "github: list issues"]);
  assert.deepEqual(chips.map((chip) => chip.className), ["chat-used-chip is-skill", "chat-used-chip is-skill", "chat-used-chip is-tool", "chat-used-chip is-tool is-failed"]);
  assert.match(chips[1].title, /loaded the skill bug-triage/);
  assert.equal(t.tools.used({ role: "assistant", used: [] }), null);
  assert.equal(t.tools.used({ role: "user", used: [{ kind: "skill", name: "x", label: "x" }] }), null);
  assert.equal(t.tools.used(null), null);
});

// ---- the Skills page's "How skills are used" -------------------------------------------------------------
function skillsEnvironment() {
  const dom = createDom({ fromTemplate: /^skills-/ });
  dom.get("skills-overlay").hidden = true;
  const calls = [], toasts = [];
  let use = {
    ok: true, places: ["chat", "agents", "builders"], auto: { chat: true, agents: true, builders: true },
    skills: [
      { name: "bug-triage", title: "bug-triage", kind: "skill", scope: "project", chars: 900, uses: { chat: "auto", agents: "auto", builders: "auto" }, chosen: { chat: null, agents: null, builders: null }, defaults: { chat: "auto", agents: "auto", builders: "auto" } },
      { name: "eli5", title: "Explain like I'm 5", kind: "style", scope: "builtin", chars: 700, uses: { chat: "always", agents: "call", builders: "call" }, chosen: { chat: null, agents: null, builders: null }, defaults: { chat: "always", agents: "call", builders: "call" } },
    ],
  };
  const bridge = {
    skillsList: async () => ({ ok: true, dir: ".agents/skills", writable: true, skills: [{ name: "bug-triage", bytes: 900, updatedAt: 1, path: ".agents/skills/bug-triage/SKILL.md", description: "Reproduce a bug", editable: true, loadsByItself: true }], others: [], starters: [] }),
    skillsUse: async () => { calls.push(["skillsUse"]); return structuredClone(use); },
    skillsSetUse: async (payload) => {
      calls.push(["skillsSetUse", plain(payload)]);
      if (payload.name) { const row = use.skills.find((skill) => skill.name === payload.name); row.chosen[payload.place] = payload.use === "default" ? null : payload.use; row.uses[payload.place] = payload.use === "default" ? row.defaults[payload.place] : payload.use; }
      if (typeof payload.auto === "boolean") use.auto[payload.place] = payload.auto;
      return structuredClone(use);
    },
    skillsCopyBuiltin: async (name) => { calls.push(["skillsCopyBuiltin", name]); return { ok: true, skill: { name } }; },
  };
  const window = { mefiStudio: bridge, addEventListener() {}, MefiNav: { claim() {}, release() {}, close() {} }, MefiToast: (text, tone = "good") => toasts.push({ text, tone }), MefiWorkspace: { activeProjectId: () => "p" }, MefiUi: { plainError: (error, fallback) => error?.message || error || fallback } };
  vm.runInNewContext(skillsSource, { window, document: dom.document, Array, JSON, Promise, String, Number, Math, Set, Map, Date, TextEncoder, Error, Object, requestAnimationFrame: (fn) => fn(), setTimeout, clearTimeout });
  return { dom, calls, toasts, page: window.MefiSkills, list: () => dom.get("skills-list") };
}

test("the Skills page shows how each skill is used in each place, and sends one choice at a time", async () => {
  const t = skillsEnvironment();
  t.page.open({ focus: false });
  await settle(); await settle();
  const section = t.list().querySelector("#skills-use");
  assert.ok(section, "the section is there when the host answers skills:use");
  const rows = section.querySelectorAll(".skills-use-row");
  assert.deepEqual(rows.map((row) => row.dataset.skill), ["bug-triage", "eli5"]);
  assert.equal(t.list().querySelectorAll(".skills-list .skills-row").length, 1, "the project's own rows are as they were");
  const selects = (row) => row.querySelectorAll(".skills-use-select");
  assert.deepEqual(selects(rows[1]).map((select) => select.value), ["always", "call", "call"]);
  assert.match(words(rows[1]), /Answer style, built into Studio/);
  // One choice.
  const builders = selects(rows[0])[2];
  builders.value = "always"; await builders.trigger("change"); await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "skillsSetUse").at(-1)[1], { name: "bug-triage", place: "builders", use: "always" });
  assert.match(t.toasts.at(-1).text, /\/bug-triage in builders: always on/);
  // Back to its default forgets the choice.
  const again = selects(t.list().querySelector("#skills-use").querySelectorAll(".skills-use-row")[0])[2];
  again.value = "auto"; await again.trigger("change"); await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "skillsSetUse").at(-1)[1], { name: "bug-triage", place: "builders", use: "default" });
  // A place's switch.
  const chatSwitch = t.list().querySelector("#skills-use-auto").querySelectorAll("input")[0];
  chatSwitch.checked = false; await chatSwitch.trigger("change"); await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "skillsSetUse").at(-1)[1], { place: "chat", auto: false });
  // Copy a built-in one into the project.
  const copy = t.list().querySelector("#skills-use").querySelectorAll(".skills-use-row")[1].querySelectorAll("button").find((button) => button.textContent === "Copy to this project");
  assert.equal(copy.disabled, false);
  await copy.click(); await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "skillsCopyBuiltin"), ["skillsCopyBuiltin", "eli5"]);
});
