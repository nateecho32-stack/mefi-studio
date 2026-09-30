import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDom } from "./fixtures/renderer-dom.mjs";
import { zipDirectory } from "../scripts/release-updater.mjs";

// The Skills page (renderer/skills.js) in a bare context with the shared fake DOM and the template's own
// ids, talking to the REAL host module (scripts/skills.cjs) over a temporary project: what the page lists,
// the editor and what it says as you type, create, edit, delete (asked twice), starters, import, export, the
// read-only state, a project change, and that the page sends names and text and never a path. Real geometry
// is checked by tests/skills_render.test.mjs in a real window.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../renderer/skills.js", import.meta.url), "utf8");
const { createSkills } = require("../scripts/skills.cjs");
const format = require("../scripts/skill-format.cjs");
const addons = require("../scripts/agent-addons.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));
// Wait for the bridge calls in flight (real files, so real time) and the page's own follow-up.
let inflight = 0;
const settle = async () => {
  const deadline = Date.now() + 10000;
  for (let quiet = 0; quiet < 4 && Date.now() < deadline;) {
    await new Promise((resolve) => (inflight ? setTimeout(resolve, 1) : setImmediate(resolve)));
    quiet = inflight ? 0 : quiet + 1;
  }
};

async function environment({ enabled = true, bridge = {}, noBridge = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-skills-ui-"));
  const project = path.join(root, "project"), keep = path.join(root, "kept"), away = path.join(root, "away"), home = path.join(root, "home");
  for (const folder of [project, away, home]) await mkdir(folder, { recursive: true });
  let on = enabled;
  const host = createSkills({ root: () => project, enabled: () => on, backups: () => keep, inventory: (given) => addons.inventory(given, { home }), zip: zipDirectory });
  const dom = createDom({ fromTemplate: /^skills-/ });
  dom.get("skills-overlay").hidden = true;
  const calls = [];
  const toasts = [], nav = [];
  let activeProject = "project-a";
  let importChoice = { canceled: true }, exportTarget = null;
  const record = (name, run) => async (...args) => { calls.push({ name, args: plain(args) }); inflight += 1; try { return await run(...args); } finally { inflight -= 1; } };
  const bridgeStub = noBridge ? undefined : {
    skillsList: record("skillsList", () => host.list()),
    skillsRead: record("skillsRead", (name) => host.read(name)),
    skillsSave: record("skillsSave", (draft) => host.save(draft)),
    skillsCreate: record("skillsCreate", (draft) => host.create(draft)),
    skillsDelete: record("skillsDelete", (name) => host.delete(name)),
    skillsImport: record("skillsImport", async () => (importChoice.canceled ? { ok: false, canceled: true } : importChoice.error ? { ok: false, error: importChoice.error } : host.importFrom(importChoice.folder))),
    skillsExport: record("skillsExport", async ({ name, kind }) => (exportTarget ? host.exportTo({ name, target: exportTarget, kind }) : { ok: false, canceled: true })),
    ...bridge,
  };
  const window = {
    mefiStudio: bridgeStub, addEventListener() {},
    MefiNav: { claim: (id) => nav.push(["claim", id]), release: (id) => nav.push(["release", id]), close: (id) => nav.push(["close", id]) },
    MefiToast: (text, tone = "good") => toasts.push({ text, tone }),
    MefiWorkspace: { activeProjectId: () => activeProject },
    MefiUi: {
      plainError: (error, fallback) => (typeof error === "string" && error ? error : error?.message || fallback),
      // Asked twice: the first press changes the label and runs nothing.
      arm: (button, { run, armed }) => { let ready = false; const label = button.textContent; button.addEventListener("click", () => { if (!ready) { ready = true; button.textContent = armed; return; } ready = false; button.textContent = label; run(); }); },
    },
  };
  vm.runInNewContext(source, { window, document: dom.document, Array, JSON, Promise, String, Number, Math, Set, Map, Date, TextEncoder, Error, requestAnimationFrame: (fn) => fn(), setTimeout, clearTimeout });
  const $ = (id) => dom.get(`skills-${id}`);
  const q = (selector) => $("list").querySelector(selector);
  const qa = (selector) => $("list").querySelectorAll(selector);
  const rows = () => qa(".skills-list .skills-row").filter((row) => !row.classList.contains("skills-starter"));
  const rowOf = (name) => rows().find((row) => row.dataset.name === name);
  const buttonOf = (row, label) => row.querySelectorAll("button").find((button) => button.textContent === label);
  const starters = () => qa(".skills-starter").map((row) => row.dataset.name);
  const type = async (control, value) => { control.value = value; await control.trigger("input", {}); await control.trigger("blur", {}); };
  const open = async () => { window.MefiSkills.open({ focus: false }); await settle(); };
  const put = async (name, text) => { await mkdir(path.join(project, ".agents", "skills", name), { recursive: true }); await writeFile(path.join(project, ".agents", "skills", name, "SKILL.md"), text ?? format.build({ name, description: `About ${name}`, body: "Steps." })); };
  return { window, dom, $, q, qa, rows, rowOf, buttonOf, starters, type, open, put, calls, toasts, nav, host, root, project, keep, away, home, off: () => { on = false; }, setProject: (id) => { activeProject = id; }, choose: (choice) => { importChoice = choice; }, exportTo: (target) => { exportTarget = target; },
    file: (name) => path.join(project, ".agents", "skills", name, "SKILL.md"), done: () => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }) };
}

