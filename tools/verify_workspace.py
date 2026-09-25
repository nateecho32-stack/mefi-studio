"""Exercise the real Workspace UI in an isolated offscreen Electron app.

python tools/verify_workspace.py [--menus-only] [--output tools/logs/workspace-ui]

Copies application sources and catalog data only. All projects, credentials,
board files, Electron profile, and HOME are disposable. No paid/model/network
requests or executor processes are allowed. PNGs and a JSON report are retained.

The regrouped menus are checked by id, data attribute and role: the rail's four
sections and local view rows, its Settings/Search/Help foot, seven Settings
categories with Find a setting and legacy deep links, the page header's way back to Command view, Ctrl+, and Search's
section kinds. A layout sweep captures Workspace, Settings, Style & sound and
Command view at 1440x900, 1280x720 with the rail pinned through Keep menu open
(saved as mefiStudio.railPinned), 1024x640 where that pin must yield, 900x700
and 600x760. --menus-only runs just the menu checks and the sweep.
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
// Page-side helpers for the menu checks, installed on demand because a reload
// drops them: whether an element is drawn, its box, whether a click at its
// centre reaches it, its accessible name, and the visible control that unfolds
// it (a closed <details>' summary, or an aria-controls button that carries
// aria-expanded or aria-haspopup). Menus are found by role, never by position.
const PAGE_PROBE = `window.__harnessProbe ||= (() => {
  const shown = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
  const hits = (el) => {
    if (!shown(el)) return false;
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    const at = document.elementFromPoint(x, y);
    return Boolean(at && (at === el || el.contains(at)));
  };
  const name = (el) => (el ? (el.getAttribute('aria-label') || el.title || el.innerText || '').trim() : '');
  const unfold = (el) => {
    if (!el || shown(el) || el.closest('#workspace-sidebar-panel')) return null;
    for (let details = el.closest('details:not([open])'); details; details = details.parentElement?.closest('details:not([open])')) {
      const summary = [...details.children].find((child) => child.tagName === 'SUMMARY');
      if (summary && shown(summary)) return { button: summary, container: details };
    }
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (!node.id) continue;
      const button = [...document.querySelectorAll('[aria-controls]')].find((candidate) =>
        candidate.getAttribute('aria-controls').split(' ').includes(node.id) && candidate.getAttribute('role') !== 'tab' &&
        (candidate.hasAttribute('aria-expanded') || candidate.hasAttribute('aria-haspopup')) && shown(candidate));
      if (button) return { button, container: node };
    }
    return null;
  };
  return { shown, rect, hits, name, unfold };
})();`;
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
    // What main.cjs asks for; the menu checks hold it to the regroup's 600×560.
    report.windowMinimum = { width: options.minWidth ?? null, height: options.minHeight ?? null };
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
    // The project panel's opener is the rail's M+ on the rail shell; the edge
    // strip it replaced is not on screen there.
    if (selector === "#workspace-sidebar-toggle" && await this.run("return document.documentElement.dataset.shell === 'rail';")) selector = "#app-rail-brand";
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
    // A control folded into a menu (Command's View ▾ holds 2D/3D, labels and
    // zoom) is reached the way a person reaches it: open the menu, click, and
    // close the menu again if the click left it open.
    const menu = await this.openMenuFor(selector);
    try {
      return await this.clickVisible(selector);
    } finally {
      if (menu) await this.closeMenu(menu);
    }
  }
  // Opens the menu that folds a hidden control away, found by role (see
  // PAGE_PROBE's unfold). Returns what closeMenu needs, or null when the
  // control is already on screen or no menu holds it.
  async openMenuFor(selector) {
    const menus = [];
    for (let depth = 0; depth < 12; depth += 1) {
    const menu = await this.run(`${PAGE_PROBE}
      const found = window.__harnessProbe.unfold(document.querySelector(${JSON.stringify(selector)}));
      if (!found) return null;
      found.button.dataset.harnessOpener = '${depth}';
      found.container.dataset.harnessMenu = '${depth}';
      return { opener: '[data-harness-opener="${depth}"]', container: '[data-harness-menu="${depth}"]' };`);
    if (!menu) return menus.length ? menus : null;
    await this.clickVisible(menu.opener);
    await this.until(`(() => { const container = document.querySelector(${JSON.stringify(menu.container)}); return container?.tagName === 'DETAILS' ? container.open : window.__harnessProbe?.shown(container); })()`, `ancestor menu opens for ${selector}`, 3000);
    menus.push(menu);
    }
    throw new Error(`Too many nested menus for ${selector}`);
  }
  async closeMenu(menu) {
    try {
      for (const entry of (Array.isArray(menu) ? [...menu].reverse() : [menu])) {
      const open = await this.run(`${PAGE_PROBE}
        const probe = window.__harnessProbe, container = document.querySelector(${JSON.stringify(entry.container)}), opener = document.querySelector(${JSON.stringify(entry.opener)});
        if (!container || !probe.shown(opener)) return false;
        return container.tagName === 'DETAILS' ? container.open : probe.shown(container);`);
      if (open) await this.clickVisible(entry.opener);
      }
    } finally {
      await this.run("for (const node of document.querySelectorAll('[data-harness-opener], [data-harness-menu]')) { delete node.dataset.harnessOpener; delete node.dataset.harnessMenu; }");
    }
  }
  // One door to every destination, through the real control a person would use:
  // the rail on the rail shell — held open for the click so its member rows are
  // visible, hittable controls — or the Command dock on the classic shell.
  async openFromNav(id, classic = `#cmd-dock [data-nav="${id}"]`) {
    const railShell = await this.run("return document.documentElement.dataset.shell === 'rail';");
    if (!railShell) return this.click(classic);
    const group = await this.run(`return window.MefiNav.railSection(window.MefiNav.get(${JSON.stringify(id)}));`);
    const groups = {work:"tasks", live:"command", models:"booklet"};
    if (groups[group] && id !== groups[group]) await this.click(`#app-rail [data-nav="${groups[group]}"]`);
    if (["onboarding", "help", "community"].includes(id)) await this.click("#app-help-toggle");
    const target = groups[group] && id !== groups[group] ? `#app-local-nav [data-nav="${id}"]` : `#app-rail [data-nav="${id}"]`;
    const visible = `(() => { const box = document.querySelector(${JSON.stringify(target)})?.getBoundingClientRect(); return Boolean(box && box.width && box.height); })()`;
    // Pin and unpin without the width transition: the next step clicks at once,
    // and an offscreen window can leave a transition stuck at its start value,
    // so an animated collapse would still be covering the sheet it just opened.
    // A pin the run set on purpose (Keep menu open) outlives the click.
    const wasPinned = await this.run("const rail=document.getElementById('app-rail');rail.style.transition='none';const pinned='railPinned' in document.documentElement.dataset;document.documentElement.dataset.railPinned='';void rail.offsetWidth;return pinned;");
    await sleep(80);
    let pointed = false;
    try {
      // A pinned rail yields below 1100px, where a person opens the menu by
      // pointing at it; so does the harness when the pin does not hold it open.
      if (!await this.run(`return ${visible};`)) {
        const point = await this.run("const box=document.getElementById('app-rail').getBoundingClientRect();return {x:Math.round(box.left+Math.min(24,box.width/2)),y:Math.round(box.top+box.height/2)};");
        this.webContents.sendInputEvent({ type: "mouseMove", ...point });
        pointed = true;
        await this.until(visible, `pointing at the menu shows ${id}`, 3000);
      }
      return await this.click(target);
    } finally {
      if (pointed) {
        await this.parkPointer();
        await this.until("!document.getElementById('app-rail').matches(':hover')", "the menu lets go once the pointer leaves it", 3000);
      }
      await this.run(`const rail=document.getElementById('app-rail');if(!${wasPinned})delete document.documentElement.dataset.railPinned;void rail.offsetWidth;rail.style.transition='';window.dispatchEvent(new Event('resize'));`);
    }
  }
  // Parks the pointer in the window's top-right corner: off the rail, so a
  // hover cannot hold the menu open, and away from the graph's nodes.
  async parkPointer() {
    const point = await this.run("return {x:Math.max(1,innerWidth-2),y:2};");
    this.webContents.sendInputEvent({ type: "mouseMove", ...point });
    await sleep(60);
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
  // ---- menu regroup: shared with verify_command.py, which takes this class
  // up to verify() ----
  // "Keep menu open" through its real control. It saves nav.js's RAIL_PIN_KEY,
  // mefiStudio.railPinned, which applyShell() reads back at launch. (The
  // registry's "pinRail" action is the node-tree preview's G pin, not this.)
  async setRailPin(pinned) {
    const wanted = await this.run("return document.documentElement.dataset.shell === 'rail' ? document.getElementById('app-rail-pin')?.getAttribute('aria-pressed') === 'true' : null;");
    if (wanted === null || wanted === pinned) return;
    await this.click("#app-rail-pin");
    await this.until(`document.getElementById('app-rail-pin').getAttribute('aria-pressed') === ${JSON.stringify(String(pinned))}`, pinned ? "Keep menu open pins the menu" : "Keep menu open lets the menu go");
    assert.equal(await this.run("try { return localStorage.getItem('mefiStudio.railPinned'); } catch { return null; }"), pinned ? "1" : "0", "the pin is saved under mefiStudio.railPinned");
    await sleep(150);
  }
  async openSurface(surface) {
    if (surface === "music") {
      if (await this.run("return document.getElementById('music-overlay')?.hidden !== false;")) {
        await this.run("window.MefiNav.go('music');");
        await this.click("#settings-canvas-preview");
      }
      await this.until("document.getElementById('music-overlay')?.hidden === false && window.MefiNav.state.transient === 'appearancePreview'", "Appearance preview opens for the layout sweep");
      await sleep(350);
      return;
    }
    const ready = {
      workspace: "window.MefiWorkspace?.isActive?.() && !window.MefiIdle?.isActive?.()",
      studio: "document.getElementById('tab-studio')?.hidden === false && !window.MefiWorkspace?.isActive?.() && !window.MefiIdle?.isActive?.()",
      command: "window.MefiIdle?.isActive?.() && !document.body.dataset.sheet",
    }[surface];
    await this.run(`window.MefiNav.go(${JSON.stringify(surface)});`);
    await this.until(ready, `${surface} opens for the layout sweep`);
    if (surface === "studio") await this.run("window.scrollTo(0, 0);");
    if (surface === "command") {
      await this.run("window.MefiIdle.fitAll?.();");
      await sleep(350);
    } else await sleep(150);
  }
  // One read of everything the sweep asserts, all of it found by id, data
  // attribute or role: the rail's heads by data-section, its foot by data-nav.
  async readMenuLayout(surface) {
    return this.run(`${PAGE_PROBE}
      const { shown, rect, hits, name, unfold } = window.__harnessProbe;
      const entry = (el) => (el ? { id: el.id || null, nav: el.dataset.nav ?? null, name: name(el), box: rect(el), shown: shown(el), hit: hits(el) } : null);
      const root = document.documentElement;
      let saved = null;
      try { saved = localStorage.getItem('mefiStudio.railPinned'); } catch {}
      const surface = ${JSON.stringify(surface)};
      const layout = {
        width: innerWidth, height: innerHeight, scroll: root.scrollWidth,
        shell: root.dataset.shell === 'rail', pinned: 'railPinned' in root.dataset, saved,
        rail: rect(document.getElementById('app-rail')),
        heads: [...document.querySelectorAll('#app-rail .app-rail-head[data-section]')].map((head) => ({ section: head.dataset.section, ...entry(head) })),
        foot: [...document.querySelectorAll('#app-rail-foot .app-rail-foot-item[data-nav]')].map(entry),
        pin: entry(document.getElementById('app-rail-pin')),
      };
      if (surface === 'workspace') {
        layout.surface = rect(document.getElementById('workspace-layer'));
        layout.input = rect(document.getElementById('workspace-input'));
        layout.search = entry(document.querySelector('.ws-top-actions [data-nav="palette"]'));
        layout.invitations = [...document.querySelectorAll('#workspace-layer .walkthrough-invitation')].filter(shown).map((card) => ({ id: card.id, box: rect(card), scroll: card.scrollWidth, client: card.clientWidth }));
      } else if (surface === 'studio') {
        layout.surface = rect(document.getElementById('tab-studio'));
        const title = document.getElementById('page-title');
        layout.title = title ? { text: title.textContent.trim(), ...entry(title) } : null;
        layout.find = entry(document.getElementById('settings-find'));
        layout.nav = rect(document.getElementById('settings-nav'));
        layout.sections = rect(document.getElementById('settings-sections'));
        layout.groups = [...document.querySelectorAll('#settings-nav [data-settings-category]')].map((button) => button.dataset.settingsCategory);
      } else if (surface === 'command') {
        const tools = document.querySelector('.cmd-tools');
        layout.surface = rect(document.getElementById('idle-hud'));
        layout.top = rect(document.querySelector('.cmd-top'));
        layout.tools = rect(tools);
        layout.toolbar = tools ? tools.getAttribute('aria-label') : null;
        // Switch inputs are drawn by their labels; the buttons and selects are the controls.
        layout.controls = tools ? [...tools.querySelectorAll('button, select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')].filter(shown).map(entry) : [];
        layout.groups = tools ? [...tools.querySelectorAll('.cmd-tools-group')].map((group) => ({ role: group.getAttribute('role'), label: (group.getAttribute('aria-label') || '').trim() })) : [];
        layout.kept = Object.fromEntries(['idle-feed-agent-mode', 'idle-fit', 'idle-cam-orbit', 'idle-cam-follow', 'idle-orbit', 'idle-music-toggle', 'idle-ambience', 'idle-exit'].map((id) => {
          const el = document.getElementById(id);
          return [id, el ? { inTools: Boolean(tools && tools.contains(el)), inFeed: Boolean(el.closest('#idle-feed')), shown: shown(el), hit: hits(el) } : null];
        }));
        layout.folded = Object.fromEntries(['idle-view', 'idle-labels', 'idle-zoom-in', 'idle-zoom-out'].map((id) => {
          const el = document.getElementById(id);
          const menu = el ? unfold(el) : null;
          return [id, el ? { shown: shown(el), hit: hits(el), opener: menu ? menu.button.id || name(menu.button) || menu.button.tagName.toLowerCase() : null } : null];
        }));
        layout.viewport = window.MefiIdle?.graphViewport?.() ?? null;
      } else if (surface === 'music') {
        layout.surface = rect(document.querySelector('#music-overlay .music-sheet'));
        layout.close = entry(document.getElementById('music-close'));
        const preview = document.getElementById('music-tree-preview');
        layout.preview = shown(preview) ? rect(preview) : null;
      }
      return layout;`);
  }
  assertMenuLayout(name, size, surface, layout) {
    const inside = (box) => Boolean(box) && box.left >= -1 && box.top >= -1 && box.right <= layout.width + 1 && box.bottom <= layout.height + 1;
    const apart = (a, b) => a.right <= b.left + 2 || b.right <= a.left + 2 || a.bottom <= b.top + 2 || b.bottom <= a.top + 2;
    const edge = layout.shell && layout.rail ? layout.rail.right : 0;
    assert(layout.scroll <= layout.width + 2, `${name}: no horizontal page overflow`);
    if (layout.shell) {
      assert.deepEqual(layout.heads.map((head) => head.section).sort(), ["home", "live", "models", "work"], `${name}: the menu keeps its four heads`);
      if (size.pin && layout.width >= 1100) {
        assert(layout.pinned && layout.rail.width >= 180, `${name}: Keep menu open holds the menu open at ${layout.width}px`);
      } else {
        assert(layout.rail.width <= 96, `${name}: the menu rests as icons${size.pin ? ": a pin yields below 1100px" : ""}`);
        for (const head of layout.heads) assert(inside(head.box) && head.hit, `${name}: the ${head.section} head is on screen and clickable`);
      }
      if (size.pin) assert.equal(layout.saved, "1", `${name}: the saved pin survives the window size`);
      for (const nav of ["studio", "palette"]) {
        const item = layout.foot.find((entry) => entry.nav === nav);
        assert(item, `${name}: the menu foot offers ${nav}`);
        assert(inside(item.box) && item.hit, `${name}: the foot's ${nav} item stays on screen and clickable`);
      }
      assert(layout.pin && inside(layout.pin.box) && layout.pin.hit, `${name}: Keep menu open stays on screen and clickable`);
      assert(layout.surface && layout.surface.left >= edge - 1, `${name}: ${surface} starts at the menu's edge`);
      // These layers sit exactly at --shell-rail-w, so a pin that yields must take the room back.
      if (surface === "workspace" || surface === "command") assert(Math.abs(layout.surface.left - edge) <= 2, `${name}: ${surface} makes room for the menu's width and no more`);
    }
    if (surface === "workspace") {
      assert(layout.input && layout.input.width > 180 && layout.input.right <= layout.width + 2, `${name}: the composer stays usable`);
      if (layout.search) assert(inside(layout.search.box) && layout.search.hit, `${name}: the workspace's Search stays on screen and clickable`);
      for (const card of layout.invitations) assert(card.box.right <= layout.width + 2 && card.scroll <= card.client + 2, `${name}: the ${card.id} card wraps instead of clipping`);
    } else if (surface === "studio") {
      assert(layout.title && layout.title.text === "Settings" && layout.title.shown && layout.title.box.right <= layout.width + 2, `${name}: the page header names Settings`);
      assert(layout.find && layout.find.box && layout.find.box.left >= edge - 1 && layout.find.box.right <= layout.width + 2 && layout.find.hit, `${name}: Find a setting stays on screen and usable`);
      assert.deepEqual(layout.groups, ["general", "appearance", "connections", "models", "automation", "audio", "system"], `${name}: Settings shows its seven categories in the same order`);
      assert(layout.nav && layout.nav.right <= layout.width + 2 && layout.sections && layout.sections.right <= layout.width + 2, `${name}: the Settings list and cards fit`);
    } else if (surface === "command") {
      assert(inside(layout.tools), `${name}: the Command toolbar fits the window`);
      assert(layout.top && layout.top.right <= layout.width + 2, `${name}: the Command header fits`);
      assert(layout.controls.length <= 10, `${name}: the toolbar shows about eight controls, not ${layout.controls.length}`);
      for (const control of layout.controls) {
        const label = control.id ? `#${control.id}` : control.name || "a toolbar control";
        assert(inside(control.box) && control.hit, `${name}: ${label} fits the window and takes the pointer`);
        assert(control.name, `${name}: ${label} has an accessible name`);
      }
      for (const [index, control] of layout.controls.entries()) for (const other of layout.controls.slice(index + 1)) {
        assert(apart(control.box, other.box), `${name}: ${control.id || control.name} and ${other.id || other.name} do not overlap`);
      }
      for (const [id, kept] of Object.entries(layout.kept)) {
        assert(kept, `${name}: #${id} is kept`);
        assert(kept.inTools && !kept.inFeed, `${name}: #${id} stays in the Command toolbar`);
        assert(kept.shown && kept.hit, `${name}: #${id} is on the toolbar and clickable`);
      }
      for (const [id, folded] of Object.entries(layout.folded)) {
        assert(folded, `${name}: #${id} is kept`);
        assert(folded.hit || folded.opener, `${name}: #${id} is on the toolbar or one menu away`);
      }
      assert(layout.groups.length >= 2 && layout.groups.every((group) => group.role === "group" && group.label), `${name}: the toolbar's controls sit in labelled groups`);
    } else if (surface === "music") {
      assert(layout.surface && layout.surface.left >= edge - 1 && layout.surface.right <= layout.width + 2 && layout.surface.top >= -1 && layout.surface.bottom <= layout.height + 2, `${name}: Style & sound fits the window`);
      assert(layout.close && inside(layout.close.box) && layout.close.hit, `${name}: Style & sound's Close stays on screen and clickable`);
      if (layout.preview) {
        assert(apart(layout.surface, layout.preview), `${name}: the live tree sits beside or above the settings, never under them`);
        assert(layout.preview.left >= edge - 1 && layout.preview.right <= layout.width + 2, `${name}: the live tree fits`);
      }
    }
  }
  // Ambience opens under its own button, inside the window and clear of the
  // menu, without the Audio link row that moved out of it.
  async checkAmbience(name, layout) {
    await this.click("#idle-ambience");
    await this.until("document.getElementById('idle-ambience-pop')?.hidden === false", `${name}: Ambience opens`);
    const found = await this.run(`${PAGE_PROBE}
      const { shown, rect, hits } = window.__harnessProbe;
      const pop = document.getElementById('idle-ambience-pop'), button = document.getElementById('idle-ambience'), link = document.getElementById('idle-reactive');
      return { pop: rect(pop), button: rect(button), expanded: button.getAttribute('aria-expanded'), buttonHit: hits(button), audioLink: Boolean(link && pop.contains(link) && shown(link.closest('label') || link)) };`);
    report.menuLayouts.at(-1).ambience = found;
    await this.capture(`${name}-ambience`);
    const edge = layout.shell && layout.rail ? layout.rail.right : 0;
    assert(found.pop.left >= edge - 1 && found.pop.top >= -1 && found.pop.right <= layout.width + 1 && found.pop.bottom <= layout.height + 1, `${name}: Ambience fits the window beside the menu`);
    assert(found.pop.top >= found.button.bottom - 2, `${name}: Ambience opens under its button`);
    assert.equal(found.expanded, "true", `${name}: the Ambience button reports its popover open`);
    assert(found.buttonHit, `${name}: the Ambience button stays clickable to close it`);
    assert.equal(found.audioLink, false, `${name}: the Audio link row has left Ambience`);
    await this.click("#idle-ambience");
    await this.until("document.getElementById('idle-ambience-pop')?.hidden === true", `${name}: Ambience closes`);
  }
  // The regroup's layout sweep: each named surface at five sizes. 1280×720 runs
  // with the rail pinned through Keep menu open, and 1024×640 keeps that pin,
  // which must yield there (below 1100px). Surfaces open through MefiNav, so a
  // broken menu surfaces as a layout failure. Transitions are held still for
  // the sweep: an offscreen window can leave one at its start value, and the
  // sweep measures end states. Each screenshot is taken before its asserts.
  async menuLayouts(prefix, surfaces) {
    const order = ["workspace", "studio", "command", "music"].filter((surface) => surfaces.includes(surface));
    const sizes = [
      { width: 1440, height: 900, pin: false, name: "1440x900" },
      { width: 1280, height: 720, pin: true, name: "1280x720-pinned" },
      { width: 1024, height: 640, pin: true, name: "1024x640-pin-yields" },
      { width: 900, height: 700, pin: false, name: "900x700" },
      { width: 600, height: 760, pin: false, name: "600x760" },
    ];
    const [width, height] = this.getContentSize();
    report.menuLayouts ||= [];
    await this.run("if (!document.getElementById('harness-still')) { const style = document.createElement('style'); style.id = 'harness-still'; style.textContent = '*, *::before, *::after { transition: none !important; }'; document.head.append(style); }");
    try {
      for (const size of sizes) {
        await this.setRailPin(size.pin);
        this.setContentSize(size.width, size.height);
        await sleep(300);
        await this.parkPointer();
        for (const surface of order) {
          const name = `${prefix}-${size.name}-${surface}`;
          await this.openSurface(surface);
          const layout = await this.readMenuLayout(surface);
          report.menuLayouts.push({ name, size, surface, layout });
          // verify_command.py records its graph geometry beside the menu's.
          if (surface === "command" && typeof this.layout === "function") await this.layout(name, false);
          await this.capture(name);
          this.assertMenuLayout(name, size, surface, layout);
          if (surface === "command") await this.checkAmbience(name, layout);
          if (surface === "music") {
            await this.click("#music-close");
            await this.until("!document.body.dataset.sheet", `${name}: Style & sound closes`);
          }
        }
      }
      await this.setRailPin(false);
      this.setContentSize(width, height);
      await sleep(300);
    } finally {
      await this.run("document.getElementById('harness-still')?.remove();");
    }
    this.check(`Menus and ${order.join(", ")} fit 1440×900, 1280×720 pinned, 1024×640 (the pin yields), 900×700 and 600×760`);
  }
  async verify() {
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden", "workspace is the default home");
    await this.until("document.querySelectorAll('#workspace-projects button').length >= 2", "saved projects appear");
    await this.until("document.querySelector('#workspace-ideas span').textContent === '100' && !document.getElementById('workspace-run-backlog').disabled", "the entire seeded backlog loads");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 30, "all thirty fixture tasks survive loading");
    await this.until("window.MefiOnboarding && !document.getElementById('walkthrough-overlay').hidden", "walkthrough opens automatically on first launch");
    if (config.menusOnly) {
      // The menu regroup alone: close the first-run guide through its public
      // control, then check the menus and sweep every surface's layout.
      await this.click('[data-nav-close="onboarding"]');
      await this.until("document.getElementById('walkthrough-overlay').hidden", "Save & close dismisses the first-run walkthrough");
      await this.verifyMenus();
      await this.menuLayouts("20-layout", ["workspace", "studio", "command", "music"]);
      assert.equal(report.networkAttempts.length, 0, "menu checks never reach the network");
      assert.equal(report.workerAttempts.length, 0, "menu checks never start a coding worker");
      const serious = report.consoleErrors.filter(line => !/ERR_FILE_NOT_FOUND/.test(line));
      assert.equal(serious.length, 0, `Renderer errors: ${serious.join('; ')}`);
      return;
    }
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
    await this.verifyMenus();
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
    // The panel is projects-only now (the personal fields moved to Settings ›
    // Your Studio), so its own Add project control holds focus lower down.
    for (const [height, focusTarget] of [[0.1, "workspace-sidebar-close"], [0.85, "workspace-add-project"]]) {
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
    await this.run("document.getElementById('workspace-sidebar-panel').scrollTop=0;");
    await this.run("window.MefiMusic.applyTheme('gold', false);");
    this.check("An invisible full-height left edge reveals the themed menu, preserves pointer travel and closes on leaving even with focused controls");
    }

    await this.run("document.querySelector('.ws-top-actions [data-nav=palette]').focus();");
    await this.click('.ws-top-actions [data-nav="palette"]');
    assert.equal(await this.run("return document.getElementById('workspace-sidebar-toggle').hidden;"), true, "transient dialogs keep the edge trigger out of their focus scope");
    await this.until("!document.getElementById('palette-status').textContent.includes('Loading project tasks')", "palette loads tasks without opening the board");
    // Settings registers each card with Search, so a key question lands on its card.
    for (const [query, expected] of [["node tree", "Command view"], ["api key", "Settings › Connections"], ["color", "Appearance & audio"], ["season archive", "Improve season archive"]]) {
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
    await this.openFromNav("plans", '.ws-sidebar .ws-shortcut[data-nav="plans"]');
    await this.until("!document.getElementById('plans-overlay').hidden", "sidebar opens Plans directly");
    await this.run("window.MefiNav.go('workspace');");
    await this.openFromNav("tasks", '.ws-sidebar .ws-shortcut[data-nav="tasks"]');
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
    // Find the decision toast by what it says. A fresh profile also raises the
    // one-time key tip ("Show keys", 12 s) — another actionable toast that can
    // be showing, or fading, beside it — so "the first actionable toast" can be
    // the tip, and its button opens Shortcuts instead of answering.
    const decisionToast = "[...document.querySelectorAll('#toast-host .toast.has-action.show')].find(toast => toast.textContent.includes('Decision needed: Pick the next piece of work'))";
    await this.until(`Boolean(${decisionToast})`, "a new decision is announced with an actionable toast");
    assert.equal(await this.run("return [...document.querySelectorAll('#toast-host .toast.show')].filter(toast => toast.textContent.includes('Decision needed')).length;"), 1, "one decision raises one toast");
    await this.run(`${decisionToast}.dataset.harness = 'decision';`);
    await this.click("#toast-host .toast[data-harness='decision'] .toast-action");
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
    await this.openFromNav("command", "#workspace-node-tree");
    await this.until("window.MefiIdle?.isActive?.() && !window.MefiWorkspace.isActive()", "constellation opens from its primary sidebar control");
    await this.click("#workspace-sidebar-toggle");
    await sleep(230);
    await this.capture("06a-sidebar-in-command");
    await this.run("document.getElementById('workspace-sidebar-close').focus(); window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));");
    assert.equal(await this.run("return window.MefiSidebar.isOpen();"), false, "Escape dismisses the drawer");
    assert.equal(await this.run("return window.MefiIdle.isActive();"), true, "Escape leaves the underlying constellation open");
    // Focus goes back to the panel's door: the rail's M+, or the edge strip on the classic shell.
    const door = (await this.run("return document.documentElement.dataset.shell === 'rail';")) ? "app-rail-brand" : "workspace-sidebar-toggle";
    assert.equal(await this.run("return document.activeElement.id;"), door, "Escape leaves usable keyboard focus");
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

    // Make yourself at home left the project panel for Settings › Your Studio.
    // The deep link opens that card itself, so its summary is left alone.
    await this.run("window.MefiNav.go('studio', { section: 'settings-studio' });");
    await this.until("(() => { const card = document.getElementById('settings-studio'), box = document.getElementById('workspace-agent-name')?.getBoundingClientRect(); return document.getElementById('tab-studio')?.hidden === false && !window.MefiWorkspace.isActive() && Boolean(card) && (card.tagName !== 'DETAILS' || card.open) && Boolean(box && box.width && box.height); })()", "MefiNav.go('studio', {section: 'settings-studio'}) opens Your Studio");
    await this.capture("06b-settings-your-studio");
    await this.run("const name = document.getElementById('workspace-agent-name'); name.focus(); name.value = 'Pip'; name.dispatchEvent(new Event('input', {bubbles:true}));");
    assert((await this.run("return document.getElementById('workspace-companion-name').textContent;")).includes("Pip"), "the companion name set in Your Studio reaches the workspace");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace?.isActive?.() && !window.MefiIdle?.isActive?.()", "the workspace returns from Your Studio");
    await new Promise((resolve) => { this.webContents.once("did-finish-load", resolve); this.webContents.reload(); });
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden && document.querySelectorAll('#workspace-projects button').length >= 2", "workspace returns after reload");
    assert.equal(await this.run("return document.getElementById('walkthrough-overlay').hidden;"), true, "a dismissed guide does not automatically reopen after reload");
    assert.equal(await this.run("return document.getElementById('walkthrough-invitation').hidden;"), true, "a dismissed reminder stays hidden after reload");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).some(task => task.id === created.id), "task survives renderer reload");
    assert((await this.run("return document.getElementById('workspace-companion-name').textContent;")).includes("Pip"), "personal companion name survives reload");
    assert.equal(await this.run("return document.getElementById('workspace-agent-name').value;"), "Pip", "Your Studio shows the saved companion name after reload");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "A draft just for Garden Notes", "project draft survives reload");
    this.check("Personalization set in Settings › Your Studio, drafts and durable project work survive reload");

    // The regroup's layout sweep, ahead of the narrow and short-desktop gates
    // below so its screenshots land even while one of those fails.
    await this.menuLayouts("20-layout", ["workspace", "studio", "command", "music"]);
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace?.isActive?.() && !window.MefiIdle?.isActive?.()", "the workspace returns after the layout sweep");

    this.setContentSize(600, 760);
    await sleep(250);
    const smallRail = await this.run("return document.documentElement.dataset.shell === 'rail';");
    await this.click(smallRail ? "#app-rail-brand" : "#workspace-sidebar-toggle");
    await sleep(230);
    // Navigation lives in the rail on the rail shell and in the drawer's rows on
    // the classic one; either way it has to be on screen. (A row's own computed
    // display ignores a hidden parent, so ask for a real box.)
    const mobileMenu = await this.run("const panel=document.getElementById('workspace-sidebar-panel'),rail=document.getElementById('app-rail'),railOn=document.documentElement.dataset.shell==='rail';const r=panel.getBoundingClientRect();const shown=el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0;};return {left:r.left,right:r.right,edge:railOn?rail.getBoundingClientRect().right:0,width:panel.clientWidth,scroll:panel.scrollWidth,screen:innerWidth,links:railOn?[...rail.querySelectorAll('.app-rail-head')].length===4&&[...rail.querySelectorAll('.app-rail-head')].every(shown):[...panel.querySelectorAll('.ws-home')].every(shown),addVisible:getComputedStyle(document.getElementById('workspace-add-project')).visibility!=='hidden',personal:Boolean(panel.querySelector('#workspace-person-name,#workspace-agent-name,#workspace-accent,#workspace-motion'))};");
    assert.equal(mobileMenu.personal, false, "the project panel holds projects only: name, theme and motion live in Settings › Your Studio");
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
  // The menu regroup, checked by id, data attribute and role: the rail's
  // sections and foot, Settings' groups, Your Studio, the deep link, Find a
  // setting, the page header's way back, Ctrl+, and Search's section kinds.
  async verifyMenus() {
    assert.deepEqual(report.windowMinimum, { width: 600, height: 560 }, "main.cjs keeps the window at least 600×560");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace?.isActive?.() && !window.MefiIdle?.isActive?.()", "the workspace opens for the menu checks");
    const menu = await this.run(`
      const sections = {};
      for (const section of document.querySelectorAll('#app-rail .app-rail-section[data-section]')) {
        sections[section.dataset.section] = { head: section.querySelector('.app-rail-head')?.dataset.nav ?? null, items: [...section.querySelectorAll('.app-rail-children [data-nav]')].map((item) => item.dataset.nav).sort() };
      }
      const foot = [...document.querySelectorAll('#app-rail-foot .app-rail-foot-item[data-nav]')].map((item) => {
        const glyph = item.querySelector('svg use')?.getAttribute('href') ?? null;
        return { nav: item.dataset.nav, glyph, drawn: Boolean(glyph && document.getElementById(glyph.slice(1))) };
      });
      return { shell: document.documentElement.dataset.shell === 'rail', sections, foot };`);
    report.menu = menu;
    if (menu.shell) {
      assert.deepEqual(Object.keys(menu.sections).sort(), ["home", "live", "models", "work"], "the menu keeps Home, Work, Live and Models groups");
      const members = {
        home: ["workspace", []],
        work: ["tasks", []],
        live: ["command", []],
        models: ["booklet", []],
      };
      for (const [section, [head, items]] of Object.entries(members)) {
        assert.equal(menu.sections[section].head, head, `the ${section} head opens ${head}`);
        assert.deepEqual(menu.sections[section].items, items, `the ${section} section lists ${items.join(", ") || "nothing under its head"}`);
        assert(!items.includes(head), `the ${section} primary destination is listed only once`);
      }
      const foot = { studio: "#g-sliders", palette: "#g-palette" };
      for (const [nav, glyph] of Object.entries(foot)) {
        const item = menu.foot.find((entry) => entry.nav === nav);
        assert(item, `the menu foot offers ${nav}`);
        assert.equal(item.glyph, glyph, `the foot's ${nav} item draws ${glyph}`);
        assert(item.drawn, `${glyph} is in the icon sprite`);
      }
      // Help groups onboarding, shortcuts and Community in one menu.
      await this.click("#app-help-toggle");
      await this.click('#app-rail-foot [data-nav="community"]');
      await this.until("document.getElementById('tab-studio')?.hidden === false && !window.MefiWorkspace.isActive() && document.getElementById('settings-community')?.open === true", "the menu's Community opens Settings › Community");
      await this.capture("00e-community-from-menu");
      await this.run("document.getElementById('settings-community').open = false;");
    }

    await this.run("window.MefiNav.go('studio');");
    await this.until("document.getElementById('tab-studio')?.hidden === false && !window.MefiWorkspace.isActive() && !window.MefiIdle?.isActive?.()", "Settings opens for the menu checks");
    await this.run("window.scrollTo(0, 0);");
    const settings = await this.run(`${PAGE_PROBE}
      const { shown } = window.__harnessProbe;
      const categories = [...document.querySelectorAll('#settings-nav [data-settings-category]')].map((button) => button.dataset.settingsCategory);
      const panes = [...document.querySelectorAll('[data-settings-category-pane]')].filter(shown).map((pane) => pane.dataset.settingsCategoryPane);
      const categoryOf = (id) => document.getElementById(id)?.closest('[data-settings-category-pane]')?.dataset.settingsCategoryPane ?? null;
      return { categories, panes, find: shown(document.getElementById('settings-find')), title: document.getElementById('page-title')?.textContent.trim(),
        locations: Object.fromEntries(['workspace-person-name','motion-toggle','settings-assistant','settings-routing','jev-enabled','settings-audio','settings-log'].map((id) => [id,categoryOf(id)])),
        providersFolded: [...document.querySelectorAll('.provider-tile')].every((node) => node.tagName === 'DETAILS' && !node.open) };`);
    report.settingsMenu = settings;
    assert.deepEqual(settings.categories, ['general', 'appearance', 'connections', 'models', 'automation', 'audio', 'system'], 'Settings exposes seven stable categories');
    assert.equal(settings.panes.length, 1, 'one category is shown at a time');
    assert(settings.find, 'Settings search is visible');
    assert.equal(settings.title, 'Settings');
    assert(settings.providersFolded, 'provider forms begin folded');
    for (const [id, category] of Object.entries({ 'workspace-person-name':'general', 'motion-toggle':'appearance', 'settings-assistant':'connections', 'settings-routing':'models', 'jev-enabled':'automation', 'settings-audio':'audio', 'settings-log':'system' })) assert.equal(settings.locations[id], category, `${id} is grouped under ${category}`);

    await this.run("window.MefiNav.go('studio', { section: 'settings-updates' });");
    await this.until("document.getElementById('settings-updates').open && !document.getElementById('settings-category-system').hidden", 'legacy Updates deep link reveals System');
    await this.capture('00f-settings-updates-deep-link');
    await this.run("const input = document.getElementById('settings-find'); input.focus(); input.value = 'custom provider api key'; input.dispatchEvent(new Event('input', { bubbles: true }));");
    await this.until("Boolean(document.querySelector('[data-settings-result=\"custom-key\"]'))", 'search finds a specific control');
    await this.capture('00g-settings-find');
    this.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    this.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await this.until("document.activeElement?.id === 'custom-key' && document.getElementById('custom-key').closest('details').open && !document.getElementById('settings-category-connections').hidden", 'Enter reveals and focuses the field inside a collapsed provider');
    await this.run("const input = document.getElementById('settings-find'); input.focus(); input.value = 'no-setting-matches'; input.dispatchEvent(new Event('input', { bubbles: true }));");
    this.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    this.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await this.until("document.getElementById('settings-find').value === '' && !document.getElementById('settings-category-connections').hidden", 'Escape returns to the selected category');

    // The page header's way back: shown only when Settings came from Command.
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle?.isActive?.()", "Command opens before the way-back check");
    if (menu.shell) await this.click("#app-rail-foot [data-nav='studio']");
    else await this.openFromNav("studio");
    await this.until("document.getElementById('tab-studio')?.hidden === false && !window.MefiIdle.isActive()", "the menu's Settings opens Settings from Command");
    await this.run("window.scrollTo(0, 0);");
    const header = await this.run(`${PAGE_PROBE}
      const { shown, hits } = window.__harnessProbe;
      const title = document.getElementById('page-title'), back = document.getElementById('page-return');
      return { title: title ? title.textContent.trim() : null, back: back ? { hidden: back.hidden, shown: shown(back), hit: hits(back), nav: back.dataset.nav ?? null, text: back.textContent.trim() } : null };`);
    report.pageReturn = header;
    assert.equal(header.title, "Settings", "the page header names the page it shows");
    assert(header.back && !header.back.hidden && header.back.shown && header.back.hit, "Settings opened from Command offers a visible way back");
    assert.equal(header.back.nav, "command", "the way back goes to Command view");
    assert(header.back.text.includes("Command view"), "the way back reads ← Command view");
    await this.capture("00h-settings-way-back");
    await this.click("#page-return");
    // Command is a layer over the page, so the tab underneath may stay unhidden.
    await this.until("window.MefiIdle?.isActive?.() && window.MefiNav.current?.() === 'command'", "← Command view returns to Command view");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace?.isActive?.()", "the workspace opens before Settings");
    await this.run("window.MefiNav.go('studio');");
    await this.until("document.getElementById('tab-studio')?.hidden === false && !window.MefiWorkspace.isActive()", "Settings opens from the workspace");
    assert.equal(await this.run(`${PAGE_PROBE} const back = document.getElementById('page-return'); return Boolean(back) && !window.__harnessProbe.shown(back);`), true, "Settings opened from the workspace offers no way back to Command");

    // Ctrl+, opens Settings from anywhere; sent the way the capture tour sends Ctrl K.
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace?.isActive?.() && !window.MefiIdle?.isActive?.()", "the workspace opens before Ctrl+,");
    await this.run("document.activeElement?.blur?.(); window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, bubbles: true, cancelable: true }));");
    await this.until("document.getElementById('tab-studio')?.hidden === false && !window.MefiWorkspace.isActive()", "Ctrl+, opens Settings");

    // Search, from the menu's foot: named Search Studio, with section names as kinds.
    if (menu.shell) await this.click('#app-rail-foot [data-nav="palette"]');
    else await this.run("window.MefiNav.go('palette');");
    await this.until("document.getElementById('palette-overlay')?.hidden === false", "Search opens");
    await this.until("!document.getElementById('palette-status').textContent.includes('Loading project tasks')", "Search finishes loading project tasks");
    assert.equal(await this.run("return document.querySelector('#palette-overlay [role=dialog]')?.getAttribute('aria-label') ?? null;"), "Search Studio", "the palette is called Search Studio");
    for (const [query, label, kind] of [["node tree", "Command view", "Live"], ["api key", "Settings › Connections ›", "Settings"], ["color", "Appearance & audio", "Settings"]]) {
      await this.run(`const input = document.getElementById('palette-input'); input.value = ${JSON.stringify(query)}; input.dispatchEvent(new Event('input', { bubbles: true }));`);
      const rows = await this.run("return [...document.querySelectorAll('#palette-list [role=option]')].map((row) => ({ label: row.querySelector('.label')?.textContent.trim() ?? '', kind: row.querySelector('.kind')?.textContent.trim() ?? '' }));");
      const row = rows.find((entry) => entry.label === label || entry.label.startsWith(label));
      assert(row, `Search finds ${label} for "${query}"`);
      assert.equal(row.kind.toLowerCase(), kind.toLowerCase(), `Search names ${label}'s section, ${kind}, as its kind`);
    }
    await this.capture("00i-search-sections");
    await this.click("#palette-close");
    await this.until("document.getElementById('palette-overlay').hidden", "Search closes");
    this.check("The menu has Home, Work, Live, Models and Settings over a foot of Search, Start here, Shortcuts and Community; Settings groups, finds and deep-links its sections and holds Your Studio; ← Command view, Ctrl+, and Search's section kinds work; the window keeps a 600×560 minimum");
  }
}
global.__MefiVerifiedWindow = VerifiedWindow;
require("./main.cjs");
// The menu regroup's five-size layout sweep roughly doubled the tour's length.
setTimeout(() => finish(new Error("Workspace UI verification exceeded 180 seconds")), 180000).unref();
'''


def verify(source, output, routing_only=False, menus_only=False):
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
        config = {"profile": str(profile), "appRoot": str(app_root), "output": str(output), "alpha": alpha_info, "beta": beta_info, "routingOnly": routing_only, "menusOnly": menus_only}
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
                process.wait(timeout=200)
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
    parser.add_argument("--menus-only", action="store_true", help="Check the regrouped menus, Settings and header, then sweep Workspace, Settings, Style & sound and Command view at 1440x900, 1280x720 pinned, 1024x640, 900x700 and 600x760, without the broader task workflow")
    args = parser.parse_args()
    report = verify(args.source.resolve(), args.output.resolve(), routing_only=args.routing_only, menus_only=args.menus_only)
    print(f"Workspace UI verified: {len(report['checks'])} checks, {len(report['screenshots'])} screenshots in {args.output.resolve()}")
