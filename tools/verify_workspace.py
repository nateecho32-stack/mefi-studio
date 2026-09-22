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
const childProcess = require("node:child_process");
const config = __CONFIG__;
const started = performance.now();
const report = { checks: [], screenshots: [], networkAttempts: [], workerAttempts: [], consoleErrors: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Keep an independent boundary around paid workers even if a future change
// accidentally bypasses the app's --smoke dispatch guard.
const originalSpawn = childProcess.spawn;
childProcess.spawn = (command, args = [], options) => {
  const invocation = [command, ...args].join(" ");
  if (/\bgrok(?:\.exe|\.cmd)?\b|\bopencode\s+run\b/i.test(invocation) && !/\bwhere\.exe\b/i.test(String(command))) {
    report.workerAttempts.push(invocation);
    throw new Error("Coding workers are disabled by the isolated UI harness");
  }
  return originalSpawn(command, args, options);
};
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
    const targetInSidebar = await this.run(`return Boolean(document.querySelector(${JSON.stringify(selector)})?.closest('#workspace-sidebar-panel'));`);
    const sidebarOpen = await this.run("return Boolean(window.MefiSidebar?.isOpen());");
    if (targetInSidebar && !sidebarOpen) {
      // The navigation rail's M+ brand is the project panel's door; the classic
      // shell still opens it from the invisible edge strip.
      const railShell = await this.run("return document.documentElement.dataset.shell === 'rail';");
      await this.click(railShell ? "#app-rail-brand" : "#workspace-sidebar-toggle");
      await sleep(220);
    } else if (!targetInSidebar && sidebarOpen && selector !== "#workspace-sidebar-toggle" && selector !== "#app-rail-brand") {
      await this.click("#workspace-sidebar-close");
      await sleep(220);
    }
    return this.clickVisible(selector);
  }
  // One door to every destination, through the real control a person would use:
  // the rail on the rail shell — held open for the click so its member rows are
  // visible, hittable controls — or the Command dock on the classic shell.
  async openFromNav(id) {
    const railShell = await this.run("return document.documentElement.dataset.shell === 'rail';");
    if (!railShell) return this.click(`#cmd-dock [data-nav="${id}"]`);
    await this.run("document.documentElement.dataset.railPinned = '';");
    await sleep(80);
    try {
      return await this.click(`#app-rail [data-nav="${id}"]`);
    } finally {
      await this.run("delete document.documentElement.dataset.railPinned; window.dispatchEvent(new Event('resize'));");
    }
  }
  async clickVisible(selector) {
    return this.run(`const selector = ${JSON.stringify(selector)}; const el = document.querySelector(selector); if (!el) throw new Error('Missing control: ' + selector); if (el.disabled) throw new Error('Disabled control: ' + selector); el.scrollIntoView({block:'nearest'}); const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden') throw new Error('Hidden control: ' + selector); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); if (!hit || !el.contains(hit)) throw new Error('Obscured control: ' + selector + ' (hit: ' + (hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (typeof hit.className === 'string' && hit.className.trim() ? '.' + hit.className.trim().split(' ').filter(Boolean).join('.') : '') : 'nothing') + ')'); el.click();`);
  }
  async capture(name) {
    // Hidden offscreen windows can retain the constellation's last canvas
    // frame after navigation even though DOM hit testing is already current.
    this.webContents.invalidate();
    await sleep(400);
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
    await this.until("window.MefiOnboarding && !document.getElementById('walkthrough-overlay').hidden", "walkthrough opens automatically on first launch");
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent;"), "Step 1 of 7", "new users start at the first lesson without clicking an invitation");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /scan this computer/i, "the guide opens on the scan stop");
    // The scan stop starts its read-only scan by itself. This launch runs with
    // --smoke, so the host refuses it before OpenCode is asked anything; the
    // stop must say so and offer nothing to save.
    await this.until("document.getElementById('walkthrough-scan-status').classList.contains('error') && document.getElementById('walkthrough-scan-status').textContent.includes('unavailable in smoke')", "the automatic first scan is refused by the isolated launch");
    assert.equal(await this.run("return document.getElementById('walkthrough-scan-apply').hidden;"), true, "a refused scan offers nothing to save");
    assert.equal(await this.run("return document.getElementById('walkthrough-build-mode').hidden;"), true, "the build preference is not offered on the scan stop");
    this.setContentSize(1280, 720);
    await sleep(250);
    const firstUseLayout = await this.run("const sheet=document.getElementById('walkthrough-sheet');const next=document.getElementById('walkthrough-next').getBoundingClientRect();return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,sheet:sheet.getBoundingClientRect().toJSON(),sheetWidth:sheet.clientWidth,sheetScroll:sheet.scrollWidth,next:next.toJSON()};");
    assert(firstUseLayout.scroll <= firstUseLayout.width + 2 && firstUseLayout.sheetScroll <= firstUseLayout.sheetWidth + 2, "automatic walkthrough has no horizontal overflow on a short desktop");
    assert(firstUseLayout.sheet.top >= 0 && firstUseLayout.sheet.bottom <= firstUseLayout.height + 2 && firstUseLayout.next.bottom <= firstUseLayout.height, "automatic walkthrough and its next-step control fit a short desktop");
    assert(firstUseLayout.next.bottom <= firstUseLayout.sheet.bottom - 1, "the short-desktop guide keeps its whole next-step button inside the scroll viewport");
    await this.capture("00a-first-use-short-desktop");
    this.setContentSize(1460, 940);
    await sleep(250);
    await this.capture("00-first-project-guide");
    await this.click("#walkthrough-next");
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent;"), "Step 2 of 7");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Welcome to Mefi/, "the workspace stop follows the scan");
    await this.until("!document.getElementById('walkthrough-build-mode').hidden && !document.getElementById('walkthrough-auto-build').disabled", "first-use build preference loads on the workspace stop");
    assert.equal(await this.run("return document.getElementById('walkthrough-auto-build').checked;"), true, "auto build remains enabled by default for existing preferences");
    await this.click('label[for="walkthrough-auto-build"]');
    await this.until("(async () => (await window.mefiStudio.assistantStatus()).status.autoBuild === false)()", "first-use toggle saves verify-first through real IPC");
    await this.until("!document.getElementById('walkthrough-auto-build').disabled && document.getElementById('walkthrough-build-mode-label').textContent.includes('Verify first')", "first-use guide reports the saved mode");
    assert.equal(JSON.parse(fs.readFileSync(path.join(config.profile, "settings.json"), "utf8")).ui.autopilot.autoBuild, false, "verify-first is stored in the isolated Electron profile");
    await this.capture("00c-first-use-verify-first");
    await this.click("#walkthrough-next");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Map the folder/, "the map stop follows the workspace stop");
    assert.equal(await this.run("return document.getElementById('walkthrough-map').hidden;"), false, "the map stop shows its panel");
    assert.equal(await this.run("return document.getElementById('walkthrough-build-mode').hidden;"), true, "the build preference is not offered on the map stop");
    await this.click("#walkthrough-next");
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent;"), "Step 4 of 7");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Connect/);
    this.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
    this.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
    await this.until("document.getElementById('walkthrough-overlay').hidden", "Escape closes the guide");
    await new Promise((resolve) => { this.webContents.once("did-finish-load", resolve); this.webContents.reload(); });
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden && window.MefiOnboarding", "workspace returns after closing the first-launch guide");
    assert.equal(await this.run("return document.getElementById('walkthrough-overlay').hidden;"), true, "an unfinished guide does not automatically reopen on the next launch");
    await this.until("!document.getElementById('workspace-auto-build').disabled && !document.getElementById('workspace-auto-build').checked", "workspace retains verify-first after renderer reload");
    assert.equal((await this.run("return await window.mefiStudio.backlogStatus();")).counts.ready, 0, "unapproved queued work is not ready in verify-first mode");
    await this.click('label[for="workspace-auto-build"]');
    await this.until("(async () => (await window.mefiStudio.assistantStatus()).status.autoBuild === true)()", "workspace toggle restores auto build");
    assert.equal((await this.run("return (await window.mefiStudio.assistantStatus()).status;")).execute, false, "changing build preference leaves the existing worker pause in place");
    this.check("First-use and workspace toggles persist Auto build or Verify first without changing the worker pause");
    await this.click("#walkthrough-invite-open");
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent;"), "Step 4 of 7", "the reminder reopens the guide at the saved connections stop");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Connect/);
    await this.click("#walkthrough-next");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Give a clear task/, "the create stop follows connections");
    await this.click("#walkthrough-action");
    assert.equal(await this.run("return document.getElementById('workspace-mode-work').getAttribute('aria-pressed');"), "true");
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 30, "guide action prepares but never submits work");
    await this.click("#workspace-task-outline");
    assert.match(await this.run("return document.getElementById('workspace-input').value;"), /Goal:[\s\S]*Done when:[\s\S]*Keep unchanged:/);
    await this.run("const input = document.getElementById('workspace-input'); input.value = ''; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.click("#workspace-mode-chat");
    await this.click("#walkthrough-dismiss");
    this.check("Walkthrough starts automatically for a new user, fits a short desktop, stays closed after reload, resumes its saved lesson and prepares a task without submitting");
    await this.run("window.MefiNav.go('studio');");
    await this.until("!document.getElementById('tab-studio').hidden && !window.MefiWorkspace.isActive()", "grouped settings open");
    const settingsLayout = await this.run("const assistant=document.getElementById('settings-assistant-heading');const worker=document.getElementById('settings-workers-heading');return {assistant:!!assistant,worker:!!worker,optional:[...document.querySelectorAll('#tab-studio .settings-optional')].map(el=>el.open),width:innerWidth,scroll:document.documentElement.scrollWidth};");
    assert(settingsLayout.assistant && settingsLayout.worker, "assistant and worker connections are separate visible groups");
    assert(settingsLayout.optional.length >= 3 && settingsLayout.optional.every(open=>!open), "optional settings begin collapsed");
    assert(settingsLayout.scroll <= settingsLayout.width + 2, "settings do not overflow horizontally");
    await this.until("document.getElementById('ai-routing-status').textContent.includes('Jev key')", "Jev routing reports missing connection honestly");
    assert.equal(await this.run("return document.getElementById('ai-model-selection').value;"), "jev");
    await this.run("const select=document.getElementById('ai-model-selection');select.value='fixed';select.dispatchEvent(new Event('change',{bubbles:true}));");
    await this.until("document.getElementById('ai-routing-status').textContent.includes('Fixed defaults')", "fixed model selection saves");
    assert.equal(await this.run("return (await window.mefiStudio.getAiRouting()).modelSelection;"), "fixed");
    await this.run("const select=document.getElementById('ai-model-selection');select.value='jev';select.dispatchEvent(new Event('change',{bubbles:true}));");
    await this.until("document.getElementById('ai-routing-status').textContent.includes('Jev key')", "Jev model selection saves");
    await this.click("#ai-routing-refresh");
    await this.until("!document.getElementById('ai-routing-refresh').disabled", "routing refresh finishes");
    assert.equal(await this.run("return (await window.mefiStudio.getAiRouting()).modelSelection;"), "jev");
    this.check("Jev model selection and fixed defaults save through real IPC; missing gateway and empty decision states stay truthful");
    await this.capture("00b-settings-connections");
    if (config.routingOnly) {
      this.setSize(900, 720);
      await sleep(250);
      await this.run("document.getElementById('ai-model-selection').scrollIntoView({block:'center'});");
      assert(await this.run("return document.documentElement.scrollWidth <= innerWidth + 2;"), "routing controls fit a narrow window");
      await this.capture("00d-routing-narrow");
      this.check("Model routing controls fit a 900px window");
      assert.equal(report.networkAttempts.length, 0);
      assert.equal(report.consoleErrors.length, 0);
      return;
    }
    await this.run("window.MefiNav.go('workspace');");
    this.check("Settings put assistant and worker connections first with optional integrations collapsed");
    this.check("Workspace opens as home with saved projects");
    await this.capture("01-workspace-home");

    assert.equal(await this.run("return Boolean(document.querySelector('#workspace-layer > .ws-sidebar'));"), false, "the hover drawer replaces the fixed workspace sidebar");
    assert.equal(await this.run("return document.getElementById('workspace-sidebar-panel').inert;"), true, "closed menu is not keyboard accessible");
    const railShell = await this.run("return document.documentElement.dataset.shell === 'rail';");
    if (railShell) {
      // The navigation rail replaced the invisible 6px edge strip: the M+ brand
      // at the top of the rail is the visible, labelled door to the same panel.
      const door = await this.run("const brand=document.getElementById('app-rail-brand'),rail=document.getElementById('app-rail'),strip=document.getElementById('workspace-sidebar-toggle');return {brand:brand.getBoundingClientRect().toJSON(),railRight:rail.getBoundingClientRect().right,label:brand.getAttribute('title')||brand.textContent.trim(),stripShown:getComputedStyle(strip).display!=='none'};");
      assert(door.brand.width > 0 && door.brand.height > 0, "the rail's brand is on screen");
      assert(door.label, "the brand carries a name");
      assert.equal(door.stripShown, false, "the invisible edge strip steps aside for the rail");
      await this.capture("01c-rail-closed");
      await this.click("#app-rail-brand");
      await this.until("window.MefiSidebar.isOpen()", "the brand opens the project panel");
      await sleep(230);
      const drawer = await this.run("return document.getElementById('workspace-sidebar-panel').getBoundingClientRect().toJSON();");
      assert(Math.abs(drawer.left - door.railRight) <= 1 && drawer.width > 0, "the panel opens against the rail's edge");
      assert.equal(await this.run("return document.getElementById('app-rail-brand').getAttribute('aria-expanded');"), "true", "the brand reports the panel open");
      await this.capture("01d-rail-project-panel");
      await this.click("#workspace-sidebar-close");
      await this.until("!window.MefiSidebar.isOpen()", "the panel closes again");
      assert.equal(await this.run("return document.getElementById('workspace-sidebar-panel').inert;"), true);
      this.check("The rail's M+ brand is a visible door to the project panel, which opens against the rail's edge and closes again");
    } else {
    const edge = await this.run("const el=document.getElementById('workspace-sidebar-toggle');const style=getComputedStyle(el);return {rect:el.getBoundingClientRect().toJSON(),height:innerHeight,text:el.textContent.trim(),children:el.children.length,label:el.getAttribute('aria-label'),background:style.backgroundColor,image:style.backgroundImage,shadow:style.boxShadow,borders:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],before:getComputedStyle(el,'::before').content,after:getComputedStyle(el,'::after').content};");
    assert(Math.abs(edge.rect.left) <= 1 && Math.abs(edge.rect.top) <= 1 && Math.abs(edge.rect.bottom - edge.height) <= 1, "the hover area spans the full left edge");
    assert(edge.rect.width > 0 && edge.rect.width <= 8, "the invisible edge stays narrow enough to leave workspace controls usable");
    assert.equal(edge.text, "", "the hover area has no visible Menu label");
    assert.equal(edge.children, 0, "the hover area has no visible glyph");
    assert(edge.label, "the invisible control retains an accessible name");
    assert.equal(edge.background, "rgba(0, 0, 0, 0)", "the edge has no painted tab background");
    assert.equal(edge.image, "none");
    assert.equal(edge.shadow, "none");
    assert(edge.borders.every(value => parseFloat(value) === 0), "the edge has no visible tab border");
    assert([edge.before, edge.after].every(value => value === "none" || value === "normal"), "pseudo-elements do not paint a tab");
    await this.capture("01c-left-edge-closed");
    const outsideMenu = await this.run("return {x:innerWidth - 40,y:Math.round(innerHeight / 2)};");
    for (const [height, focusTarget] of [[0.1, "workspace-sidebar-close"], [0.85, "workspace-agent-name"]]) {
      this.webContents.sendInputEvent({ type: "mouseMove", ...outsideMenu });
      this.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: Math.round(edge.height * height) });
      await this.until("window.MefiSidebar.isOpen()", `hover opens the sidebar at ${height * 100}% of the left edge`);
      await sleep(230);
      const drawer = await this.run("return document.getElementById('workspace-sidebar-panel').getBoundingClientRect().toJSON();");
      assert(Math.abs(drawer.left) <= 1 && drawer.width > 0, "the open drawer is anchored to the left edge");
      this.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(drawer.x + 60), y: Math.round(edge.height * height) });
      await sleep(300);
      assert.equal(await this.run("return window.MefiSidebar.isOpen();"), true, "moving from the edge into the menu keeps it open");
      if (height === 0.1) {
        await this.run("window.MefiMusic.applyTheme('aurora', false);");
        await this.capture("01d-left-sidebar-aurora");
      }
      await this.run(`const el=document.getElementById(${JSON.stringify(focusTarget)});const details=el.closest('details');if(details) details.open=true;el.focus();`);
      assert.equal(await this.run("return document.activeElement.id;"), focusTarget, "a menu control holds keyboard focus before leaving");
      assert(outsideMenu.x > drawer.right, "the dismissal pointer leaves the left drawer");
      this.webContents.sendInputEvent({ type: "mouseMove", ...outsideMenu });
      await this.until("!window.MefiSidebar.isOpen()", "leaving the menu closes it even while a menu control has focus");
      assert.equal(await this.run("return document.getElementById('workspace-sidebar-panel').contains(document.activeElement);"), false, "closing removes keyboard focus from the hidden menu");
      assert.equal(await this.run("return document.getElementById('workspace-sidebar-panel').inert;"), true);
    }
    await this.run("document.querySelector('.ws-personal').open=false;document.getElementById('workspace-sidebar-panel').scrollTop=0;");
    await this.run("window.MefiMusic.applyTheme('gold', false);");
    this.check("An invisible full-height left edge reveals the themed menu, preserves pointer travel and closes on leaving even with focused controls");
    }

    await this.run("document.querySelector('.ws-top-actions [data-nav=palette]').focus();");
    await this.click('.ws-top-actions [data-nav="palette"]');
    assert.equal(await this.run("return document.getElementById('workspace-sidebar-toggle').hidden;"), true, "transient dialogs keep the edge trigger out of their focus scope");
    await this.until("!document.getElementById('palette-status').textContent.includes('Loading project tasks')", "palette loads tasks without opening the board");
    for (const [query, expected] of [["node tree", "Command view"], ["api key", "Settings & connections"], ["color", "Music & themes"], ["season archive", "Improve season archive"]]) {
      await this.run(`const input = document.getElementById('palette-input'); input.value = ${JSON.stringify(query)}; input.dispatchEvent(new Event('input', {bubbles:true}));`);
      assert((await this.run("return document.getElementById('palette-list').textContent;")).includes(expected), `palette finds ${query}`);
    }
    await this.run("document.getElementById('palette-input').focus(); window.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true,cancelable:true}));");
    assert.equal(await this.run("return document.activeElement.id;"), "palette-close", "Tab reaches a visible Close button");
    await this.run("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true,cancelable:true}));");
    assert.equal(await this.run("return document.activeElement.id;"), "palette-input", "Tab stays in the search dialog");
    await this.capture("01a-command-search");
    await this.click("#palette-close");
    assert.equal(await this.run("return document.getElementById('palette-overlay').hidden;"), true);
    assert.equal(await this.run("return document.activeElement.dataset.nav;"), "palette", "closing search restores its opener");
    await this.click('.ws-sidebar .ws-shortcut[data-nav="plans"]');
    await this.until("!document.getElementById('plans-overlay').hidden", "sidebar opens Plans directly");
    await this.run("window.MefiNav.go('workspace');");
    await this.click('.ws-sidebar .ws-shortcut[data-nav="tasks"]');
    await this.until("!document.getElementById('tasks-overlay').hidden", "sidebar opens the task board directly");
    await this.run("window.MefiNav.go('workspace');");
    this.check("Search finds familiar names and current-project tasks, traps keyboard focus, and common sidebar shortcuts open directly");

    await this.run("const input = document.getElementById('workspace-work-search'); input.value = 'Moonlight'; input.dispatchEvent(new Event('input', {bubbles:true}));");
    assert((await this.run("return document.getElementById('workspace-work-list').textContent;")).includes("1 match is available in other views"), "empty Queue explains the matching idea in another view");
    assert.equal(await this.run("return document.querySelector('#workspace-all span').textContent;"), "1");
    await this.click("#workspace-work-list .ws-work-empty button");
    assert.equal(await this.run("return document.getElementById('workspace-all').getAttribute('aria-pressed');"), "true");
    assert((await this.run("return document.getElementById('workspace-work-list').textContent;")).includes("Moonlight watering reminders"));
    await this.capture("01b-search-all-work");
    await this.click("#workspace-clear-search");
    assert.equal(await this.run("return document.activeElement.id;"), "workspace-work-search");
    assert.equal(await this.run("return document.querySelector('#workspace-all span').textContent;"), "130");
    this.check("Work search exposes matches across views and clears without losing keyboard focus");

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

    await this.click('label[for="workspace-auto-build"]');
    await this.until(`(async () => (await window.mefiStudio.backlogStatus()).taskStates.find(task => task.id === ${JSON.stringify(created.id)})?.stage === 'approval')()`, "new task waits for approval when auto build is off");
    await this.click("#workspace-review");
    await this.until("document.getElementById('workspace-work-list').textContent.includes('Review build')", "workspace explains the approval hold");
    await this.capture("02a-verify-first-queue");
    await this.run(`window.MefiNav.go('tasks', {taskId:${JSON.stringify(created.id)}});`);
    await this.until("document.querySelector('#task-status-row [data-task-action=approve]') && document.querySelector('[data-task-readiness=approval]')", "task detail offers approval for its saved scope");
    const beforeApproval = await this.run(`return (await window.mefiStudio.tasksList()).tasks.find(task => task.id === ${JSON.stringify(created.id)});`);
    assert(beforeApproval.buildScope, "the approval form includes a current scope token");
    await this.capture("02b-build-approval-detail");
    await this.click('#task-status-row [data-task-action="approve"]');
    await this.until(`(async () => (await window.mefiStudio.backlogStatus()).taskStates.find(task => task.id === ${JSON.stringify(created.id)})?.stage === 'ready')()`, "approved scope becomes ready through the real service");
    const persistedApproval = JSON.parse(fs.readFileSync(path.join(config.appRoot, "data", "eyes-tasks.json"), "utf8")).find(task => task.id === created.id);
    assert(persistedApproval.buildApproval, "task approval is durable on the board");
    assert.equal((await this.run("return (await window.mefiStudio.assistantStatus()).status;")).execute, false, "approving a task leaves paused workers paused");
    const approvalBrief = "Export the garden journal as Markdown and show a preview before saving.";
    await this.run(`const tasks=(await window.mefiStudio.tasksList()).tasks;tasks.find(task=>task.id===${JSON.stringify(created.id)}).prompt=${JSON.stringify(approvalBrief)};const result=await window.mefiStudio.tasksSave(tasks);if(!result.ok)throw new Error(result.error);`);
    await this.until(`(async () => (await window.mefiStudio.backlogStatus()).taskStates.find(task => task.id === ${JSON.stringify(created.id)})?.stage === 'approval')()`, "editing the approved brief requires a new approval");
    const staleApproval = await this.run(`return await window.mefiStudio.backlogControl({action:'approve',taskId:${JSON.stringify(created.id)},projectId:${JSON.stringify(config.alpha.id)},expectedScope:${JSON.stringify(beforeApproval.buildScope)}});`);
    assert.equal(staleApproval.ok, false, "an outdated approval form cannot authorize a changed task");
    await this.until("document.querySelector('#task-status-row [data-task-action=approve]') && !document.querySelector('#task-status-row [data-task-action=approve]').disabled", "updated task can be reviewed again");
    await this.click('#task-status-row [data-task-action="approve"]');
    await this.until(`(async () => (await window.mefiStudio.backlogStatus()).taskStates.find(task => task.id === ${JSON.stringify(created.id)})?.stage === 'ready')()`, "fresh approval authorizes the revised brief");
    assert.equal((await this.run("return await window.mefiStudio.backlogStatus();")).counts.running, 0, "approval verification never starts a coding worker");
    await this.click("#tasks-close");
    await this.click('label[for="workspace-auto-build"]');
    await this.until("(async () => (await window.mefiStudio.assistantStatus()).status.autoBuild === true)()", "auto build restores for the remaining workspace tour");
    this.check("Verify first holds new work, approves the reviewed task, persists approval, rejects stale scope and requires approval after a brief change");

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

    // The local reply put next work on the table, which the host turns into an
    // open decision. The renderer announces a new decision once, with a toast
    // that stays clickable in the bottom-left corner for nine seconds, so it is
    // answered here instead of being left over the sidebar's lower controls.
    await this.until("(async () => (await window.mefiStudio.assistantState()).state.questions.some(question => question.status === 'open' && question.title === 'Pick the next piece of work'))()", "an offered next step becomes an open decision");
    await this.until("document.querySelector('#toast-host .toast.has-action.show')?.textContent?.includes('Decision needed: Pick the next piece of work')", "a new decision is announced with an actionable toast");
    assert.equal(await this.run("return document.querySelectorAll('#toast-host .toast.show').length;"), 1, "one decision raises one toast");
    await this.click("#toast-host .toast.has-action .toast-action");
    await this.until("window.MefiIdle?.isActive?.() && !window.MefiWorkspace.isActive() && !document.getElementById('cmd-asks').hidden", "the toast's Answer control opens Command on the Ask rail");
    await this.until("document.querySelector('#cmd-ask-list .ask-card[data-status=open] .ask-title')?.textContent === 'Pick the next piece of work'", "the Ask rail shows the waiting decision");
    assert.equal(await this.run("return document.querySelector('#cmd-rail .rail-tab[data-rail-view=ask]').getAttribute('aria-selected');"), "true");
    await this.until("!document.querySelector('#toast-host .toast.show')", "the answered toast leaves the screen");
    await this.click('#cmd-rail .rail-tab[data-rail-view="work"]');
    assert.equal(await this.run("return document.getElementById('cmd-asks').hidden;"), true, "the rail returns to live work for the rest of the tour");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace.isActive() && !window.MefiIdle.isActive()", "workspace returns from the Ask rail");
    this.check("A reply that offers next work raises one decision toast whose Answer control opens the Ask rail in Command");

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
    await this.until("!document.getElementById('workspace-send').disabled", "second project context finishes loading");
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
    await this.until("!document.getElementById('workspace-send').disabled", "first project context finishes loading");
    const alphaTasks = await this.run("return (await window.mefiStudio.tasksList()).tasks;");
    assert(alphaTasks.some(t => t.id === created.id), "first project's task survives switching");
    assert(!alphaTasks.some(t => t.title === "Weather station quick view"), "second project's task does not leak back");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "A draft just for Garden Notes", "first project's draft survives switching");
    this.check("Project switching keeps tasks and conversation isolated and durable");

    // Worker admission has been held since the seeded settings, so the one
    // pause control reads Resume: it reopens admission and wakes the assistant
    // through start-work. Pause then holds new work and the assistant through
    // the backlog service. The smoke launch dispatches no worker in between.
    await this.until("document.getElementById('workspace-pause').textContent === 'Resume'", "held admission offers Resume");
    await this.click("#workspace-pause");
    await this.until("(async () => (await window.mefiStudio.assistantStatus()).status.execute === true && (await window.mefiStudio.assistantState()).state.status === 'running')()", "Resume reopens admission and keeps the assistant running through the real service");
    await this.until("document.getElementById('workspace-pause').textContent === 'Pause'", "open admission offers Pause");
    await this.click("#workspace-pause");
    await this.until("(async () => (await window.mefiStudio.assistantStatus()).status.execute === false && (await window.mefiStudio.assistantState()).state.status === 'paused')()", "Pause holds new work and the assistant through the real backlog service");
    await this.until("document.getElementById('workspace-pause').textContent === 'Resume'", "held work offers Resume again");
    assert.equal((await this.run("return await window.mefiStudio.backlogStatus();")).counts.running, 0, "neither control starts a worker in the isolated launch");
    assert.equal(report.workerAttempts.length, 0, "reopening admission never reaches a coding worker");
    this.check("One pause control resumes through start-work and holds new work through the real backlog service");

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

    await this.run("document.getElementById('workspace-tools').open = true;");
    await this.until("document.querySelector('#workspace-tool-links [data-nav=explorer]') && document.querySelector('#workspace-tool-links [role=group]')", "advanced tools are discoverable in groups");
    await this.capture("06-tools-menu");
    await this.click('#workspace-node-tree');
    await this.until("window.MefiIdle?.isActive?.() && !window.MefiWorkspace.isActive()", "constellation opens from its primary sidebar control");
    await this.click("#workspace-sidebar-toggle");
    await sleep(230);
    await this.capture("06a-sidebar-in-command");
    await this.run("document.getElementById('workspace-sidebar-close').focus(); window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));");
    assert.equal(await this.run("return window.MefiSidebar.isOpen();"), false, "Escape dismisses the drawer");
    assert.equal(await this.run("return window.MefiIdle.isActive();"), true, "Escape leaves the underlying constellation open");
    assert.equal(await this.run("return document.activeElement.id;"), "workspace-sidebar-toggle", "Escape leaves usable keyboard focus");
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

    await this.click(".ws-personal > summary");
    await this.run("const name = document.getElementById('workspace-agent-name'); name.focus(); name.value = 'Pip'; name.dispatchEvent(new Event('input', {bubbles:true}));");
    assert((await this.run("return document.getElementById('workspace-companion-name').textContent;")).includes("Pip"), "personal companion name is displayed");
    await new Promise((resolve) => { this.webContents.once("did-finish-load", resolve); this.webContents.reload(); });
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden && document.querySelectorAll('#workspace-projects button').length >= 2", "workspace returns after reload");
    assert.equal(await this.run("return document.getElementById('walkthrough-overlay').hidden;"), true, "a dismissed guide does not automatically reopen after reload");
    assert.equal(await this.run("return document.getElementById('walkthrough-invitation').hidden;"), true, "a dismissed reminder stays hidden after reload");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).some(task => task.id === created.id), "task survives renderer reload");
    assert((await this.run("return document.getElementById('workspace-companion-name').textContent;")).includes("Pip"), "personal companion name survives reload");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "A draft just for Garden Notes", "project draft survives reload");
    this.check("Personalization, drafts and durable project work survive reload");

    this.setContentSize(600, 760);
    await sleep(250);
    const smallRail = await this.run("return document.documentElement.dataset.shell === 'rail';");
    await this.click(smallRail ? "#app-rail-brand" : "#workspace-sidebar-toggle");
    await sleep(230);
    // Navigation lives in the rail on the rail shell and in the drawer's rows on
    // the classic one; either way it has to be on screen. (A row's own computed
    // display ignores a hidden parent, so ask for a real box.)
    const mobileMenu = await this.run("const panel=document.getElementById('workspace-sidebar-panel'),rail=document.getElementById('app-rail'),railOn=document.documentElement.dataset.shell==='rail';const r=panel.getBoundingClientRect();const shown=el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0;};return {left:r.left,right:r.right,edge:railOn?rail.getBoundingClientRect().right:0,width:panel.clientWidth,scroll:panel.scrollWidth,screen:innerWidth,links:railOn?[...rail.querySelectorAll('.app-rail-head')].length===5&&[...rail.querySelectorAll('.app-rail-head')].every(shown):[...panel.querySelectorAll('.ws-home')].every(shown),addVisible:getComputedStyle(document.getElementById('workspace-add-project')).visibility!=='hidden'};");
    assert(Math.abs(mobileMenu.left - mobileMenu.edge) <= 1, "small-window drawer stays anchored to its edge: the rail's, or the window's");
    assert(mobileMenu.left >= 0 && mobileMenu.right <= mobileMenu.screen + 1 && mobileMenu.scroll <= mobileMenu.width + 1, "small-window drawer fits without horizontal scrolling");
    assert(mobileMenu.links && mobileMenu.addVisible, "navigation and Add project remain available in a small window");
    await this.capture("07a-small-window-sidebar");
    await this.click("#workspace-sidebar-close");
    this.check("The global drawer supports keyboard dismissal over Command and keeps navigation available in small windows");

    this.setContentSize(820, 900);
    await sleep(300);
    const narrow = await this.run("return {width:innerWidth,scroll:document.documentElement.scrollWidth, workspace:document.getElementById('workspace-layer').getBoundingClientRect().toJSON(), input:document.getElementById('workspace-input').getBoundingClientRect().toJSON()};");
    report.narrow = narrow;
    assert(narrow.scroll <= narrow.width + 2, "narrow layout must not create page horizontal overflow");
    assert(narrow.input.width > 180, "composer remains usable in narrow layout");
    assert(narrow.input.right <= narrow.width + 2, "composer fits narrow viewport");
    await this.capture("07-narrow-workspace");
    await this.run("window.MefiNav.go('onboarding');");
    await this.until("!document.getElementById('walkthrough-overlay').hidden", "guide can reopen after dismissal");
    const guideLayout = await this.run("const sheet=document.getElementById('walkthrough-sheet');return {width:sheet.clientWidth,scroll:sheet.scrollWidth,screen:innerWidth,right:sheet.getBoundingClientRect().right};");
    assert(guideLayout.scroll <= guideLayout.width + 2 && guideLayout.right <= guideLayout.screen + 2, "guide fits narrow windows");
    await this.capture("13-narrow-walkthrough");
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent;"), "Step 5 of 7", "the guide reopens at the saved create stop");
    await this.click("#walkthrough-next");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Follow the queue/, "the monitor stop follows create");
    await this.click("#walkthrough-next");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Review results/, "the review stop is last");
    assert.equal(await this.run("return document.getElementById('walkthrough-next').textContent;"), "Finish guide", "the last stop offers to finish");
    await this.click("#walkthrough-next");
    assert.equal(await this.run("return document.getElementById('walkthrough-overlay').hidden;"), true, "guide finishes from saved create lesson");
    assert.equal(await this.run("return document.getElementById('walkthrough-invitation').hidden;"), true, "completed invitation stays out of the way");
    this.check("Walkthrough fits narrow windows and can be completed after reopening");
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
    report.shortDesktop = shortLayout;
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
    assert.equal(report.workerAttempts.length, 0, "UI flow must not attempt to start coding workers");
    const serious = report.consoleErrors.filter(line => !/ERR_FILE_NOT_FOUND/.test(line));
    assert.equal(serious.length, 0, `Renderer errors: ${serious.join('; ')}`);
  }
}
global.__MefiVerifiedWindow = VerifiedWindow;
require("./main.cjs");
setTimeout(() => finish(new Error("Workspace UI verification exceeded 70 seconds")), 70000).unref();
'''


def verify(source, output, routing_only=False):
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
        package = json.loads((source / "package.json").read_text(encoding="utf-8-sig"))
        package["main"] = "workspace-verify-entry.cjs"
        write_json(app_root / "package.json", package)
        config = {"profile": str(profile), "appRoot": str(app_root), "output": str(output), "alpha": alpha_info, "beta": beta_info, "routingOnly": routing_only}
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
    parser.add_argument("--routing-only", action="store_true", help="Verify model routing settings and narrow layout without the broader task workflow")
    args = parser.parse_args()
    report = verify(args.source.resolve(), args.output.resolve(), routing_only=args.routing_only)
    print(f"Workspace UI verified: {len(report['checks'])} checks, {len(report['screenshots'])} screenshots in {args.output.resolve()}")