test("opening the page lists what is there, what each is for and how big, and offers the starters", async () => {
  const e = await environment();
  try {
    await e.put("bug-triage", format.build({ name: "bug-triage", description: "Sort a bug report", body: "1. Read it." }));
    await e.put("no-front", "Just words without front matter.");
    await e.open();
    assert.equal(e.$("overlay").hidden, false);
    assert.deepEqual(e.nav, [["claim", "skills"]], "the page claims its place in the navigation");
    assert.equal(e.$("headline").textContent, "2 skills in this project. Type / in Home's message box to call one.");
    assert.deepEqual(e.rows().map((row) => row.dataset.name), ["bug-triage", "no-front"]);
    const row = e.rowOf("bug-triage");
    assert.equal(row.querySelector(".skills-name").textContent, "/bug-triage");
    assert.equal(row.querySelector(".skills-blurb").textContent, "Sort a bug report");
    assert.match(row.querySelector(".skills-meta").textContent, /^\.agents\/skills\/bug-triage\/SKILL\.md · \d\.\d KB$/);
    assert.deepEqual(row.querySelectorAll("button").map((button) => button.textContent), ["Edit", "Export folder", "Export zip", "Delete"]);
    assert.match(e.rowOf("no-front").querySelector(".skills-flag").textContent, /^It has no front matter\. Saving adds a name and a description\.$/);
    assert.equal(e.rowOf("no-front").dataset.tone, "warn");
    assert.deepEqual(e.starters(), ["bug-triage", "review-a-change", "release-notes", "explain-this-code"].filter((name) => name !== "bug-triage"), "a starter that is already a skill is not offered again");
    assert.equal(e.$("new").disabled, false);
    assert.equal(e.$("import").disabled, false);
    assert.equal(q(e, ".skills-editor"), null);
    e.window.MefiSkills.close();
    assert.equal(e.$("overlay").hidden, true);
    assert.deepEqual(e.nav.at(-1), ["release", "skills"]);
  } finally { await e.done(); }
});
const q = (e, selector) => e.q(selector);

test("an empty project says so, and a project whose .agents is a link says that instead of looking empty", async () => {
  const e = await environment();
  try {
    await e.open();
    assert.equal(e.$("headline").textContent, "No skills in this project yet. Start from one below, or make your own.");
    assert.equal(e.qa(".skills-empty").length, 1);
    assert.match(e.q(".skills-empty").textContent, /plain files under \.agents\/skills, so they travel with the project/);
    assert.equal(e.starters().length, 4);
    const blocked = await environment({ bridge: { skillsList: async () => ({ ok: true, dir: ".agents/skills", skills: [], others: [], starters: [], writable: true, blocked: ".agents is a link, and Studio does not write through links.", limits: {} }) } });
    await blocked.open();
    assert.equal(blocked.$("headline").textContent, ".agents is a link, and Studio does not write through links.");
    assert.equal(blocked.$("headline").dataset.tone, "bad");
    assert.equal(blocked.$("new").disabled, true, "nothing can be made while the folder cannot be written");
    assert.equal(blocked.qa(".skills-empty").length, 0);
    await blocked.done();
  } finally { await e.done(); }
});

