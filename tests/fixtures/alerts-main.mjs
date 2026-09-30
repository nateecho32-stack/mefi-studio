// main.cjs's "Notifications" block and its three alerts:* handlers, sliced out
// and run against stubs with the real modules (scripts/alerts.cjs,
// alerts-host.cjs, badge-icon.cjs): a Notification class that records what was
// shown and can be clicked, windows that can be focused, minimized, hidden or
// destroyed, and the settings, the needs-you digest and the assistant's
// questions as plain objects. One launch is a fresh vm context that runs the
// block once.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
export const alertsRules = require("../../scripts/alerts.cjs");
export const alertsHostModule = require("../../scripts/alerts-host.cjs");
export const badgeIcon = require("../../scripts/badge-icon.cjs");
export const main = readFileSync(new URL("../../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const preload = readFileSync(new URL("../../preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const slice = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `main.cjs has ${from}`);
  return main.slice(start, end);
};
export const block = slice("// ---- Notifications: Windows alerts, the taskbar flash and the count", "// ---- end of notifications");
export const handlers = slice('  // ---- Notifications (the "Notifications" block)', "\n  // ---- Community");
export const appId = slice("const ALERTS_APP_ID", "\nlet window = null;").trim();

/** A window the stub can put in any state. */
export function fakeWindow(log, more = {}) {
  const state = { focused: false, visible: true, minimized: false, destroyed: false, loading: false, ...more };
  const loads = [];
  return Object.assign(state, {
    isDestroyed: () => state.destroyed, isVisible: () => state.visible, isMinimized: () => state.minimized, isFocused: () => state.focused,
    flashFrame: (on) => log.flashes.push(on),
    setOverlayIcon: (image, description) => log.overlays.push([image ? { width: image.buf.readUInt32BE(16) } : null, description]),
    webContents: { isLoading: () => state.loading, isDestroyed: () => false, once: (name, fn) => loads.push([name, fn]) },
    loads,
  });
}

export function launch({ mode = {}, env = {}, settings = {}, platform = "win32", digest = { total: 0, items: [] }, scale = 1, questions = [], projectOpen = true, missing = false } = {}) {
  const log = { flashes: [], overlays: [], sent: [], logs: [], shown: [], calls: [], timeouts: [], pushes: 0, handlers: new Map() };
  const state = { settings, digest, scale, questions, projectOpen, windows: [], idle: "active" };
  class FakeNotification extends EventEmitter {
    constructor(options) { super(); this.options = options; }
    show() { log.shown.push(this); }
    close() { this.emit("close", {}); }
    static isSupported() { return true; }
  }
  const window = fakeWindow(log);
  state.windows = [window];
  const context = vm.createContext({
    path, process: { platform, env }, Notification: FakeNotification,
    nativeImage: { createFromBuffer: (buf) => ({ buf, isEmpty: () => false }), createFromPath: () => ({ isEmpty: () => false }) },
    existsSync: () => true, STUDIO_ROOT: "/app",
    SMOKE: Boolean(mode.smoke), CAPTURE: false, CLI_MODE: Boolean(mode.cli),
    alertsRules: missing ? null : alertsRules, alertsHostModule: missing ? null : alertsHostModule, badgeIcon: missing ? null : badgeIcon,
    window, BrowserWindow: { getAllWindows: () => state.windows },
    powerMonitor: { getSystemIdleState: (seconds) => { if (state.idle === "throws") throw new Error("no power monitor"); state.idleAsked = seconds; return state.idle; } },
    showWindow: () => log.calls.push("showWindow"),
    send: (channel, payload) => { log.sent.push([channel, payload]); log.calls.push(`send:${channel}`); },
    readSettings: async () => structuredClone(state.settings),
    updateSettings: async (mutate) => { const next = structuredClone(state.settings); if ((await mutate(next)) === false) return; state.settings = next; },
    logLine: (line) => log.logs.push(line),
    projects: { open: () => state.projectOpen, current: () => ({ id: "project_a" }) },
    assistantNeedsYouDigest: async () => state.digest, assistantState: { get questions() { return state.questions; } },
    screen: { getPrimaryDisplay: () => ({ scaleFactor: state.scale }) },
    remotePush: () => { log.pushes += 1; },
    setTimeout: (fn, ms) => { const handle = { fn, ms, unref() {} }; log.timeouts.push(handle); return handle; },
    ipcMain: { handle: (channel, fn) => log.handlers.set(channel, fn) },
  });
  vm.runInContext(`${block}\n${handlers}`, context);
  const call = async (channel, payload) => JSON.parse(JSON.stringify(await log.handlers.get(channel)({}, payload)));
  const run = (code) => vm.runInContext(code, context);
  return { context, log, state, window, call, run, start: () => run("alertsStart()"), host: () => run("alertsHost"), FakeNotification };
}
