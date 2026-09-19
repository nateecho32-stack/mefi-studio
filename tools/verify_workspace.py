"""Exercise the real Workspace UI in an isolated offscreen Electron app.

python tools/verify_workspace.py [--output tools/logs/workspace-ui]

Copies application sources and catalog data only. All projects, credentials,
board files, Electron profile, and HOME are disposable. No paid/model/network
requests or executor processes are allowed. PNGs and a JSON report are retained.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


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
const report = { checks: [], screenshots: [], networkAttempts: [], consoleErrors: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failNextMessage = false;
let folderPickerCalls = 0;
// Exercise cancellation at the native dialog boundary without opening a visible
// OS window. Project registration and every successful action use real IPC.
electron.dialog.showOpenDialog = async () => { folderPickerCalls += 1; return { canceled: true, filePaths: [] }; };
const originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
electron.ipcMain.handle = (channel, handler) => originalHandle(channel, (event, ...args) => {
  if (channel === "assistant:message" && failNextMessage) {
    failNextMessage = false;
    return { ok: false, error: "Synthetic interrupted connection for UI verification." };
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
  console.log("[workspace-ui] " + JSON.stringify(report));
  electron.app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);
global.fetch = async (url) => {
  report.networkAttempts.push(String(url));
  throw new Error("External network is disabled by the isolated UI harness");
};
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
      try { report.failureState = await this.run("return {workspace:window.MefiWorkspace?.isActive?.(),command:window.MefiIdle?.isActive?.(),feedback:document.getElementById('workspace-feedback')?.textContent,chatMode:document.getElementById('workspace-mode-chat')?.getAttribute('aria-pressed')};"); } catch {}
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
  async capture(name) {
    // Hidden offscreen windows can retain the constellation's last canvas
    // frame after navigation even though DOM hit testing is already current.
    this.webContents.invalidate();
    await sleep(200);
    const image = await this.webContents.capturePage();
    assert(!image.isEmpty(), `${name} screenshot must contain pixels`);
    const output = path.join(config.output, `${name}.png`);
    fs.writeFileSync(output, image.toPNG());
    report.screenshots.push({ name, file: output, ...image.getSize() });
  }
  check(name) { report.checks.push(name); console.log(`[workspace-check] ${name}`); }
  async verify() {
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden", "workspace is the default home");
    await this.until("document.querySelectorAll('#workspace-projects button').length >= 2", "saved projects appear");
    await this.until("document.querySelector('#workspace-ideas span').textContent === '100' && !document.getElementById('workspace-run-backlog').disabled", "the entire seeded backlog loads");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 30, "all thirty fixture tasks survive loading");
    this.check("Workspace opens as home with saved projects");
    await this.capture("01-workspace-home");

    await this.click("#workspace-ideas");
    const firstIdeaPage = await this.run("return document.querySelectorAll('#workspace-work-list .ws-idea-card').length;");
    assert.equal(firstIdeaPage, 20, "large idea inbox renders a bounded initial page");
    assert.equal(await this.run("return document.getElementById('workspace-show-more').hidden;"), false);
    await this.click("#workspace-show-more");
    assert.equal(await this.run("return document.querySelectorAll('#workspace-work-list .ws-idea-card').length;"), 40, "show more reveals older ideas without dropping them");
    await this.run("const input = document.getElementById('workspace-work-search'); input.value = 'Moonlight'; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.until("document.querySelectorAll('#workspace-work-list .ws-idea-card').length === 1 && document.getElementById('workspace-work-list').textContent.includes('Moonlight watering reminders')", "search finds an idea beyond the first page");
    assert.equal(await this.run("return document.getElementById('workspace-show-more').hidden;"), true);
    await this.capture("08-idea-search");
    await this.click('#workspace-work-list [data-backlog-action="promote"]');
    await this.until("(async () => Boolean((await window.mefiStudio.ideasList()).ideas.find(idea => idea.id === 'fixture_idea_099')?.taskId))()", "explicit idea promotion saves a task link");
    await this.until("!document.getElementById('workspace-run-backlog').disabled", "idea promotion settles");
    const promotedIdea = await this.run("return (await window.mefiStudio.ideasList()).ideas.find(idea => idea.id === 'fixture_idea_099');");
    const ideaTask = await this.run(`return (await window.mefiStudio.tasksList()).tasks.find(task => task.id === ${JSON.stringify(promotedIdea.taskId)});`);
    assert(ideaTask && ideaTask.title.includes("Moonlight"), "promoted idea is a durable task");
    assert.equal(ideaTask.projectId, config.alpha.id, "promoted idea task belongs to selected project");
    assert(fs.readFileSync(path.join(config.appRoot, "data", "eyes-feature-ideas.json"), "utf8").includes(promotedIdea.taskId), "idea linkage is persisted");
    await this.run("const input = document.getElementById('workspace-work-search'); input.value = 'Moonlight'; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.click('#workspace-work-list [data-backlog-action="prioritize"]');
    await this.until(`(async () => (await window.mefiStudio.backlogStatus()).next[0]?.id === ${JSON.stringify(ideaTask.id)})()`, "Do next moves chosen task ahead of waiting work");
    await this.until("!document.getElementById('workspace-run-backlog').disabled", "prioritization settles");
    await this.run("const input = document.getElementById('workspace-work-search'); input.value = ''; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.capture("09-prioritized-backlog");
    this.check("A hundred ideas remain searchable, paginated, and explicitly promotable into prioritized project work");

    await this.click("#workspace-add-project");
    await this.until("!document.getElementById('workspace-add-project').disabled", "canceled folder picker settles");
    const afterCancel = await this.run("return await window.mefiStudio.projectsList();");
    assert.equal(folderPickerCalls, 1);
    assert.equal(afterCancel.projects.length, 2, "cancel must not add a project");
    assert.equal(afterCancel.activeId, config.alpha.id, "cancel must preserve the selected project");
    assert(!/project added/i.test(await this.run("return document.getElementById('workspace-feedback').textContent;")), "canceled picker must not announce a project was added");
    this.check("Canceling the native folder picker preserves projects without a false success");

    // A declarative title must become a task without a chat intent heuristic.
    const title = "Garden journal export in Markdown";
    await this.click("#workspace-mode-work");
    await this.run(`const input = document.getElementById('workspace-input'); input.value = ${JSON.stringify(title)}; input.dispatchEvent(new Event('input', {bubbles:true})); input.focus();`);
    await this.click("#workspace-send");
    await this.until(`(async () => (await window.mefiStudio.tasksList()).tasks.some(t => t.title === ${JSON.stringify(title)}))()`, "explicit task is saved");
    await this.until("!document.getElementById('workspace-send').disabled", "task composer becomes usable again");
    const created = await this.run(`return (await window.mefiStudio.tasksList()).tasks.find(t => t.title === ${JSON.stringify(title)});`);
    assert.equal(created.projectId, config.alpha.id);
    assert(fs.readFileSync(path.join(config.appRoot, "data", "eyes-tasks.json"), "utf8").includes(title), "task must be persisted to disk");
    this.check("Give a task saves a durable task in the selected project");
    await this.capture("02-task-created");

    // Enter submits, Shift+Enter preserves multiline drafts without submitting.
    await this.run("const input = document.getElementById('workspace-input'); input.value = 'Keyboard task'; input.focus();");
    this.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter", modifiers: ["shift"] });
    this.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter", modifiers: ["shift"] });
    await sleep(100);
    assert(!(await this.run("return (await window.mefiStudio.tasksList()).tasks.some(t => t.title === 'Keyboard task');")), "Shift+Enter must not submit");
    await this.run("const input = document.getElementById('workspace-input'); input.value = 'Keyboard task'; input.focus();");
    this.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    this.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    await this.until("(async () => (await window.mefiStudio.tasksList()).tasks.some(t => t.title === 'Keyboard task'))()", "Enter submits task");
    await this.until("!document.getElementById('workspace-send').disabled", "keyboard submission settles");
    this.check("Keyboard submission and multiline shortcut work");

    await this.click("#workspace-mode-chat");
    await this.run("const input = document.getElementById('workspace-input'); input.value = 'Hello, Mefi.'; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.click("#workspace-send");
    await this.until("!document.getElementById('workspace-send').disabled && document.querySelectorAll('#workspace-thread .ws-message.assistant').length > 0", "local chat produces a visible reply", 25000);
    const conversation = await this.run("return (await window.mefiStudio.assistantState()).state.messages;");
    assert(conversation.some(message => message.role === "user" && message.text === "Hello, Mefi."), "chat ask is saved");
    assert(conversation.some(message => message.role === "assistant" && message.text), "keyless chat still replies");
    this.check("Conversation sends a real keyless message and displays the reply");

    await this.click("#workspace-done");
    await this.until("document.getElementById('workspace-work-list').textContent.includes('Finish the garden planner')", "Done shows completed task");
    assert(!(await this.run("return document.getElementById('workspace-work-list').textContent.includes('Review the seed importer');")), "awaiting review must not masquerade as done");
    await this.capture("03-completed-work");
    const cardLayout = await this.run("const list = document.getElementById('workspace-work-list'); const card = list.querySelector('.ws-work-card'); return {width:list.clientWidth,scroll:list.scrollWidth,cardWidth:card.clientWidth,cardScroll:card.scrollWidth};");
    report.completedCardLayout = cardLayout;
    assert(cardLayout.scroll <= cardLayout.width + 2 && cardLayout.cardScroll <= cardLayout.cardWidth + 2, "completed task summary must wrap inside its card without horizontal scrolling");
    await this.click('[data-task-id="fixture_done"]');
    await this.until("!document.getElementById('tasks-overlay').hidden && document.getElementById('task-title').textContent.includes('Finish the garden planner')", "completed task opens its detail");
    assert(await this.run("return document.getElementById('task-list').textContent.includes('Finish the garden planner');"), "selected done task must remain visible in board list");
    await this.capture("04-completed-detail");
    await this.click("#tasks-close");
    this.check("Completed work is visible and opens its result detail");

    await this.run("window.MefiNav.go('tasks', {taskId:'fixture_open'});");
    await this.until("document.getElementById('task-title').textContent.includes('Plan a planting calendar') && document.querySelector('[data-task-panel=dependencies]')", "task planning details appear");
    await this.click('[data-task-panel="dependencies"] > summary');
    assert.equal(await this.run("return Boolean(document.querySelector('[data-dependency-id=fixture_open]'));"), false, "a task cannot depend on itself");
    await this.click('[data-dependency-id="fixture_backlog_08"]');
    await this.click('[data-task-action="dependencies"]');
    await this.until("(async () => (await window.mefiStudio.tasksList()).tasks.find(task => task.id === 'fixture_open').dependsOn?.includes('fixture_backlog_08'))()", "saved prerequisite survives a real store read");
    await this.until("document.querySelector('[data-task-readiness=waiting]')", "task shows the actual dependency hold");
    await this.until("document.querySelector('#task-list li.selected [data-readiness=waiting]')", "board row agrees with the prerequisite hold in task details");
    await this.click('[data-task-panel="handoff"] > summary');
    await this.until("document.querySelector('.task-handoff-text')?.textContent.includes('Plan a planting calendar')", "handoff carries saved task context");
    await this.capture("13-task-prerequisites");
    const baseline = await this.run("return (await window.mefiStudio.tasksHistory({taskId:'fixture_open'})).entries.find(entry => !entry.snapshot.dependsOn?.length);");
    assert(baseline?.id, "legacy task obtains a recoverable baseline before its first context change");
    const revisedBrief = "Add seasonal dates, export reminders, and preserve the planting notes.";
    await this.run(`const tasks = (await window.mefiStudio.tasksList()).tasks; const task = tasks.find(task => task.id === 'fixture_open'); task.prompt = ${JSON.stringify(revisedBrief)}; task.updatedAt = Date.now(); const result = await window.mefiStudio.tasksSave(tasks); if (!result.ok) throw new Error(result.error || 'Fixture brief edit failed');`);
    await this.until(`document.getElementById('task-detail').textContent.includes(${JSON.stringify(revisedBrief)})`, "updated brief appears in the selected detail");
    await this.click('[data-task-panel="history"] > summary');
    await this.until(`document.querySelector('[data-revision-id="${baseline.id}"] [data-task-action=restore]')`, "older brief is available to restore");
    await this.click('[data-task-panel="dependencies"] > summary');
    await this.click('[data-task-panel="handoff"] > summary');
    await this.run("document.querySelector('[data-task-panel=history]').scrollIntoView({block:'start'});");
    await this.capture("14-task-history");
    await this.click(`[data-revision-id="${baseline.id}"] [data-task-action="restore"]`);
    await this.until("(async () => (await window.mefiStudio.tasksList()).tasks.find(task => task.id === 'fixture_open').prompt === 'Add dates for the next planting season.')()", "restoring history recovers earlier requirements");
    await this.until("document.getElementById('task-detail').textContent.includes('Earlier brief restored')", "restore reports the saved result");
    const restoredTask = await this.run("return (await window.mefiStudio.tasksList()).tasks.find(task => task.id === 'fixture_open');");
    assert.equal(restoredTask.status, "open", "restoring a brief never rewinds task status");
    assert.equal(restoredTask.dependsOn?.length || 0, 0, "restored prerequisite context matches the chosen earlier brief");
    assert(fs.readFileSync(path.join(config.alpha.path, "README.md"), "utf8").includes("Disposable UI verification project"), "restoring a brief never changes project files");
    await this.click("#tasks-close");
    this.check("Prerequisites hold work, saved handoffs retain context, and earlier briefs restore without changing project files or task status");

    await this.click("#workspace-review");
    await this.until("document.getElementById('workspace-work-list').textContent.includes('Review the seed importer')", "review filter shows unverified work");
    this.check("Awaiting review is separate from completed work");
    await this.run("const input = document.getElementById('workspace-input'); input.value = 'A draft just for Garden Notes'; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.click(`#workspace-projects [data-project-id="${config.beta.id}"]`);
    await this.until(`(async () => (await window.mefiStudio.projectsList()).activeId === ${JSON.stringify(config.beta.id)})()`, "switch to second project");
    await this.until("document.getElementById('workspace-project-name').textContent.includes('Pocket Weather')", "second project heading");
    const betaTasks = await this.run("return (await window.mefiStudio.tasksList()).tasks;");
    assert(!betaTasks.some(t => t.title === title || t.id === "fixture_done"), "first project's board must not leak to second project");
    assert(!(await this.run("return (await window.mefiStudio.ideasList()).ideas;")).some(idea => idea.id === "fixture_idea_099"), "first project's idea backlog must not leak to second project");
    assert(!(await this.run("return document.getElementById('workspace-thread').textContent.includes('Hello, Mefi.');")), "conversation must not leak across projects");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "", "first project's draft must not leak across projects");
    await this.click("#workspace-mode-work");
    await this.run("document.getElementById('workspace-input').value = 'Weather station quick view';");
    await this.click("#workspace-send");
    await this.until("(async () => (await window.mefiStudio.tasksList()).tasks.some(t => t.title === 'Weather station quick view'))()", "second project task saved");
    await this.until("!document.getElementById('workspace-send').disabled", "second project task settles");
    const betaFile = path.join(config.appRoot, "data", "projects", config.beta.id, "eyes-tasks.json");
    assert(fs.readFileSync(betaFile, "utf8").includes("Weather station quick view"), "second project task must be persisted separately");
    await this.capture("05-second-project");
    await this.click(`#workspace-projects [data-project-id="${config.alpha.id}"]`);
    await this.until(`(async () => (await window.mefiStudio.projectsList()).activeId === ${JSON.stringify(config.alpha.id)})()`, "return to first project");
    const alphaTasks = await this.run("return (await window.mefiStudio.tasksList()).tasks;");
    assert(alphaTasks.some(t => t.id === created.id), "first project's task survives switching");
    assert(!alphaTasks.some(t => t.title === "Weather station quick view"), "second project's task does not leak back");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "A draft just for Garden Notes", "first project's draft survives switching");
    this.check("Project switching keeps tasks and conversation isolated and durable");

    await this.click("#workspace-pause");
    await this.until("(async () => (await window.mefiStudio.assistantState()).state.status === 'paused')()", "pause control updates service");
    await this.click("#workspace-pause");
    await this.until("(async () => (await window.mefiStudio.assistantState()).state.status === 'running')()", "resume control updates service");
    this.check("Pause and resume use the real assistant service");

    await this.until("!document.getElementById('workspace-run-backlog').disabled", "backlog controls are ready");
    await this.click("#workspace-run-backlog");
    await this.until("(async () => { const backlog = await window.mefiStudio.backlogStatus(); return backlog.draining && !backlog.paused; })()", "run backlog enables existing work mode");
    await this.until("document.getElementById('workspace-run-backlog').textContent.includes('Pause backlog') && !document.getElementById('workspace-run-backlog').disabled", "backlog action exposes pause after starting");
    await this.capture("10-backlog-enabled");
    await this.click("#workspace-run-backlog");
    await this.until("(async () => (await window.mefiStudio.backlogStatus()).paused)()", "pause backlog prevents new scheduling");
    await this.until("!document.getElementById('workspace-run-backlog').disabled", "backlog pause settles");
    assert.equal((await this.run("return await window.mefiStudio.backlogStatus();")).counts.running, 0, "isolated smoke must not launch paid workers");
    this.check("Work through backlog and Pause update the real scheduling state without paid workers");

    await this.click("#workspace-tools > summary");
    await this.until("document.querySelector('#workspace-tool-links [data-nav=command]')", "advanced tools are discoverable");
    await this.capture("06-tools-menu");
    await this.click('#workspace-tool-links [data-nav="command"]');
    await this.until("window.MefiIdle?.isActive?.() && !window.MefiWorkspace.isActive()", "constellation opens from tools");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace.isActive() && !window.MefiIdle.isActive()", "workspace returns from constellation");
    this.check("Grouped tools navigate out and back without overlapping views");

    await this.click("#workspace-mode-chat");
    failNextMessage = true;
    await this.run("const input = document.getElementById('workspace-input'); input.value = 'Keep this draft when the connection fails'; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.click("#workspace-send");
    await this.until("!document.getElementById('workspace-send').disabled && document.getElementById('workspace-feedback').classList.contains('error')", "failed send restores usable composer");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "Keep this draft when the connection fails");
    assert((await this.run("return document.getElementById('workspace-feedback').textContent;")).includes("interrupted connection"), "failed send explains the actual error");
    this.check("A failed chat request preserves the draft and offers a usable retry");
    await this.run("const input = document.getElementById('workspace-input'); input.value = 'A draft just for Garden Notes'; input.dispatchEvent(new Event('input', {bubbles:true}));");

    await this.run("const name = document.getElementById('workspace-agent-name'); name.value = 'Pip'; name.dispatchEvent(new Event('input', {bubbles:true}));");
    assert((await this.run("return document.getElementById('workspace-companion-name').textContent;")).includes("Pip"), "personal companion name is displayed");
    await new Promise((resolve) => { this.webContents.once("did-finish-load", resolve); this.webContents.reload(); });
    await this.until("window.MefiWorkspace?.isActive?.() && document.querySelectorAll('#workspace-projects button').length >= 2", "workspace returns after reload");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).some(task => task.id === created.id), "task survives renderer reload");
    assert((await this.run("return document.getElementById('workspace-companion-name').textContent;")).includes("Pip"), "personal companion name survives reload");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "A draft just for Garden Notes", "project draft survives reload");
    this.check("Personalization, drafts and durable project work survive reload");

    this.setContentSize(820, 900);
    await sleep(300);
    const narrow = await this.run("return {width:innerWidth,scroll:document.documentElement.scrollWidth, workspace:document.getElementById('workspace-layer').getBoundingClientRect().toJSON(), input:document.getElementById('workspace-input').getBoundingClientRect().toJSON()};");
    report.narrow = narrow;
    assert(narrow.scroll <= narrow.width + 2, "narrow layout must not create page horizontal overflow");
    assert(narrow.input.width > 180, "composer remains usable in narrow layout");
    assert(narrow.input.right <= narrow.width + 2, "composer fits narrow viewport");
    await this.capture("07-narrow-workspace");
    await this.click("#workspace-ideas");
    await this.run("const input = document.getElementById('workspace-work-search'); input.value = 'LongUnbrokenIdeaReference'; input.dispatchEvent(new Event('input', {bubbles:true})); document.getElementById('workspace-work-list').scrollIntoView({block:'center'});");
    const narrowBacklog = await this.run("const list = document.getElementById('workspace-work-list'); const card = list.querySelector('.ws-work-card'); return {width:innerWidth,scroll:document.documentElement.scrollWidth,listWidth:list.clientWidth,listScroll:list.scrollWidth,cardWidth:card?.clientWidth,cardScroll:card?.scrollWidth};");
    assert(narrowBacklog.cardWidth > 180, "long idea card remains usable on narrow window");
    assert(narrowBacklog.listScroll <= narrowBacklog.listWidth + 2 && narrowBacklog.cardScroll <= narrowBacklog.cardWidth + 2, "long idea references wrap inside narrow cards");
    await this.capture("11-narrow-backlog");
    this.setContentSize(1280, 720);
    await this.run("document.querySelector('.ws-main').scrollTop = 0; const input = document.getElementById('workspace-work-search'); input.value = ''; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await sleep(250);
    const shortLayout = await this.run("const list = document.getElementById('workspace-work-list').getBoundingClientRect(); const input = document.getElementById('workspace-input').getBoundingClientRect(); const run = document.getElementById('workspace-run-backlog').getBoundingClientRect(); return {height:innerHeight,width:innerWidth,scroll:document.documentElement.scrollWidth,list:list.toJSON(),input:input.toJSON(),run:run.toJSON()};");
    assert(shortLayout.scroll <= shortLayout.width + 2, "short desktop layout must not overflow horizontally");
    assert(shortLayout.list.height >= 110, "short desktop leaves usable scrolling room for backlog cards");
    assert(shortLayout.input.bottom < shortLayout.height && shortLayout.run.bottom < shortLayout.height, "composer and backlog action stay visible at 720 pixels tall");
    await this.capture("12-short-desktop");
    report.narrowBacklog = narrowBacklog;
    report.shortDesktop = shortLayout;
    this.check("Narrow layout keeps conversation and composer usable");
    this.check("Dense backlog and long idea references fit narrow and short desktop layouts");
    report.createdTaskId = created.id;
    assert.equal(report.networkAttempts.length, 0, "UI flow must not attempt external network calls");
    const serious = report.consoleErrors.filter(line => !/ERR_FILE_NOT_FOUND/.test(line));
    assert.equal(serious.length, 0, `Renderer errors: ${serious.join('; ')}`);
  }
}
global.__MefiVerifiedWindow = VerifiedWindow;
require("./main.cjs");
setTimeout(() => finish(new Error("Workspace UI verification exceeded 70 seconds")), 70000).unref();
'''


def verify(source, output):
    electron = ROOT / "node_modules/electron/dist/electron.exe"
    if not electron.is_file():
        raise RuntimeError("Install the pinned Electron dependency with npm ci before verifying Workspace.")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mefi-workspace-ui-") as folder:
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
        # Build the disposable copy so a concurrently edited source tree never
        # silently tests an older committed bundle. The real bundle is untouched.
        subprocess.run(["node", str(app_root / "scripts/build-booklet.mjs")], cwd=app_root,
                       check=True, capture_output=True, text=True, timeout=30)
        alpha = temporary / "Garden Notes"
        beta = temporary / "Pocket Weather"
        for project in (alpha, beta):
            project.mkdir()
            (project / "README.md").write_text(f"# {project.name}\n\nDisposable UI verification project.\n", encoding="utf-8")
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
        now = int(time.time() * 1000)
        tasks = [
            {"id": "fixture_done", "title": "Finish the garden planner", "prompt": "Save the garden planner layout.", "status": "done", "createdAt": now - 7200000, "updatedAt": now - 600000, "doneAt": now - 600000, "logs": [{"at": now - 600000, "kind": "result", "text": "Added a weekly garden view and verified the keyboard controls."}], "refs": [], "ideas": []},
            {"id": "fixture_review", "title": "Review the seed importer", "prompt": "Check the seed importer output.", "status": "awaiting_verification", "createdAt": now - 3600000, "updatedAt": now - 300000, "logs": [{"at": now - 300000, "kind": "result", "text": "Importer run finished; verification is still pending."}], "refs": [], "ideas": []},
            {"id": "fixture_open", "title": "Plan a planting calendar", "prompt": "Add dates for the next planting season.", "status": "open", "createdAt": now - 1800000, "updatedAt": now - 1800000, "logs": [], "refs": [], "ideas": []},
        ]
        # A real backlog must remain usable, not just the three-card empty-state
        # demo. The long tokens deliberately catch hidden horizontal overflow.
        topics = ["watering schedule", "seed inventory", "harvest journal", "soil readings", "bed layout", "weather alerts", "plant profiles", "garden sharing", "season archive"]
        for index in range(27):
            status = "done" if index < 5 else "awaiting_verification" if index < 8 else "open"
            tasks.append({
                "id": f"fixture_backlog_{index:02d}",
                "title": f"Improve {topics[index % len(topics)]} — pass {index + 1}",
                "prompt": "Keep the next step small, preserve existing entries, and verify keyboard navigation. " + ("VeryLongRepositoryReference" * 6 if index == 9 else ""),
                "status": status, "createdAt": now - (index + 20) * 3600000,
                "updatedAt": now - (index + 20) * 1800000,
                "logs": [{"at": now - (index + 20) * 1800000, "kind": "result", "text": "Saved the update and checked the documented flow."}] if status == "done" else [],
                "refs": [], "ideas": [],
            })
        write_json(app_root / "data" / "eyes-tasks.json", tasks)
        ideas = [{
            "id": f"fixture_idea_{index:03d}",
            "title": "Moonlight watering reminders" if index == 99 else f"Garden notebook idea {index + 1}: {topics[index % len(topics)]}",
            "detail": "Add a quiet reminder for the evening watering round with an editable time." if index == 99 else f"Explore {topics[index % len(topics)]} with a clear preview and an undoable first step. " + ("LongUnbrokenIdeaReference" * 6 if index == 98 else ""),
            "tags": ["garden", "backlog"], "source": "chat", "at": now - (index + 1) * 60000,
            "status": "keep" if index % 10 == 0 else "new", "read": index % 2 == 0,
        } for index in range(100)]
        write_json(app_root / "data" / "eyes-feature-ideas.json", ideas)
        package = json.loads((source / "package.json").read_text(encoding="utf-8"))
        package["main"] = "workspace-verify-entry.cjs"
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
                process.wait(timeout=80)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
                process.wait(timeout=10)
                raise RuntimeError(f"Electron UI verification timed out. See {output / 'electron.log'}")
        records = [json.loads(line.removeprefix("[workspace-ui] ")) for line in (output / "electron.log").read_text(encoding="utf-8", errors="replace").splitlines() if line.startswith("[workspace-ui] ")]
        if process.returncode or not records:
            message = records[-1].get("error") if records else f"Electron exited {process.returncode} without a report."
            raise RuntimeError(f"{message}\nSee {output / 'electron.log'}")
        return records[-1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=ROOT / "tools/logs/workspace-ui")
    args = parser.parse_args()
    report = verify(args.source.resolve(), args.output.resolve())
    print(f"Workspace UI verified: {len(report['checks'])} checks, {len(report['screenshots'])} screenshots in {args.output.resolve()}")