test("New skill: the editor says what is wrong as you type, refuses a name that is taken, and saves the file the host checks again", async () => {
  const e = await environment();
  try {
    await e.put("taken", format.build({ name: "taken", description: "Already here", body: "Old." }));
    await e.open();
    await e.$("new").trigger("click");
    const editor = e.q(".skills-editor");
    assert.ok(editor);
    assert.equal(e.q(".skills-editor-head").textContent, "New skill.agents/skills/name/SKILL.md");
    const name = e.q("#skills-name"), about = e.q("#skills-description"), body = e.q("#skills-body");
    assert.equal(name.disabled, false);
    assert.equal(e.q("#skills-save").disabled, true, "nothing to save yet");
    assert.equal(e.q("#skills-error").hidden, true, "and nothing said before anything is wrong");
    await e.type(name, "Bad Name");
    assert.equal(e.q("#skills-error").textContent, "Use lowercase letters, numbers and dashes, up to 64 characters.");
    assert.equal(name.getAttribute("aria-invalid"), "true");
    assert.equal(e.q(".skills-editor-head .skills-editor-path").textContent, ".agents/skills/Bad Name/SKILL.md");
    await e.type(name, "taken");
    assert.equal(e.q("#skills-error").textContent, "A skill named taken already exists. Studio never overwrites one.");
    await e.type(name, "con");
    assert.equal(e.q("#skills-error").textContent, "Windows keeps that name for itself. Choose another.");
    await e.type(name, "release-check");
    await e.type(about, "  Check a release before it goes out  ");
    assert.equal(e.q("#skills-save").disabled, true, "still no instructions");
    assert.equal(e.q("#skills-error").hidden, true, "a field nobody has touched is not scolded");
    await e.type(body, "");
    assert.equal(e.q("#skills-error").textContent, "Write the instructions.", "but one that was left empty is");
    await e.type(body, "1. Run the checks.\n2. Read the notes.");
    assert.equal(e.q("#skills-error").hidden, true);
    assert.equal(e.q("#skills-save").disabled, false);
    assert.match(e.q("#skills-size").textContent, /^0\.\d KB of 32 KB$/);
    assert.equal(e.q("#skills-meaning").textContent, "Loads by itself when a task matches");
    await e.q("#skills-save").trigger("click");
    await settle();
    assert.equal(e.q(".skills-editor"), null, "the editor closes once it is saved");
    assert.deepEqual(plain(e.calls.filter((call) => call.name === "skillsCreate").map((call) => call.args[0])), [{ name: "release-check", description: "Check a release before it goes out", body: "1. Run the checks.\n2. Read the notes." }]);
    assert.equal(e.toasts.at(-1).text, "Saved .agents/skills/release-check/SKILL.md. Type /release-check in Home's message box to use it.");
    assert.equal(await readFile(e.file("release-check"), "utf8"), "---\nname: release-check\ndescription: Check a release before it goes out\n---\n\n1. Run the checks.\n2. Read the notes.\n");
    assert.deepEqual(e.rows().map((row) => row.dataset.name), ["release-check", "taken"]);
    assert.equal(e.rowOf("release-check").querySelector(".skills-blurb").textContent, "Check a release before it goes out");
    // A taken name never reached the host.
    assert.equal(e.calls.filter((call) => call.name === "skillsCreate").length, 1);
  } finally { await e.done(); }
});

test("the editor counts bytes the way the host does and says what the size means", async () => {
  const e = await environment();
  try {
    await e.open();
    await e.$("new").trigger("click");
    const name = e.q("#skills-name"), about = e.q("#skills-description"), body = e.q("#skills-body");
    await e.type(name, "big-one"); await e.type(about, "A long skill");
    await e.type(body, "x".repeat(17000));
    assert.equal(e.q("#skills-meaning").textContent, "Over 16 KB: agents skip it unless you call /big-one");
    assert.equal(e.q("#skills-save").disabled, false, "over 16 KB is allowed: it loads when it is called");
    assert.equal(e.q(".skills-counter").dataset.tone, "");
    await e.type(body, "x".repeat(32100));
    assert.match(e.q("#skills-error").textContent, /^This skill is 31\.\d KB; the most is 32 KB\.$/);
    assert.equal(e.q(".skills-counter").dataset.tone, "bad");
    assert.equal(e.q("#skills-save").disabled, true);
    assert.match(e.q("#skills-size").textContent, /of 32 KB$/);
    await e.type(about, "d".repeat(301));
    assert.equal(e.q("#skills-error").textContent, "Keep the description to 300 characters.", "the description is looked at first");
    const accents = "é".repeat(16100);
    await e.type(about, "ok"); await e.type(body, accents);
    assert.equal(e.q("#skills-save").disabled, true, "two-byte letters count twice: 16,100 of them are over 32,000 bytes");
  } finally { await e.done(); }
});

