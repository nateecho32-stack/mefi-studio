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
  // Setup now probes the local model roster. Answer this read at the fixture
  // boundary; no local service or external provider is contacted.
  if (["http://127.0.0.1:1234/v1/models", "https://opencode.ai/zen/go/v1/models", "https://opencode.ai/zen/v1/models"].includes(String(url))) {
    (report.localModelProbes ||= []).push(String(url));
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
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
    let image;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { image = await this.webContents.capturePage(); break; }
      catch (error) { if (!/UnknownVizError/.test(error.message) || attempt === 2) throw error; this.webContents.invalidate(); await sleep(400); }
    }
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
    // A new profile starts in Vibe and opens the setup helper. This is the
    // Build/Home tour: select that mode through the public UI API, without
    // closing or suppressing either first-run overlay or changing app defaults.
    await this.until("window.MefiWorkspace && window.MefiVibe && document.getElementById('boot-layer')?.hidden && window.MefiSetupHelper?.isOpen?.()", "first-run setup is ready");
    await this.run("window.MefiVibe.setMode('build', { go: false }); window.MefiVibe.exit(); await window.MefiWorkspace.enter();");
    await this.until("window.MefiWorkspace.isActive()", "the fixture selects Build's Home");
    await this.until("document.querySelectorAll('#workspace-projects button').length >= 2", "saved projects appear");
    await this.until("document.querySelector('#workspace-ideas span').textContent === '100' && !document.getElementById('workspace-run-backlog').disabled", "the entire seeded backlog loads");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 30, "all thirty fixture tasks survive loading");
    // The setup helper comes first on a first launch; the walkthrough follows it.
    await this.until("window.MefiSetupHelper?.isOpen?.()", "the setup helper opens first on a first launch");
    assert.equal(await this.run("return window.MefiSetupHelper.section();"), "welcome", "the setup helper starts at Welcome");
    // Closing setup deliberately leaves the tour as an invitation now. Use
    // its supported Finish action to request the tour, retaining the setup
    // and seven-step first-run assertions rather than suppressing them.
    await this.click('.setup-helper-step[data-section="finish"]');
    await this.until("window.MefiSetupHelper.section()==='finish'", "setup reaches Finish");
    await this.until("[...document.querySelectorAll('#setup-helper-content button')].some(button=>button.textContent==='Continue to the guided tour')", "Finish renders the guided-tour action");
    // Read and click in one page turn: model-readiness pushes can repaint Finish
    // between two separate IPC calls, replacing an annotated button.
    await this.run("const button=[...document.querySelectorAll('#setup-helper-content button')].find(button=>button.textContent==='Continue to the guided tour');if(!button)throw new Error('Missing guided-tour action');button.scrollIntoView({block:'nearest'});const box=button.getBoundingClientRect();const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);if(!box.width||!box.height||!button.contains(hit))throw new Error('Guided-tour action is not reachable');button.click();");
    await this.until("!window.MefiSetupHelper.isOpen()", "Continue puts the setup helper away");
    await this.until("window.MefiOnboarding && !document.getElementById('walkthrough-overlay').hidden", "the requested first-run walkthrough opens");
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
    // Progress also reports completed lessons now; retain the exact step and
    // total assertions, independently of the seeded project's done count.
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent.split(' ').slice(0,4).join(' ');"), "Step 1 of 7", "the requested first tour starts at the scan lesson");
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
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent.split(' ').slice(0,4).join(' ');"), "Step 2 of 7");
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
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent.split(' ').slice(0,4).join(' ');"), "Step 4 of 7");
    assert.match(await this.run("return document.getElementById('walkthrough-title').textContent;"), /Connect/);
    this.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
    this.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
    await this.until("document.getElementById('walkthrough-overlay').hidden", "Escape closes the guide");
    // Match Studio's hot-reload path: capture the active mode/view and drafts
    // before reloading, rather than treating a raw reload as a new launch.
    await this.run("window.MefiNav.saveResume();");
    await new Promise((resolve) => { this.webContents.once("did-finish-load", resolve); this.webContents.reload(); });
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden && window.MefiOnboarding", "workspace returns after closing the first-launch guide");
    assert.equal(await this.run("return document.getElementById('walkthrough-overlay').hidden;"), true, "an unfinished guide does not automatically reopen on the next launch");
    await this.until("!document.getElementById('workspace-auto-build').disabled && !document.getElementById('workspace-auto-build').checked", "workspace retains verify-first after renderer reload");
    assert.equal((await this.run("return await window.mefiStudio.backlogStatus();")).counts.ready, 0, "unapproved queued work is not ready in verify-first mode");
    // Agents owns queue preferences now; Home's legacy disclosures are hidden.
    // Every preference change below goes through the visible Agents navigation.
    const home = async () => { await this.run("window.MefiNav.go('workspace');"); await this.until("window.MefiWorkspace.isActive()", "Home opens"); };
    const agents = async (pane = "behavior") => {
      await this.openFromNav("agents");
      // The rail remembers the last Agents destination (often Live). Overview
      // is the visible way back to setup from that remembered destination.
      await this.until("document.querySelector('[data-agent-section=overview]')", "Agents section navigation appears");
      const compact=await this.run("const r=document.querySelector('[data-agent-section=overview]').getBoundingClientRect();return !r.width || !r.height;");
      if(compact) {
        const choose=async(selector,label)=>{
          await this.until(`document.querySelector(${JSON.stringify(selector+' + .studio-select')})`, "compact Agents picker is enhanced");
          await this.click(selector+' + .studio-select');
          await this.until(`[...document.querySelectorAll('#studio-floats [role=option]')].some(el=>el.textContent.trim()===${JSON.stringify(label)})`, "compact Agents option opens");
          const id=await this.run(`return [...document.querySelectorAll('#studio-floats [role=option]')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).id;`);
          await this.click('#'+id);
        };
        await choose('.agents-section-picker','Overview');
        await this.until("!document.getElementById('agents-overlay').hidden", "compact Agents Overview opens");
        await choose('.agents-section-picker','Setup');
        await choose('.agents-subsection-picker',{"behavior":"Run behavior","routing":"Routing & fallback","connections":"Providers"}[pane]);
      } else {
      await this.click('[data-agent-section="overview"]');
      await this.until("!document.getElementById('agents-overlay').hidden", "Agents opens from navigation");
      await this.click('[data-agent-section="setup"]');
      await this.run(`const name=${JSON.stringify({behavior:"Run behavior",routing:"Routing & fallback",connections:"Providers"}[pane])}; const button=[...document.querySelectorAll('#agents-menu-setup button')].find(el=>el.textContent.trim()===name); if(!button) throw new Error('Missing Agents navigation: '+name); button.id='harness-agents-pane';`);
      await this.click("#harness-agents-pane");
      }
      await this.until(`!document.getElementById('agents-${pane}').hidden`, `Agents ${pane} pane opens`);
    };
    const buildMode = async (value) => {
      await agents();
      await this.until("!document.getElementById('settings-build-mode').disabled", "Agents build approval loads");
      await this.run(`const select=document.getElementById('settings-build-mode');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));`);
      await this.until(`(async () => (await window.mefiStudio.assistantStatus()).status.autoBuild === ${value === "auto"})()`, "Agents build approval saves through IPC");
      assert.equal((await this.run("return (await window.mefiStudio.assistantStatus()).status;")).execute, false, "approval preference leaves worker pause in place");
      await home();
    };
    const board = async () => { await this.run("if(!window.__harnessTasksWrapped){const open=window.MefiTasks.open.bind(window.MefiTasks);window.MefiTasks.open=(...args)=>{const result=open(...args);window.__harnessTasksOpen=Promise.resolve(result);return result;};window.__harnessTasksWrapped=true;}"); await this.openFromNav("tasks"); if(await this.run("return document.documentElement.dataset.shell==='rail';")) await this.click('#app-local-nav [data-nav="tasks"]'); await this.until("!document.getElementById('tasks-overlay').hidden", "Work opens from navigation"); await this.run("await window.__harnessTasksOpen;"); };
    const selectTask = async (title) => {
      const showAllCards=await this.run(`const row=[...document.querySelectorAll('#task-list .task-name')].find(el=>el.title===${JSON.stringify(title)});const box=row?.getBoundingClientRect();const back=document.getElementById('task-overview-back')?.getBoundingClientRect();return Boolean((!box || !box.width || !box.height) && back?.width && back?.height);`);
      if(showAllCards) await this.click("#task-overview-back");
      await this.run(`const input=document.getElementById('task-search');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));`);
      await this.until(`[...document.querySelectorAll('#task-list .task-name')].some(el=>el.title===${JSON.stringify(title)})`, "Work search finds the saved task before selection");
      await this.run(`const name=[...document.querySelectorAll('#task-list .task-name')].find(el=>el.title===${JSON.stringify(title)});if(!name)throw new Error('Task row missing: '+${JSON.stringify(title)});for(const old of document.querySelectorAll('#harness-task-row'))old.removeAttribute('id');const card=name.closest('.task-overview-card.opens-task') || name.closest('li') || name;card.id='harness-task-row';card.scrollIntoView({block:'center',behavior:'instant'});`);
      await this.until("(() => {const el=document.getElementById('harness-task-row');const r=el?.getBoundingClientRect();if(!r?.width || !r.height)return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return Boolean(hit && el.contains(hit));})()", "saved task card is visible and hittable after scrolling");
      await this.click("#harness-task-row"); await this.until(`document.getElementById('task-title').textContent.includes(${JSON.stringify(title)})`, "saved task detail opens");
    };
    await buildMode("auto");
    this.check("First-use and Agents approval controls persist without changing paused workers");
    await this.openFromNav("onboarding");
    assert.equal(await this.run("return document.getElementById('walkthrough-progress').textContent.split(' ').slice(0,4).join(' ');"), "Step 4 of 7");
    await this.click("#walkthrough-next"); await this.click("#walkthrough-action");
    assert.equal(await this.run("return document.getElementById('workspace-mode-work').getAttribute('aria-pressed');"), "true");
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 30, "guide action prepares but never submits a task");
    await this.click("#workspace-task-outline");
    assert.match(await this.run("return document.getElementById('workspace-input').value;"), /Goal:[\s\S]*Done when:[\s\S]*Keep unchanged:/);
    await this.run("const input=document.getElementById('workspace-input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));");
    await this.click("#walkthrough-coach-end");
    await this.openFromNav("onboarding");
    await this.click("#walkthrough-next");
    await this.click("#walkthrough-next");
    await this.click("#walkthrough-next");
    await this.until("document.getElementById('walkthrough-overlay').hidden && window.MefiOnboarding.status()==='complete'", "guide completes through its visible Next controls");
    this.check("First-run guide resumes its saved lesson and prepares a task without submitting");
    await agents("routing");
    for (const selection of ["fixed", "jev"]) {
      await this.until("!document.getElementById('ai-model-selection').disabled && !document.getElementById('agents-routing').inert && window.MefiAgents.draft()", "routing is ready");
      await this.run(`const select=document.getElementById('ai-model-selection');select.value=${JSON.stringify(selection)};select.dispatchEvent(new Event('change',{bubbles:true}));`);
      await this.until(`window.MefiAgents.draft()?.modelSelection===${JSON.stringify(selection)}`, "routing selection stays in the Agents draft");
      await this.click("#agents-save-bar .primary");
      await this.until(`(async () => (await window.mefiStudio.getAiRouting()).modelSelection===${JSON.stringify(selection)})()`, "routing selection persists");
    }
    await this.capture("01-agents-routing");
    this.check("Agents routing saves fixed and Jev selection through IPC without starting workers");
    if (config.routingOnly) return;
    await home(); await board();
    await this.run("const input=document.getElementById('task-search');input.value='season archive';input.dispatchEvent(new Event('input',{bubbles:true}));");
    await this.until("document.getElementById('task-list').textContent.includes('season archive') && !document.getElementById('task-list').textContent.includes('seed importer')", "Work searches all saved tasks");
    assert(!await this.run("return document.getElementById('task-list').textContent.includes('seed importer');"), "search excludes unrelated tasks");
    await this.run("const input=document.getElementById('task-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));");
    await this.click("#task-filter-done");
    await this.until("document.getElementById('task-list').textContent.includes('Finish the garden planner') && !document.getElementById('task-list').textContent.includes('Review the seed importer')", "Done lists completed work");
    assert(!await this.run("return document.getElementById('task-list').textContent.includes('Review the seed importer');"), "unverified work never masquerades as done");
    await selectTask("Finish the garden planner"); await this.capture("02-completed-detail");
    await this.click("#task-filter-all");
    await selectTask("Review the seed importer");
    assert(await this.run("return document.getElementById('task-detail').textContent.includes('Verifying') || document.querySelector('[data-task-readiness=review]')!==null;"), "review state is truthful in Work");
    this.check("Work search, Done and unverified detail retain their distinct saved states");
    await this.click("#tasks-close"); await home();
    await this.openFromNav("vibe");
    await this.until("document.querySelector('#vibe-card-ideas:not([hidden])')", "Vibe exposes the saved ideas card");
    await this.click("#vibe-card-ideas .vibe-lane-link");
    await this.until("document.querySelectorAll('#vibe-panel li[data-key^=\"idea:\"]').length===40", "current Ideas panel retains its forty-row bound");
    assert((await this.run("return (await window.mefiStudio.ideasList()).ideas;")).length===100, "all hundred ideas remain saved");
    this.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
    this.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
    await this.until("!window.MefiVibePanels.isOpen()", "Escape closes the current Ideas panel");
    await this.run("window.MefiVibe.setMode('build',{go:false});window.MefiVibe.exit();await window.MefiWorkspace.enter();window.MefiNav.go('ideas',{ideaId:'fixture_idea_099'});");
    await this.until("document.getElementById('ideas-detail').textContent.includes('quiet reminder')", "older idea opens through supported idea navigation");
    await this.capture("03-old-idea");
    await this.run("const b=[...document.querySelectorAll('#ideas-detail button')].find(b=>b.textContent.trim()==='Make task'); if(!b)throw Error('Make task action absent');b.id='harness-promote-idea';");
    await this.click("#harness-promote-idea");
    await this.until("(async () => Boolean((await window.mefiStudio.ideasList()).ideas.find(i=>i.id==='fixture_idea_099')?.taskId))()", "Make task persists an explicit idea-to-task link");
    const promoted=await this.run("return (await window.mefiStudio.ideasList()).ideas.find(i=>i.id==='fixture_idea_099');");
    assert((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).some(t=>t.id===promoted.taskId && t.projectId===config.alpha.id));
    await home();
    this.check("All hundred ideas remain saved; bounded Ideas and older linked details create a durable task in the selected project");
    await this.click("#workspace-add-project");
    await this.until("!document.getElementById('workspace-add-project').disabled", "cancelled picker settles");
    const cancelled=await this.run("return await window.mefiStudio.projectsList();");
    assert.equal(folderPickerCalls,1);assert.equal(cancelled.projects.length,2);assert.equal(cancelled.activeId,config.alpha.id);
    this.check("Cancelled native folder picker preserves projects and active context");
    await buildMode("verify");
    const title="Garden journal export in Markdown";
    await this.click("#workspace-mode-work");
    await this.run(`const input=document.getElementById('workspace-input');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));`);
    await this.click("#workspace-send");
    await this.until(`(async () => (await window.mefiStudio.tasksList()).tasks.some(t=>t.title===${JSON.stringify(title)}))()`, "explicit task saves");
    await this.until("!document.getElementById('workspace-send').disabled", "composer becomes usable again");
    const created=await this.run(`return (await window.mefiStudio.tasksList()).tasks.find(t=>t.title===${JSON.stringify(title)});`);
    assert.equal(created.projectId,config.alpha.id);assert(fs.readFileSync(path.join(config.appRoot,"data","eyes-tasks.json"),"utf8").includes(title));
    await board(); await selectTask(title);
    await this.until("document.querySelector('[data-task-readiness=approval]') && document.querySelector('#task-status-row [data-task-action=approve]')", "Work explains saved approval hold");
    const beforeApproval=await this.run(`return (await window.mefiStudio.tasksList()).tasks.find(t=>t.id===${JSON.stringify(created.id)});`);
    assert(beforeApproval.buildScope);
    await this.click('#task-status-row [data-task-action="approve"]');
    await this.until(`(async () => (await window.mefiStudio.backlogStatus()).taskStates.find(t=>t.id===${JSON.stringify(created.id)})?.stage==='ready')()`, "reviewed scope becomes ready");
    assert(JSON.parse(fs.readFileSync(path.join(config.appRoot,"data","eyes-tasks.json"),"utf8")).find(t=>t.id===created.id).buildApproval);
    const revised="Export the garden journal as Markdown and show a preview before saving.";
    await this.run(`const tasks=(await window.mefiStudio.tasksList()).tasks;tasks.find(t=>t.id===${JSON.stringify(created.id)}).prompt=${JSON.stringify(revised)};const result=await window.mefiStudio.tasksSave(tasks);if(!result.ok)throw new Error(result.error);`);
    await this.until("document.querySelector('[data-task-readiness=approval]')", "changed brief needs fresh approval");
    const stale=await this.run(`return await window.mefiStudio.backlogControl({action:'approve',taskId:${JSON.stringify(created.id)},projectId:${JSON.stringify(config.alpha.id)},expectedScope:${JSON.stringify(beforeApproval.buildScope)}});`);
    assert.equal(stale.ok,false,"old approval scope cannot authorize changed work");
    await this.until("document.querySelector('#task-status-row [data-task-action=approve]')?.disabled===false", "fresh approval is available");
    await this.click('#task-status-row [data-task-action="approve"]');
    await this.until(`(async () => (await window.mefiStudio.backlogStatus()).taskStates.find(t=>t.id===${JSON.stringify(created.id)})?.stage==='ready')()`, "fresh scope becomes ready");
    assert.equal((await this.run("return (await window.mefiStudio.assistantStatus()).status;")).execute,false);
    await this.capture("04-approval-workflow");await this.click("#tasks-close");await buildMode("auto");
    this.check("Durable tasks hold for approval, persist owner approval, reject stale scope and require approval after editing the brief; workers stay paused");
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
    await this.until("(async () => (await window.mefiStudio.assistantState()).state.questions.some(question => question.status === 'open' && question.title.startsWith('Start ')))()", "an offered next step becomes an open decision");
    // Find the decision toast by what it says. A fresh profile also raises the
    // one-time key tip ("Show keys", 12 s) — another actionable toast that can
    // be showing, or fading, beside it — so "the first actionable toast" can be
    // the tip, and its button opens Shortcuts instead of answering.
    const decisionTitle=await this.run("return (await window.mefiStudio.assistantState()).state.questions.find(question=>question.status==='open' && question.title.startsWith('Start ')).title;");
    const decisionToast = `[...document.querySelectorAll('#toast-host .toast.has-action.show')].find(toast => toast.textContent.includes('Decision needed: ') && toast.textContent.includes(${JSON.stringify(decisionTitle)}))`;
    await this.until(`Boolean(${decisionToast})`, "a new decision is announced with an actionable toast");
    assert.equal(await this.run("return [...document.querySelectorAll('#toast-host .toast.show')].filter(toast => toast.textContent.includes('Decision needed')).length;"), 1, "one decision raises one toast");
    await this.run(`${decisionToast}.dataset.harness = 'decision';`);
    await this.click("#toast-host .toast[data-harness='decision'] .toast-action");
    await this.until("window.MefiIdle?.isActive?.() && !window.MefiWorkspace.isActive() && !document.getElementById('cmd-asks').hidden", "the toast's Answer control opens Command on the Ask rail");
    await this.until(`document.querySelector('#cmd-ask-list .ask-card[data-status=open] .ask-title')?.textContent === ${JSON.stringify(decisionTitle)}`, "the Ask rail shows the waiting decision");
    assert.equal(await this.run("return document.querySelector('#cmd-rail .rail-tab[data-rail-view=ask]').getAttribute('aria-selected');"), "true");
    await this.until("!document.querySelector('#toast-host .toast.show')", "the answered toast leaves the screen");
    await this.click('#cmd-rail .rail-tab[data-rail-view="work"]');
    assert.equal(await this.run("return document.getElementById('cmd-asks').hidden;"), true, "the rail returns to live work for the rest of the tour");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace.isActive() && !window.MefiIdle.isActive()", "workspace returns from the Ask rail");
    this.check("A reply that offers next work raises one decision toast whose Answer control opens the Ask rail in Command");

    await this.run("window.MefiNav.go('tasks', {taskId:'fixture_open'});");
    await this.until("document.getElementById('task-title').textContent.includes('Plan a planting calendar') && document.querySelector('[data-task-panel=dependencies]')", "task planning details appear");
    await this.click('[data-task-panel="dependencies"] > summary');
    assert.equal(await this.run("return Boolean(document.querySelector('[data-dependency-id=fixture_open]'));"), false, "a task cannot depend on itself");
    await this.click('[data-dependency-id="fixture_backlog_08"]');
    await this.click('[data-task-action="dependencies"]');
    await this.until("(async () => (await window.mefiStudio.tasksList()).tasks.find(task => task.id === 'fixture_open').dependsOn?.includes('fixture_backlog_08'))()", "saved prerequisite survives a real store read");
    await this.until("document.querySelector('[data-task-readiness=waiting]')", "task shows the actual dependency hold");
    await this.until("document.querySelector('#task-list li.selected [data-readiness=waiting]')", "board row agrees with the prerequisite hold in task details");
    await this.click("#task-tab-history");
    await this.click('[data-task-panel="handoff"] > summary');
    await this.until("document.querySelector('.task-handoff-text')?.textContent.includes('Plan a planting calendar')", "handoff carries saved task context");
    await this.click("#task-tab-details");
    await this.capture("13-task-prerequisites");
    const baseline = await this.run("return (await window.mefiStudio.tasksHistory({taskId:'fixture_open'})).entries.find(entry => !entry.snapshot.dependsOn?.length);");
    assert(baseline?.id, "legacy task obtains a recoverable baseline before its first context change");
    const revisedBrief = "Add seasonal dates, export reminders, and preserve the planting notes.";
    await this.run(`const tasks = (await window.mefiStudio.tasksList()).tasks; const task = tasks.find(task => task.id === 'fixture_open'); task.prompt = ${JSON.stringify(revisedBrief)}; task.updatedAt = Date.now(); const result = await window.mefiStudio.tasksSave(tasks); if (!result.ok) throw new Error(result.error || 'Fixture brief edit failed');`);
    await this.until(`document.getElementById('task-detail').textContent.includes(${JSON.stringify(revisedBrief)})`, "updated brief appears in the selected detail");
    await this.click("#task-tab-history");
    await this.click('[data-task-panel="history"] > summary');
    await this.until(`document.querySelector('[data-revision-id="${baseline.id}"] [data-task-action=restore]')`, "older brief is available to restore");
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

    await this.run("const input = document.getElementById('workspace-input'); input.value = 'A draft just for Garden Notes'; input.dispatchEvent(new Event('input', {bubbles:true}));");
    await this.click(`#workspace-projects [data-project-id="${config.beta.id}"]`);
    await this.until(`(async () => (await window.mefiStudio.projectsList()).activeId === ${JSON.stringify(config.beta.id)})()`, "switch to second project");
    await home();
    await this.run("window.MefiVibe.setMode('build',{go:false});window.MefiVibe.exit();await window.MefiWorkspace.enter();");
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
    await home();
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

    await agents();
    await this.until("!document.getElementById('settings-queue-enabled').disabled", "Agents queue control is ready");
    const wasEnabled=await this.run("return document.getElementById('settings-queue-enabled').checked;");
    await this.click("#settings-queue-enabled");
    await this.until(`(async () => (await window.mefiStudio.assistantStatus()).status.enabled===${!wasEnabled})()`, "Agents queue switch changes scheduling state");
    await this.click("#settings-queue-enabled");
    await this.until(`(async () => (await window.mefiStudio.assistantStatus()).status.enabled===${wasEnabled})()`, "Agents restores the queue state");
    await this.until("!document.getElementById('settings-new-work').disabled", "Allow new work is ready");
    if(!await this.run("return document.getElementById('settings-new-work').checked;")) await this.click("#settings-new-work");
    await this.until("(async () => (await window.mefiStudio.assistantStatus()).status.loop.on===true && document.getElementById('settings-new-work').checked)()", "Agents explicitly opens admission through start-work");
    await this.click("#settings-new-work");
    await this.until("(async () => (await window.mefiStudio.assistantStatus()).status.loop.on===false && (await window.mefiStudio.assistantState()).state.status==='paused' && (await window.mefiStudio.backlogStatus()).paused===true && !document.getElementById('settings-new-work').checked)()", "Agents closes admission in the loop, assistant, backlog and visible switch");
    assert.equal((await this.run("return await window.mefiStudio.backlogStatus();")).counts.running,0);
    await home(); this.check("Agents queue and admission switches update the scheduler without workers");
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
    await this.run("window.MefiNav.saveResume();");
    await new Promise((resolve) => { this.webContents.once("did-finish-load", resolve); this.webContents.reload(); });
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden && document.querySelectorAll('#workspace-projects button').length >= 2", "workspace returns after reload");
    assert.equal(await this.run("return document.getElementById('walkthrough-overlay').hidden;"), true, "a completed guide does not automatically reopen after reload");
    assert.equal(await this.run("return document.getElementById('walkthrough-invitation').hidden;"), true, "a completed reminder stays hidden after reload");
    assert.equal(await this.run("return (await window.mefiStudio.projectsList()).activeId;"), config.alpha.id);
    assert((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).some(task => task.id === created.id), "task survives renderer reload");
    assert((await this.run("return document.getElementById('workspace-companion-name').textContent;")).includes("Pip"), "personal companion name survives reload");
    assert.equal(await this.run("return document.getElementById('workspace-agent-name').value;"), "Pip", "Your Studio shows the saved companion name after reload");
    assert.equal(await this.run("return document.getElementById('workspace-input').value;"), "A draft just for Garden Notes", "project draft survives reload");
    this.check("Personalization set in Settings › Your Studio, drafts and durable project work survive reload");


    report.currentLayouts=[];
    for(const [width,height] of [[1280,720],[600,760]]) {
      this.setContentSize(width,height);await sleep(250);await home();
      const layout=await this.run("const box=document.getElementById('workspace-input').getBoundingClientRect();return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,input:box.toJSON()};");
      assert(layout.scroll<=layout.width+2 && layout.input.height>40 && layout.input.bottom<layout.height,"Home composer fits without horizontal overflow");
      await this.capture(`layout-home-${width}`);await board();await selectTask(title);
      assert(await this.run("return document.documentElement.scrollWidth<=innerWidth+2;"),"Work fits the window");
      await this.capture(`layout-work-${width}`);await this.click("#tasks-close");await agents();
      assert(await this.run("const box=document.getElementById('settings-build-mode').getBoundingClientRect();return box.width>0&&box.height>0&&document.documentElement.scrollWidth<=innerWidth+2;"),"Agents approval fits and remains reachable");
      await this.capture(`layout-agents-${width}`);report.currentLayouts.push(layout);
    }
    assert.deepEqual(report.networkAttempts,[],"full workflow contacts no external service");
    assert.deepEqual(report.workerAttempts,[],"smoke guard blocks coding workers");
    assert.deepEqual(report.consoleErrors,[],"full workflow has no renderer errors");
    report.createdTaskId=created.id;
    this.check("Home, Work and Agents fit narrow and short desktop windows; complete workflow has no external calls, workers or renderer errors");
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
