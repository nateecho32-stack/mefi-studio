"""Exercise the real Plans UI in an isolated offscreen Electron app.

python tools/verify_planning.py [--output tools/logs/planning-ui]

Only application sources and the two committed catalog files are copied. The
project folders, board stores, settings and Electron profile are disposable.
Network requests and external worker processes are rejected by the harness.
Screenshots and a JSON verification report are the only retained outputs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def project_id(folder):
    identity = str(folder.resolve())
    if os.name == "nt":
        identity = identity.lower()
    return "project_" + hashlib.sha256(identity.encode()).hexdigest()[:16]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


BOOTSTRAP = r'''
const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const config = __CONFIG__;
const started = performance.now();
const report = { checks: [], screenshots: [], networkAttempts: [], workerAttempts: [], consoleErrors: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let holdPlanningAssist = false, releasePlanningAssist = null;
// One controlled pending reply verifies the visible working state without a
// paid request. All plan decisions, task conversion and persistence use real IPC.
const originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
electron.ipcMain.handle = (channel, handler) => originalHandle(channel, (event, ...args) => {
  if (channel === "planning:assist" && holdPlanningAssist) {
    holdPlanningAssist = false;
    return new Promise(resolve => { releasePlanningAssist = () => resolve({ ok: false, projectId: args[0]?.projectId, error: "Fixture planning response unavailable." }); });
  }
  return handler(event, ...args);
});
let finished = false;
async function finish(error) {
  if (finished) return;
  finished = true;
  report.ok = !error;
  report.elapsedMs = Math.round(performance.now() - started);
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(config.output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("[planning-ui] " + JSON.stringify(report));
  electron.app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);
global.fetch = async (url) => {
  report.networkAttempts.push(String(url));
  throw new Error("External network is disabled by the isolated planning UI harness");
};
// main.cjs captures these functions while loading. Fail closed if a new path
// tries to launch an executor despite smoke mode and disabled preferences.
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const original = childProcess[method];
  childProcess[method] = function(command, ...args) {
    const value = String(command);
    if (/\b(?:opencode|grok|codex|claude|love)(?:\.exe)?\b/i.test(value) || /^(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i.test(path.basename(value))) {
      report.workerAttempts.push({ method, command: value });
      throw new Error("Worker processes are disabled by the isolated planning UI harness");
    }
    return original.call(this, command, ...args);
  };
}
electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
electron.app.commandLine.appendSwitch("force-device-scale-factor", "1");
electron.app.setPath("userData", config.profile);
electron.app.setPath("sessionData", path.join(config.profile, "session"));
electron.app.whenReady().then(() => {
  electron.session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    report.networkAttempts.push(details.url);
    callback({ cancel: true });
  });
});
const NativeWindow = electron.BrowserWindow;
class VerifiedWindow extends NativeWindow {
  constructor(options) {
    super({ ...options, width: 1460, height: 940, show: false,
      webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
    this.webContents.setFrameRate(30);
    this.webContents.on("console-message", (...args) => {
      const detail = typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
      if (detail.level === "error" || detail.level === 3) report.consoleErrors.push(String(detail.message));
    });
    this.webContents.once("did-finish-load", () => this.verify().then(() => finish()).catch(async (error) => {
      try { report.failureState = await this.run("return {planning:!document.getElementById('plans-overlay')?.hidden,feedback:document.getElementById('plans-notice')?.textContent,body:document.body.innerText.slice(-10000)};"); } catch {}
      try { await this.capture("failure"); } catch {}
      await finish(error);
    }));
  }
  loadFile(file, options = {}) {
    return super.loadFile(file, { ...options, query: { ...options.query, capture: "0", smoke: "0" } });
  }
  run(code) { return this.webContents.executeJavaScript(`(async () => { ${code} })()`, true); }
  async until(expression, label, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.run(`return Boolean(await (${expression}));`)) return;
      await sleep(50);
    }
    throw new Error(`Timed out: ${label}`);
  }
  async click(selector) {
    return this.run(`const selector = ${JSON.stringify(selector)}; const el = document.querySelector(selector); if (!el) throw new Error('Missing control: ' + selector); if (el.disabled) throw new Error('Disabled control: ' + selector); el.scrollIntoView({block:'nearest'}); const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden') throw new Error('Hidden control: ' + selector); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); if (!hit || !el.contains(hit)) throw new Error('Obscured control: ' + selector); el.click();`);
  }
  async fill(selector, value) {
    return this.run(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing input: ' + ${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}));`);
  }
  async capture(name) {
    let image;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.webContents.invalidate();
      await sleep(250);
      try { image = await this.webContents.capturePage(); break; }
      catch (error) { if (attempt === 2 || !/UnknownVizError/.test(String(error))) throw error; }
    }
    assert(!image.isEmpty(), `${name} screenshot must contain pixels`);
    const output = path.join(config.output, `${name}.png`);
    fs.writeFileSync(output, image.toPNG());
    report.screenshots.push({ name, file: output, ...image.getSize() });
  }
  check(name) { report.checks.push(name); console.log(`[planning-check] ${name}`); }
  async list(projectId = config.alpha.id) {
    const result = await this.run(`return window.mefiStudio.planningList({projectId:${JSON.stringify(projectId)}});`);
    assert.equal(result.ok, true, result.error);
    return result.plans;
  }
  async action(payload) {
    return this.run(`return window.mefiStudio.planningAction(${JSON.stringify({ projectId: config.alpha.id, ...payload })});`);
  }
  async selectProject(projectId) {
    await this.until(`(async () => { const result = await window.mefiStudio.projectsSelect(${JSON.stringify(projectId)}); if (!result.ok && /Saving this project's work|assistant is finishing work|switch is already in progress/.test(result.error || '')) return false; if (!result.ok) throw new Error(result.error); return result.activeId === ${JSON.stringify(projectId)}; })()`, "project selection settles");
  }
  async verify() {
    this.setContentSize(1460, 940);
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden", "workspace ready");
    await this.until("window.MefiPlanning && window.mefiStudio.planningList && window.mefiStudio.planningAction", "planning API ready");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert.deepEqual(await this.list(), [], "disposable project starts with an empty plan list");
    await this.run("window.MefiNav.go('plans');");
    await this.until("document.getElementById('plans-overlay') && !document.getElementById('plans-overlay').hidden", "Plans opens from navigation");
    this.check("Plans opens through the real navigation and project IPC");
    await this.capture("01-empty-plans");

    // The remaining flow uses the real controls; the public API is used only
    // for persisted-state assertions and invalid/repeated action checks.
    await this.verifyPlanningFlow();
    assert.equal(report.networkAttempts.length, 0, "planning flow must not attempt external network calls");
    assert.equal(report.workerAttempts.length, 0, "planning flow must not launch external workers");
    const serious = report.consoleErrors.filter(line => !/ERR_FILE_NOT_FOUND/.test(line));
    assert.equal(serious.length, 0, `Renderer errors: ${serious.join('; ')}`);
  }
  async verifyPlanningFlow() {
    const title = "Garden journal export";
    const destination = "Gardeners can export a readable Markdown journal containing their dated entries.";
    const outOfScope = "Cloud sync, accounts, and PDF export.";
    await this.click("#plans-new");
    assert.equal(await this.run("return document.querySelectorAll('[id^=plans-stage-]').length;"), 7, "the full visual path is visible before the first plan is saved");
    await this.fill("#plans-title", title);
    await this.fill("#plans-destination", destination);
    await this.fill("#plans-out-of-scope", outOfScope);
    await this.click("#plans-save-details");
    await this.until(`(async () => (await window.mefiStudio.planningList({projectId:${JSON.stringify(config.alpha.id)}})).plans.some(plan => plan.title === ${JSON.stringify(title)}))()`, "plan saved");
    let plan = (await this.list()).find(item => item.title === title);
    const planId = plan.id;
    assert.equal(plan.destination, destination);
    assert.equal(plan.outOfScope, outOfScope);
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 0, "creating a plan does not create runnable work");
    this.check("Creating a plan saves destination and exclusions without scheduling tasks");

    const unknownText = "Choose which entry fields belong in the export.";
    await this.until("document.getElementById('plans-add-unknown') && !document.getElementById('plans-add-unknown').disabled", "unknown controls ready");
    await this.fill("#plans-unknown-text", unknownText);
    await this.click("#plans-add-unknown");
    await this.until(`(async () => (await window.mefiStudio.planningList({projectId:${JSON.stringify(config.alpha.id)}})).plans.find(plan => plan.id === ${JSON.stringify(planId)})?.unknowns?.some(item => item.text === ${JSON.stringify(unknownText)}))()`, "unknown saved");
    plan = (await this.list()).find(item => item.id === planId);
    const unknown = plan.unknowns.find(item => item.text === unknownText);
    const blocked = await this.action({ action: "convert", planId, version: plan.version });
    assert.equal(blocked.ok, false, "unresolved unknowns must prevent task conversion");
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 0, "rejected conversion creates no tasks");
    await this.capture("02-unresolved-plan");
    this.check("Unresolved planning work cannot be converted into runnable tasks");

    // Promoting an unknown links its question and outcome instead of leaving
    // an unrelated unanswered item that can accidentally escape the gate.
    await this.click(`[data-unknown-id="${unknown.id}"][data-action="promote"]`);
    await this.fill("#plans-question-text", "Which fields must a Markdown export contain?");
    await this.fill("#plans-question-type", "discussion");
    await this.click("#plans-add-question");
    await this.until(`(async () => (await window.mefiStudio.planningList({projectId:${JSON.stringify(config.alpha.id)}})).plans.find(plan => plan.id === ${JSON.stringify(planId)})?.questions?.length === 1)()`, "linked question saved");
    plan = (await this.list()).find(item => item.id === planId);
    const question = plan.questions[0];
    const addedDependency = await this.action({ action: "add-question", planId, version: plan.version,
      question: "Which encoding preserves every plant name?", type: "research", dependsOn: [question.id] });
    assert.equal(addedDependency.ok, true, addedDependency.error);
    plan = (await this.list()).find(item => item.id === planId);
    const dependentQuestion = plan.questions.find(item => item.id !== question.id);
    await this.run("await window.MefiPlanning.refresh();");
    await this.until("document.getElementById('plans-question-map')", "question map displays the open decision");
    assert(await this.run(`return document.getElementById('plans-question-map').textContent.includes(${JSON.stringify(question.question)});`));
    assert.equal(await this.run(`return document.getElementById(${JSON.stringify(`plans-map-question-${dependentQuestion.id}`)}).dataset.questionState;`), "blocked", "the map shows the dependent question waiting");
    await this.run("document.getElementById('plans-detail').scrollTop = 0;");
    await this.capture("11-visual-question-frontier");
    holdPlanningAssist = true;
    await this.run(`const button = document.getElementById(${JSON.stringify(`plans-ask-${question.id}`)}); const details = button.closest('details'); if (details) details.open = true;`);
    await this.click(`#plans-ask-${question.id}`);
    await this.until("document.getElementById('plans-flow-status')?.getAttribute('aria-busy') === 'true'", "the visual path reports an actual pending planning reply");
    await this.run("document.getElementById('plans-detail').scrollTop = 0;");
    await this.capture("12-visual-working-state");
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 0, "thinking through a question cannot start build tasks");
    releasePlanningAssist();
    await this.until("document.getElementById('plans-notice').textContent.includes('Fixture planning response unavailable')", "failed suggestion reports its real error");
    await this.until("document.getElementById('plans-flow-status')?.getAttribute('aria-busy') === 'false'", "failed suggestion clears visual working state");
    assert.equal((await this.list()).find(item => item.id === planId).questions[0].status, "open", "an AI reply never silently decides for the user");
    this.check("The visual question map and pending model state reflect real work without starting builds or resolving decisions");
    await this.until(`document.getElementById(${JSON.stringify(`plans-resolve-${question.id}`)})`, "question controls ready");
    await this.fill(`#plans-resolution-${question.id}`, "Include the entry date, title, body, and plant tags in chronological order.");
    await this.fill(`#plans-evidence-${question.id}`, "Agreed with the project owner using the journal's existing entry fields.");
    await this.click(`#plans-resolve-${question.id}`);
    await this.until(`(async () => { const plan = (await window.mefiStudio.planningList({projectId:${JSON.stringify(config.alpha.id)}})).plans.find(plan => plan.id === ${JSON.stringify(planId)}); return plan.questions[0].status === 'resolved'; })()`, "question resolution saved");
    plan = (await this.list()).find(item => item.id === planId);
    assert(plan.questions[0].resolution.includes("chronological"), "decision text is retained");
    assert(plan.questions[0].evidence.includes("project owner"), "decision evidence is retained");
    await this.until(`document.getElementById(${JSON.stringify(`plans-map-question-${dependentQuestion.id}`)})?.dataset.questionState === 'ready'`, "the dependency map unlocks the next question");
    await this.fill(`#plans-resolution-${dependentQuestion.id}`, "Use UTF-8 for the complete journal.");
    await this.fill(`#plans-evidence-${dependentQuestion.id}`, "Fixture review: UTF-8 preserves the sample journal's accented plant names.");
    await this.click(`#plans-resolve-${dependentQuestion.id}`);
    await this.until(`(async () => (await window.mefiStudio.planningList({projectId:${JSON.stringify(config.alpha.id)}})).plans.find(plan => plan.id === ${JSON.stringify(planId)}).questions.every(question => question.status === 'resolved'))()`, "dependent research finding is accepted by the human");
    this.check("Question resolution records the decision and supporting evidence");
    await this.capture("03-decisions-resolved");

    const specText = "Export the journal as UTF-8 Markdown. Keep chronological entry order and include date, title, body, and plant tags. Do not add cloud sync, accounts, or PDF export.";
    await this.until("document.getElementById('plans-spec-text')", "manual specification editor ready");
    await this.fill("#plans-spec-text", specText);
    if (!await this.run("return Boolean(document.getElementById('plans-task-title-0'));")) await this.click("#plans-add-slice");
    await this.fill("#plans-task-title-0", "Add Markdown journal export");
    await this.fill("#plans-task-prompt-0", "Implement Markdown export for journal entries. Preserve the existing journal editing workflow.");
    await this.fill("#plans-task-acceptance-0", "Export two dated entries and verify order, complete text, plant tags, and valid UTF-8.");
    await this.click("#plans-save-spec");
    await this.until(`(async () => { const plan = (await window.mefiStudio.planningList({projectId:${JSON.stringify(config.alpha.id)}})).plans.find(plan => plan.id === ${JSON.stringify(planId)}); return plan.spec?.text === ${JSON.stringify(specText)}; })()`, "manual specification saved");
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 0, "drafting specifications does not create runnable work");
    plan = (await this.list()).find(item => item.id === planId);
    const unapproved = await this.action({ action: "convert", planId, version: plan.version });
    assert.equal(unapproved.ok, false, "unapproved specification cannot create tasks");
    await this.until("!document.getElementById('plans-approve').disabled", "approval control ready");
    await this.click("#plans-approve");
    await this.until("document.getElementById('plans-convert') && !document.getElementById('plans-convert').disabled", "approved specification permits conversion");
    this.check("A manual specification with an acceptance check requires explicit approval");
    const approvedVersion = (await this.list()).find(item => item.id === planId).version;
    const unsaved = [
      { selector: "#plans-destination", value: `${destination} Also publish the journal online.`, restored: destination, label: "destination" },
      { selector: "#plans-unknown-text", value: "Should archived entries be included?", restored: "", label: "new unknown" },
      { selector: "#plans-question-text", value: "Should archived entries be included in Markdown exports?", restored: "", label: "new question" },
    ];
    for (const edit of unsaved) {
      if (edit.label === "new question") {
        const open = await this.run("return document.getElementById('plans-question-form').closest('details').open;");
        if (!open) await this.click("#plans-detail details:has(#plans-question-form) > summary");
      }
      await this.fill(edit.selector, edit.value);
      await this.until("['approve','convert','draft-spec','save-spec'].every(id => document.getElementById('plans-' + id)?.disabled)", `unsaved ${edit.label} holds specification actions`);
      const saved = (await this.list()).find(item => item.id === planId);
      assert.equal(saved.version, approvedVersion, "typing planning changes must not silently modify the approved plan");
      assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 0, "unsaved planning changes must not create tasks");
      if (edit.label === "new question") {
        await this.run("document.getElementById('plans-convert').scrollIntoView({block:'center'});");
        await this.capture("09-unsaved-edits-hold-conversion");
      }
      await this.fill(edit.selector, edit.restored);
      await this.until("!document.getElementById('plans-convert').disabled", `reverting ${edit.label} restores legitimate conversion`);
    }
    this.check("Unsaved destination, new unknown, and new question drafts block handoff until cleared or saved");
    await this.run("document.getElementById('plans-convert').scrollIntoView({block:'center'});");
    await this.capture("04-approved-specification");

    await this.click("#plans-convert");
    await this.until("(async () => (await window.mefiStudio.tasksList()).tasks.length === 1)()", "approved specification creates one task");
    let tasks = await this.run("return (await window.mefiStudio.tasksList()).tasks;");
    const task = tasks[0];
    assert.equal(task.title, "Add Markdown journal export");
    assert.equal(task.projectId, config.alpha.id);
    assert(task.prompt.includes("UTF-8") && task.prompt.includes("chronological"), "task carries approved specification and acceptance criteria");
    plan = (await this.list()).find(item => item.id === planId);
    assert.equal(plan.spec.text, specText, "approved specification remains on the plan after conversion");
    const repeated = await this.action({ action: "convert", planId, version: plan.version });
    assert.equal(repeated.ok, true, repeated.error || "repeat conversion is idempotent");
    tasks = await this.run("return (await window.mefiStudio.tasksList()).tasks;");
    assert.equal(tasks.length, 1, "repeat conversion does not duplicate tasks");
    assert.equal(tasks[0].id, task.id);
    await this.until("document.getElementById('plans-execution')?.textContent.includes('Queued') && document.getElementById('plans-execution')?.textContent.includes('Add Markdown journal export')", "converted plan displays the task board's queued state");
    report.planId = planId;
    report.createdTaskId = task.id;
    this.check("Approved conversion creates exactly one task, keeps the specification, and is idempotent");
    await this.capture("05-converted-plan");

    await this.click("#plans-detail .planning-confirm button");
    await this.until("!document.getElementById('tasks-overlay').hidden && document.getElementById('task-title').textContent.includes('Add Markdown journal export')", "converted task opens from its plan");
    assert.equal(await this.run("return document.querySelector('[data-task-action=\"view-plan\"]').textContent;"), "View approved plan");
    await this.click('[data-task-action="view-plan"]');
    await this.until(`!document.getElementById('plans-overlay').hidden && document.getElementById('tasks-overlay').hidden && document.querySelector('#plans-list [data-plan-id="${planId}"]')?.getAttribute('aria-pressed') === 'true'`, "task returns to its own approved plan");
    await this.until("document.getElementById('plans-notice').textContent.startsWith('Your drafts stay')", "approved plan finishes loading after navigation");
    assert.equal(await this.run("return document.getElementById('plans-spec-text').value;"), specText, "task origin link opens the retained approved specification");
    this.check("Converted task and its approved plan link back to one another");
    const confirmed = await this.run(`return window.mefiStudio.tasksAction(${JSON.stringify({ projectId: config.alpha.id, taskId: task.id, action: "status", status: "done" })});`);
    assert.equal(confirmed.ok, true, confirmed.error);
    await this.until("document.getElementById('plans-execution')?.textContent.includes('Confirmed by you') && document.getElementById('plans-workflow')?.dataset.stage === 'verify'", "visible task progress refreshes from the real board without reopening the plan");
    assert.equal(await this.run("return document.getElementById('plans-execution').textContent.includes('Verified');"), false, "manual confirmation must not be presented as automatic verification");
    await this.run("document.getElementById('plans-detail').scrollTop = 0;");
    await this.capture("14-board-completion-update");
    this.check("The visible plan follows real board completion and identifies manual confirmation accurately");
    await this.click("#plans-history > summary");
    await this.until("document.getElementById('plans-history').open", "planning history opens");
    await this.click("#plans-history details > summary");
    await this.until("document.querySelector('#plans-history details').open && document.getElementById('plans-history').textContent.includes('Markdown')", "saved revision snapshot is visible");
    await this.click("#plans-history > details[open] > details > summary");
    const revisionText = await this.run("return document.querySelector('#plans-history > details[open]').innerText;");
    assert(revisionText.includes(destination) && revisionText.includes("chronological order") && revisionText.includes(specText), "revision history retains destination, decision and specification text");
    await this.run("document.getElementById('plans-history').scrollIntoView({block:'start'});");
    await this.capture("10-plan-revision-history");
    this.check("Saved plan revisions expose the earlier destination, decisions and specification");

    // A renderer reload is a new view over the actual persisted host stores.
    await new Promise(resolve => { this.webContents.once("did-finish-load", resolve); this.webContents.reload(); });
    await this.until("window.MefiPlanning && document.getElementById('boot-layer')?.hidden", "renderer reload completes");
    plan = (await this.list()).find(item => item.id === planId);
    assert.equal(plan.spec.text, specText, "plan and specification survive renderer reload");
    assert((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).some(item => item.id === task.id));
    await this.selectProject(config.beta.id);
    assert.deepEqual(await this.list(config.beta.id), [], "first project plans do not leak into another project");
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 0, "first project tasks do not leak into another project");
    const betaCreated = await this.action({ action: "create", projectId: config.beta.id, title: "Weather dashboard", destination: "Show today's forecast", outOfScope: "Notifications" });
    assert.equal(betaCreated.ok, true, betaCreated.error);
    await this.run("window.MefiNav.go('plans');");
    await this.until("document.getElementById('plans-list').textContent.includes('Weather dashboard')", "second project plan is visible");
    assert.equal(await this.run(`return document.getElementById('plans-list').textContent.includes(${JSON.stringify(title)});`), false, "Plans list shows only the selected project");
    await this.capture("06-second-project");
    await this.selectProject(config.alpha.id);
    await this.run("window.MefiPlanning.open();");
    await this.until(`document.getElementById('plans-list').textContent.includes(${JSON.stringify(title)})`, "original project plan restored");
    assert.equal((await this.list()).length, 1);
    assert.equal((await this.list())[0].id, planId);
    assert((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).some(item => item.id === task.id));
    this.check("Plans and converted tasks survive reload and stay isolated between projects");

    await this.run(`window.MefiPlanning.open({planId:${JSON.stringify(planId)}});`);
    await this.until("document.getElementById('plans-detail').textContent.includes('Markdown')", "original plan detail restored");
    this.setContentSize(900, 900);
    await sleep(250);
    const narrow = await this.run("const sheet = document.getElementById('plans-sheet'); const detail = document.getElementById('plans-detail'); return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,sheetWidth:sheet.clientWidth,sheetScroll:sheet.scrollWidth,detailWidth:detail.clientWidth,detailScroll:detail.scrollWidth};");
    assert.equal(narrow.width, 900);
    assert.equal(narrow.height, 900);
    assert(narrow.scroll <= narrow.width + 2 && narrow.sheetScroll <= narrow.sheetWidth + 2 && narrow.detailScroll <= narrow.detailWidth + 2, "Plans fits the narrow viewport without horizontal overflow");
    report.narrow = narrow;
    await this.capture("07-narrow-plan");
    this.setContentSize(1460, 940);
    await sleep(250);
    await this.capture("08-wide-plan");
    this.setContentSize(640, 820);
    await sleep(250);
    const small = await this.run("const detail = document.getElementById('plans-detail'); return {width:innerWidth,scroll:document.documentElement.scrollWidth,detailWidth:detail.clientWidth,detailScroll:detail.scrollWidth};");
    assert(small.scroll <= small.width + 2 && small.detailScroll <= small.detailWidth + 2, "the visual workflow fits a small window without horizontal overflow");
    report.small = small;
    await this.run("document.getElementById('plans-detail').scrollTop = 0;");
    await this.capture("13-small-visual-workflow");
    this.check("Planning controls and visual stages fit small, narrow and desktop viewports");
    assert.equal((await this.run("return await window.mefiStudio.backlogStatus();")).counts.running, 0, "conversion must not start workers in the isolated smoke");
  }
}
global.__MefiVerifiedWindow = VerifiedWindow;
require("./main.cjs");
setTimeout(() => finish(new Error("Planning UI verification exceeded 80 seconds")), 80000).unref();
'''


def verify(source, output):
    electron = ROOT / "node_modules/electron/dist/electron.exe"
    if not electron.is_file():
        raise RuntimeError("Install the pinned Electron dependency with npm ci before verifying Plans.")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mefi-planning-ui-") as folder:
        temporary = Path(folder)
        app_root = temporary / "app"
        app_root.mkdir()
        for name in ("main.cjs", "preload.cjs", "README.md", "TESTRUNS.md", ".gitignore"):
            shutil.copy2(source / name, app_root / name)
        for name in ("scripts", "renderer", "assets", "tests"):
            shutil.copytree(source / name, app_root / name)
        (app_root / "tools").mkdir()
        for item in (source / "tools").iterdir():
            if item.is_file() and item.suffix in (".json", ".py"):
                shutil.copy2(item, app_root / "tools" / item.name)
        (app_root / "data").mkdir()
        for name in ("curated.json", "models.json"):
            shutil.copy2(source / "data" / name, app_root / "data" / name)
        # Build the disposable copy, so the harness exercises current renderer
        # sources without touching the committed bundle or any live state.
        subprocess.run(["node", str(app_root / "scripts/build-booklet.mjs")], cwd=app_root,
                       check=True, capture_output=True, text=True, timeout=30)
        alpha = temporary / "Garden Notes"
        beta = temporary / "Pocket Weather"
        for project in (alpha, beta):
            project.mkdir()
            (project / "README.md").write_text(f"# {project.name}\n\nDisposable planning verification project.\n", encoding="utf-8")
        profile = temporary / "profile"
        (profile / "session").mkdir(parents=True)
        alpha_info = {"id": project_id(alpha), "name": alpha.name, "path": str(alpha)}
        beta_info = {"id": project_id(beta), "name": beta.name, "path": str(beta)}
        write_json(profile / "settings.json", {
            "machine": {"autoKill": False},
            "assistant": {"background": False, "keepAwake": False, "proactive": False},
            "projects": {"activeId": alpha_info["id"], "items": [alpha_info, beta_info]},
            "ui": {"useWeb": False, "autoReference": False, "autopilot": {"enabled": False, "execute": False}},
        })
        package = json.loads((source / "package.json").read_text(encoding="utf-8-sig"))
        package["main"] = "planning-verify-entry.cjs"
        write_json(app_root / "package.json", package)
        config = {"profile": str(profile), "appRoot": str(app_root), "output": str(output), "alpha": alpha_info, "beta": beta_info}
        (app_root / package["main"]).write_text(BOOTSTRAP.replace("__CONFIG__", json.dumps(config)), encoding="utf-8")
        main = app_root / "main.cjs"
        instrumented = main.read_text(encoding="utf-8")
        replacements = [
            ("new BrowserWindow({", "new global.__MefiVerifiedWindow({"),
            ("setTimeout(() => startMachineWatch(), 2500);", "/* UI harness: no background machine watcher. */"),
            ("if (!CAPTURE && !CLI_MODE) setTimeout(() => startAssistant()", "if (false) setTimeout(() => startAssistant()"),
            ('if (SMOKE) {\n    window.webContents.once("did-finish-load", async () => {', 'if (false) {\n    window.webContents.once("did-finish-load", async () => {'),
        ]
        for before, after in replacements:
            if instrumented.count(before) != 1:
                raise RuntimeError(f"Temporary harness instrumentation target changed: {before}")
            instrumented = instrumented.replace(before, after, 1)
        main.write_text(instrumented, encoding="utf-8")
        env = {key: value for key, value in os.environ.items() if not any(token in key.upper() for token in ("API_KEY", "API_TOKEN", "GATEWAY_KEY", "STUDIO_KEY", "STUDIO_ZAI_KEY"))}
        for name in ("ELECTRON_RUN_AS_NODE", "OPENCODE_CONFIG_CONTENT"):
            env.pop(name, None)
        env.update(HOME=str(profile), USERPROFILE=str(profile), APPDATA=str(profile / "AppData/Roaming"),
                   LOCALAPPDATA=str(profile / "AppData/Local"), MEFI_STUDIO_BOARD_DB=str(profile / "board.db"),
                   MEFI_STUDIO_REPO=str(alpha), MEFI_STUDIO_GAME_ROOT=str(temporary / "absent-game"))
        for name in ("APPDATA", "LOCALAPPDATA"):
            Path(env[name]).mkdir(parents=True)
        with (output / "electron.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(electron), ".", "--smoke"], cwd=app_root, env=env, stdout=log, stderr=log)
            try:
                process.wait(timeout=90)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
                process.wait(timeout=10)
                raise RuntimeError(f"Electron planning verification timed out. See {output / 'electron.log'}")
        records = [json.loads(line.removeprefix("[planning-ui] ")) for line in (output / "electron.log").read_text(encoding="utf-8", errors="replace").splitlines() if line.startswith("[planning-ui] ")]
        if process.returncode or not records:
            message = records[-1].get("error") if records else f"Electron exited {process.returncode} without a report."
            raise RuntimeError(f"{message}\nSee {output / 'electron.log'}")
        return records[-1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=ROOT / "tools/logs/planning-ui")
    args = parser.parse_args()
    report = verify(args.source.resolve(), args.output.resolve())
    print(f"Plans UI verified: {len(report['checks'])} checks, {len(report['screenshots'])} screenshots in {args.output.resolve()}")