test("Edit opens the saved skill with its name fixed, saves the change, and says when nothing changed", async () => {
  const e = await environment();
  try {
    await e.put("bug-triage", "---\nname: bug-triage\ndescription: Old words\nallowed-tools:\n  - Read\n---\n\nOld body.\n");
    await e.open();
    await e.buttonOf(e.rowOf("bug-triage"), "Edit").trigger("click");
    await settle();
    assert.equal(e.q(".skills-editor-head").textContent, "Edit /bug-triage.agents/skills/bug-triage/SKILL.md");
    assert.equal(e.q("#skills-name").disabled, true);
    assert.equal(e.q("#skills-name").value, "bug-triage");
    assert.match(e.q("#skills-name-hint").textContent, /The name is the folder, and saved team settings point at it, so it can not change\./);
    assert.equal(e.q("#skills-description").value, "Old words");
    assert.equal(e.q("#skills-body").value, "Old body.\n");
    assert.match(e.qa(".skills-hint").map((node) => node.textContent).join("|"), /This file has other front matter .* Saving keeps it exactly as it is\./, "another tool's keys are said to be kept");
    assert.deepEqual(e.calls.filter((call) => call.name === "skillsRead").map((call) => call.args), [["bug-triage"]]);
    // Nothing changed: the host says so.
    await e.q("#skills-save").trigger("click"); await settle();
    assert.equal(e.toasts.at(-1).text, "/bug-triage is already saved this way.");
    await e.buttonOf(e.rowOf("bug-triage"), "Edit").trigger("click"); await settle();
    await e.type(e.q("#skills-body"), "New body.");
    await e.type(e.q("#skills-description"), "New words");
    await e.q("#skills-save").trigger("click"); await settle();
    assert.equal(e.toasts.at(-1).text, "Saved /bug-triage. A copy of the old text is kept on this PC.");
    assert.equal(await readFile(e.file("bug-triage"), "utf8"), "---\nname: bug-triage\ndescription: New words\nallowed-tools:\n  - Read\n---\n\nNew body.\n");
    assert.equal(e.q(".skills-editor"), null);
    assert.equal((await readdir(path.join(e.keep, "bug-triage"))).length, 1, "the old text was kept");
    assert.equal(e.rowOf("bug-triage").querySelector(".skills-blurb").textContent, "New words");
    assert.deepEqual(plain(e.calls.filter((call) => call.name === "skillsSave").map((call) => call.args[0])).at(-1), { name: "bug-triage", description: "New words", body: "New body." });
  } finally { await e.done(); }
});

test("a host that refuses a save is heard in the editor, and the words are still there", async () => {
  const e = await environment({ bridge: { skillsCreate: async () => ({ ok: false, error: "Studio could not keep a copy of the current file first, so nothing was changed." }) } });
  try {
    await e.open();
    await e.$("new").trigger("click");
    await e.type(e.q("#skills-name"), "refused"); await e.type(e.q("#skills-description"), "About it"); await e.type(e.q("#skills-body"), "Steps to keep.");
    await e.q("#skills-save").trigger("click"); await settle();
    assert.ok(e.q(".skills-editor"), "the editor stays");
    assert.equal(e.q("#skills-error").hidden, false);
    assert.equal(e.q("#skills-error").textContent, "Studio could not keep a copy of the current file first, so nothing was changed.");
    assert.equal(e.q("#skills-body").value, "Steps to keep.", "nothing typed is lost");
    assert.equal(e.q("#skills-save").textContent, "Save skill", "and it can be tried again");
    assert.equal(e.q("#skills-save").disabled, false);
  } finally { await e.done(); }
});

test("Delete asks twice; the first press runs nothing, the second deletes and says a copy is kept", async () => {
  const e = await environment();
  try {
    await e.put("gone", format.build({ name: "gone", description: "To delete", body: "Steps." }));
    await e.put("has-extras", format.build({ name: "has-extras", description: "With a helper", body: "Steps." }));
    await writeFile(path.join(e.project, ".agents", "skills", "has-extras", "helper.py"), "print('mine')");
    await e.open();
    const first = e.buttonOf(e.rowOf("gone"), "Delete");
    await first.trigger("click");
    assert.equal(first.textContent, "Delete: click again");
    assert.equal(e.calls.filter((call) => call.name === "skillsDelete").length, 0, "one press changes nothing");
    await first.trigger("click"); await settle();
    assert.deepEqual(e.calls.filter((call) => call.name === "skillsDelete").map((call) => call.args), [["gone"]]);
    assert.equal(e.toasts.at(-1).text, "Deleted /gone. A copy of its text is kept on this PC.");
    assert.equal(e.rowOf("gone"), undefined);
    assert.equal((await readdir(path.join(e.keep, "gone"))).length, 1);
    const second = e.buttonOf(e.rowOf("has-extras"), "Delete");
    await second.trigger("click"); await second.trigger("click"); await settle();
    assert.equal(e.toasts.at(-1).text, "Deleted /has-extras. A copy of its text is kept on this PC. The folder stays, because it holds 1 other file.");
    assert.deepEqual(await readdir(path.join(e.project, ".agents", "skills", "has-extras")), ["helper.py"]);
  } finally { await e.done(); }
});

test("a starter is added as it is, once, and is not offered again", async () => {
  const e = await environment();
  try {
    await e.open();
    assert.ok(e.starters().includes("release-notes"));
    const add = e.qa(".skills-starter").find((row) => row.dataset.name === "release-notes").querySelector("button");
    assert.equal(add.textContent, "Add");
    await add.trigger("click"); await settle();
    const starter = format.STARTERS.find((item) => item.name === "release-notes");
    assert.equal(await readFile(e.file("release-notes"), "utf8"), format.build(starter));
    assert.equal(e.toasts.at(-1).text, "Saved .agents/skills/release-notes/SKILL.md. Type /release-notes in Home's message box to use it.");
    assert.deepEqual(e.rows().map((row) => row.dataset.name), ["release-notes"]);
    assert.ok(!e.starters().includes("release-notes"));
    // A name that appeared in the meantime is refused by the host, never overwritten.
    await mkdir(path.join(e.project, ".agents", "skills", "review-a-change"), { recursive: true });
    await writeFile(e.file("review-a-change"), format.build({ name: "review-a-change", description: "Mine", body: "My own words." }));
    await e.qa(".skills-starter").find((row) => row.dataset.name === "review-a-change").querySelector("button").trigger("click"); await settle();
    assert.equal(e.q(".skills-note").dataset.tone, "bad");
    assert.match(e.q(".skills-note").textContent, /^A skill named review-a-change already exists\. Studio never overwrites one\./);
    assert.match(await readFile(e.file("review-a-change"), "utf8"), /My own words\./);
  } finally { await e.done(); }
});

test("Import opens no path from the page: the host asks for the folder; what it says is shown, a cancel is silent", async () => {
  const e = await environment();
  try {
    await e.open();
    await e.$("import").trigger("click"); await settle();
    assert.equal(e.qa(".skills-note").length, 0, "cancelled: nothing said");
    const folder = path.join(e.away, "team-review");
    await mkdir(folder); await writeFile(path.join(folder, "SKILL.md"), format.build({ name: "team-review", description: "The team's review", body: "Steps." })); await writeFile(path.join(folder, "x.md"), "other"); await writeFile(path.join(folder, "y.md"), "other");
    e.choose({ canceled: false, folder });
    await e.$("import").trigger("click"); await settle();
    assert.equal(e.q(".skills-note").dataset.tone, "good");
    assert.equal(e.q(".skills-note span").textContent, "Imported /team-review. 2 other files in that folder were not imported; a skill is its SKILL.md.");
    assert.deepEqual(e.rows().map((row) => row.dataset.name), ["team-review"]);
    await e.q(".skills-note button").trigger("click");
    assert.equal(e.qa(".skills-note").length, 0, "a note can be dismissed");
    e.choose({ canceled: false, folder });
    await e.$("import").trigger("click"); await settle();
    assert.equal(e.q(".skills-note").dataset.tone, "bad");
    assert.equal(e.q(".skills-note").getAttribute("role"), "alert");
    assert.match(e.q(".skills-note span").textContent, /^A skill named team-review already exists\. Studio never overwrites one\.$/);
    e.choose({ canceled: false, error: "SKILL.md has no front matter. It needs a name and a description between two --- lines." });
    await e.$("import").trigger("click"); await settle();
    assert.match(e.q(".skills-note span").textContent, /^SKILL\.md has no front matter/);
    assert.deepEqual(e.calls.filter((call) => call.name === "skillsImport").map((call) => call.args), [[], [], [], []], "the page sends no folder");
  } finally { await e.done(); }
});

test("Export asks the host for a folder or a zip by name and kind, and tells what happened", async () => {
  const e = await environment();
  try {
    await e.put("shareable", format.build({ name: "shareable", description: "Share it", body: "Steps." }));
    await e.open();
    await e.buttonOf(e.rowOf("shareable"), "Export folder").trigger("click"); await settle();
    assert.equal(e.toasts.length, 0, "a cancelled dialog says nothing");
    e.exportTo(path.join(e.away, "shareable-copy"));
    await e.buttonOf(e.rowOf("shareable"), "Export folder").trigger("click"); await settle();
    assert.equal(e.toasts.at(-1).text, "Exported /shareable as a folder.");
    assert.deepEqual(await readdir(path.join(e.away, "shareable-copy")), ["SKILL.md"]);
    e.exportTo(path.join(e.away, "shareable.zip"));
    await e.buttonOf(e.rowOf("shareable"), "Export zip").trigger("click"); await settle();
    assert.equal(e.toasts.at(-1).text, "Exported /shareable as a zip file.");
    await e.buttonOf(e.rowOf("shareable"), "Export folder").trigger("click"); await settle();
    assert.equal(e.q(".skills-note").dataset.tone, "bad", "a folder that exists is refused, and the page says so");
    assert.match(e.q(".skills-note span").textContent, /^That folder already exists\. Choose a new name; nothing is replaced\.$/);
    assert.deepEqual(plain(e.calls.filter((call) => call.name === "skillsExport").map((call) => call.args[0])), [{ name: "shareable", kind: "folder" }, { name: "shareable", kind: "folder" }, { name: "shareable", kind: "zip" }, { name: "shareable", kind: "folder" }]);
  } finally { await e.done(); }
});

test("when editing is switched off the page is read-only and says so, and exporting still works", async () => {
  const e = await environment();
  try {
    await e.put("kept", format.build({ name: "kept", description: "Kept", body: "Steps." }));
    e.off();
    await e.open();
    assert.match(e.$("headline").textContent, /Editing skills is switched off on this PC\.$/);
    assert.equal(e.$("headline").dataset.tone, "warn");
    for (const id of ["new", "import"]) { assert.equal(e.$(id).disabled, true, id); assert.equal(e.$(id).title, "Editing skills is switched off on this PC."); }
    const row = e.rowOf("kept");
    assert.equal(e.buttonOf(row, "Edit").disabled, true);
    assert.equal(e.buttonOf(row, "Delete").disabled, true);
    assert.equal(e.buttonOf(row, "Export folder").disabled, false);
    assert.equal(e.buttonOf(row, "Export zip").disabled, false);
    assert.equal(e.starters().length, 0, "starters are not offered when nothing can be saved");
    await e.$("new").trigger("click");
    assert.equal(e.q(".skills-editor"), null);
  } finally { await e.done(); }
});

test("skills that cannot be used as they are say why, and the ones other tools keep are named, not edited", async () => {
  const e = await environment();
  try {
    await e.put("Bad_Name", "---\nname: Bad_Name\ndescription: d\n---\nB");
    await e.put("over-16", format.build({ name: "over-16", description: "A long one", body: "y".repeat(20000) }));
    await e.put("over-32", format.build({ name: "over-32", description: "Too long", body: "z".repeat(40000) }));
    await mkdir(path.join(e.project, ".claude", "skills", "from-claude"), { recursive: true });
    await writeFile(path.join(e.project, ".claude", "skills", "from-claude", "SKILL.md"), "---\nname: from-claude\ndescription: d\n---\nB");
    await e.open();
    assert.equal(e.buttonOf(e.rowOf("Bad_Name"), "Edit").disabled, true, "a name the page would not allow is shown, not edited");
    assert.equal(e.rowOf("Bad_Name").querySelector(".skills-flag").textContent, "Use lowercase letters, numbers and dashes, up to 64 characters.");
    assert.equal(e.rowOf("over-16").querySelector(".skills-flag").textContent, "Over 16 KB: agents use it only when you call /over-16");
    assert.equal(e.buttonOf(e.rowOf("over-16"), "Edit").disabled, false);
    assert.match(e.rowOf("over-32").querySelector(".skills-flag").textContent, /Agents skip anything over 32 KB; shorten it to use it\.$/);
    assert.equal(e.buttonOf(e.rowOf("over-32"), "Edit").disabled, false, "a file over 32 KB can be opened to shorten it");
    const others = e.q(".skills-others");
    assert.match(others.querySelector("summary").textContent, /^Also available to agents: 1 skill from other places$/);
    assert.equal(others.querySelector(".skills-other strong").textContent, "/from-claude");
    assert.match(others.querySelector(".skills-other .skills-meta").textContent, /^this project · \.claude\/skills$/);
    assert.equal(others.querySelectorAll("button").length, 0, "nothing to press: they are not edited here");
  } finally { await e.done(); }
});

test("an editor with words in it is not thrown away by starting another, and Cancel closes it", async () => {
  const e = await environment();
  try {
    await e.put("one", format.build({ name: "one", description: "One", body: "Steps." }));
    await e.open();
    await e.$("new").trigger("click");
    await e.type(e.q("#skills-name"), "half-written");
    await e.q(".skills-editor").trigger("input", {});
    await e.$("list").trigger("input", { target: e.q("#skills-name") });
    await e.$("new").trigger("click");
    assert.equal(e.toasts.at(-1).text, "Save or cancel the skill you are editing first.");
    assert.equal(e.q("#skills-name").value, "half-written");
    await e.buttonOf(e.rowOf("one"), "Edit").trigger("click"); await settle();
    assert.equal(e.q("#skills-name").value, "half-written", "Edit did not replace the draft either");
    await e.q("#skills-cancel").trigger("click");
    assert.equal(e.q(".skills-editor"), null);
    await e.buttonOf(e.rowOf("one"), "Edit").trigger("click"); await settle();
    assert.equal(e.q("#skills-name").value, "one", "once it is cancelled the next can start");
  } finally { await e.done(); }
});

test("a read that finishes after the project changed is not shown, and a new project closes the editor", async () => {
  let release;
  const e = await environment({ bridge: { skillsList: () => new Promise((resolve) => { release = () => resolve({ ok: true, dir: ".agents/skills", skills: [{ name: "from-a", description: "A", bytes: 10, updatedAt: 1, path: ".agents/skills/from-a/SKILL.md", editable: true, loadsByItself: true }], others: [], starters: [], writable: true, limits: {} }); }) } });
  try {
    const opened = e.open();
    await settle();
    e.setProject("project-b");
    release(); await opened; await settle();
    assert.equal(e.rows().length, 0, "project A's list does not land in project B's page");
    assert.equal(e.$("headline").textContent, "Reading the skills…");
  } finally { await e.done(); }
  const again = await environment();
  try {
    await again.open();
    await again.$("new").trigger("click");
    assert.ok(again.q(".skills-editor"));
    again.setProject("project-b");
    await again.$("refresh").trigger("click"); await settle();
    assert.equal(again.q(".skills-editor"), null, "a draft belongs to its project");
  } finally { await again.done(); }
});

test("without the desktop bridge, or when a read fails, the page says so plainly", async () => {
  const bare = await environment({ noBridge: true });
  try {
    await bare.open();
    assert.equal(bare.$("headline").textContent, "Skills are listed in the desktop app.");
    assert.equal(bare.$("new").disabled, true);
  } finally { await bare.done(); }
  const failing = await environment({ bridge: { skillsList: async () => ({ ok: false, error: "Open a project first." }) } });
  try {
    await failing.open();
    assert.equal(failing.$("headline").textContent, "Open a project first.");
    assert.equal(failing.$("headline").dataset.tone, "bad");
    assert.equal(failing.$("new").disabled, true);
  } finally { await failing.done(); }
  const thrown = await environment({ bridge: { skillsList: async () => { throw new Error("The bridge went away."); } } });
  try { await thrown.open(); assert.equal(thrown.$("headline").textContent, "The bridge went away."); } finally { await thrown.done(); }
});

test("a redraw while someone is typing keeps the draft, and a read that changes nothing redraws nothing", async () => {
  const e = await environment();
  try {
    await e.put("one", format.build({ name: "one", description: "One", body: "Steps." }));
    await e.open();
    await e.$("new").trigger("click");
    await e.type(e.q("#skills-name"), "writing"); await e.type(e.q("#skills-description"), "Being written"); await e.type(e.q("#skills-body"), "Half a sentence");
    const before = e.q(".skills-editor");
    await e.$("refresh").trigger("click"); await settle();
    assert.equal(e.q(".skills-editor"), before, "the same list redraws nothing");
    // Another tool adds a skill while the editor is open: the list changes, the draft does not.
    await e.put("two", format.build({ name: "two", description: "Two", body: "Steps." }));
    await e.$("refresh").trigger("click"); await settle();
    assert.deepEqual(e.rows().map((row) => row.dataset.name), ["one", "two"]);
    assert.equal(e.q("#skills-name").value, "writing");
    assert.equal(e.q("#skills-description").value, "Being written");
    assert.equal(e.q("#skills-body").value, "Half a sentence");
    assert.equal(e.q("#skills-save").disabled, false);
  } finally { await e.done(); }
});

test("a save that finishes after the project changed does not announce itself or touch the new project's page", async () => {
  let release;
  const e = await environment({ bridge: { skillsCreate: () => new Promise((resolve) => { release = () => resolve({ ok: true, skill: { name: "late" } }); }) } });
  try {
    await e.open();
    await e.$("new").trigger("click");
    await e.type(e.q("#skills-name"), "late"); await e.type(e.q("#skills-description"), "Late one"); await e.type(e.q("#skills-body"), "Steps.");
    await e.q("#skills-save").trigger("click");
    await settle();
    const listed = e.calls.filter((call) => call.name === "skillsList").length;
    e.setProject("project-b");
    release(); await settle();
    assert.equal(e.toasts.length, 0, "no toast about a skill in another project");
    assert.equal(e.calls.filter((call) => call.name === "skillsList").length, listed, "and no read on its account");
  } finally { await e.done(); }
});

test("the page sends names and text and never a path, and its labels are attached to their fields", async () => {
  const e = await environment();
  try {
    await e.put("one", format.build({ name: "one", description: "One", body: "Steps." }));
    await e.open();
    await e.$("new").trigger("click");
    const labels = e.qa(".skills-label").map((label) => [label.textContent, label.htmlFor]);
    assert.deepEqual(labels, [["Name", "skills-name"], ["When to use it", "skills-description"], ["Instructions", "skills-body"]]);
    assert.equal(e.q("#skills-description").getAttribute("aria-describedby"), null);
    assert.equal(e.q("#skills-name").getAttribute("aria-describedby"), "skills-name-hint");
    assert.equal(e.q("#skills-error").getAttribute("role"), "alert");
    const template = readFileSync(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
    assert.match(template, /<p id="skills-headline" class="skills-headline" role="status" aria-live="polite">/, "the headline is announced");
    assert.match(template, /<div class="overlay explorer" id="skills-overlay" hidden>\s*<div class="explorer-sheet skills-sheet" role="dialog" aria-modal="true" aria-labelledby="skills-heading"/);
    await e.q("#skills-cancel").trigger("click");
    await e.buttonOf(e.rowOf("one"), "Edit").trigger("click"); await settle();
    await e.q("#skills-cancel").trigger("click");
    await e.buttonOf(e.rowOf("one"), "Delete").trigger("click");
    const sent = JSON.stringify(e.calls.map((call) => call.args));
    assert.ok(!sent.includes(e.project) && !sent.includes(e.root) && !/SKILL\.md|\.agents/.test(sent), "no path, no file name");
    for (const call of e.calls) for (const argument of call.args) assert.ok(typeof argument === "string" || argument === undefined || (argument && typeof argument === "object" && Object.keys(argument).every((key) => ["name", "description", "body", "kind"].includes(key))), `${call.name} carries only names and text`);
  } finally { await e.done(); }
});

test("the page writes a skill's file the way the host does, and judges a draft the same way", async () => {
  const e = await environment();
  try {
    const { build, problems, nameProblem } = e.window.MefiSkills;
    const names = ["", "a", "bug-triage", "Bug", "bug_triage", "-x", "x".repeat(64), "x".repeat(65), "con", "lpt1", "com10", "é", "a b", "../x", "0day"];
    for (const name of names) assert.equal(nameProblem(name), format.nameProblem(name), JSON.stringify(name));
    const descriptions = ["Sort a bug report", "Colon: in it", "ends:", "has # hash", "\"quoted\"", "yes", "true", "12345", "3.14", "- dash", "[x] {y}", "a, b", "back\\slash", "ünï — cödé", "  padded  ", "a   b"];
    for (const description of descriptions) for (const body of ["Do it.", "\n\nPadded body.  \n\n", "Multi\nline\n\nbody\n"]) {
      assert.equal(build({ name: "x", description, body }), format.build({ name: "x", description, body }), JSON.stringify([description, body]));
    }
    const drafts = [
      { mode: "new", name: "ok", description: "d", body: "b" }, { mode: "new", name: "", description: "d", body: "b" }, { mode: "new", name: "Bad", description: "d", body: "b" }, { mode: "new", name: "ok", description: "", body: "b" },
      { mode: "new", name: "ok", description: "d", body: "" }, { mode: "new", name: "ok", description: "d".repeat(301), body: "b" }, { mode: "new", name: "ok", description: "d", body: "x".repeat(32000) }, { mode: "new", name: "ok", description: "d", body: "x".repeat(31900) },
      { mode: "edit", name: "Whatever", description: "d", body: "b" }, { mode: "new", name: "con", description: "d", body: "b" },
    ];
    for (const draft of drafts) {
      const here = plain(problems(draft).map((problem) => problem.field)).sort();
      const there = format.check({ name: draft.name, description: draft.description, body: draft.body }).problems.map((problem) => problem.field).filter((field) => draft.mode === "new" || field !== "name").sort();
      assert.deepEqual(here, there, JSON.stringify({ ...draft, body: draft.body.length }));
    }
    assert.deepEqual(plain(problems({ mode: "new", name: "taken", description: "d", body: "b" }, { taken: ["taken"] }).map((problem) => problem.message)), ["A skill named taken already exists. Studio never overwrites one."]);
  } finally { await e.done(); }
});
