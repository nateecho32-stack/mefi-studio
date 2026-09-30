// main.cjs's "Report a problem" block, sliced out and run against stubs with the
// real modules (scripts/crash-report.cjs, report-host.cjs, zip-lite.cjs) over a
// real temp folder, so the wiring suite and the renderer suite talk to the same
// thing: what runs in main is what answers the page. One launch of the app is a
// fresh vm context that runs the block once, with its own pid.

import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
export const crashReport = require("../../scripts/crash-report.cjs");
export const reportHostModule = require("../../scripts/report-host.cjs");
export const zipLite = require("../../scripts/zip-lite.cjs");
export const main = readFileSync(new URL("../../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const preload = readFileSync(new URL("../../preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const slice = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `main.cjs has ${from}`);
  return main.slice(start, end);
};
export const block = slice("// ---- Report a problem: the report, the session marker and the crash prompt", "// ---- end of report a problem");
export const handlers = slice('  // ---- Report a problem (the "Report a problem" block)', "\n  // ---- Community");

export const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
export const KEY = "sk-ant-api03-PLANTED0123456789abcdefghij";

// One launch of the app over `root`: the block runs once in a fresh context.
export function launch(t, root, { pid = 100, mode = {}, env = {}, settings = null, packaged = true, dialogPick = null, onSend = null } = {}) {
  const events = { process: new Map(), app: new Map() };
  const sent = [];
  const logs = [];
  const shown = [];
  const channels = new Map();
  const state = { settings: settings ?? { aiProvider: "claude", executorCli: "claude", executorTier: "auto", aiModels: { heavy: "opus-5-5", routine: { nested: "ignored" } }, apiKeyEncrypted: KEY, projects: [{ path: "C:\\Users\\Nate\\Secret Game" }] } };
  const window = { isDestroyed: () => false };
  const context = vm.createContext({
    path, os: { userInfo: () => ({ username: "Nate" }), hostname: () => "NATE-PC", release: () => "10.0.26200", homedir: () => "D:\\Profiles\\Nate" }, crypto: require("node:crypto"),
    crashReport: mode.missing ? null : crashReport, reportHostModule: mode.missing ? null : reportHostModule, zipLite: mode.missing ? null : zipLite,
    SMOKE: Boolean(mode.smoke), CAPTURE: false, CLI_MODE: Boolean(mode.cli), STUDIO_ROOT: root, UPDATE_RESULT_PATH: path.join(root, "data", "update-result.json"),
    require, window,
    process: { pid, env, platform: "win32", arch: "x64", versions: { electron: "44.4.1", chrome: "150", node: "24.21.0" }, on: (name, fn) => events.process.set(name, fn) },
    app: { getVersion: () => "0.5.0", isPackaged: packaged, getPath: () => path.join(root, "Documents"), on: (name, fn) => events.app.set(name, fn) },
    dialog: { showSaveDialog: async (...args) => { const options = args.at(-1); const answer = dialogPick ?? { canceled: false, filePath: path.join(root, "Documents", "report.zip") }; if (!answer.canceled) fs.mkdirSync(path.dirname(answer.filePath), { recursive: true }); channels.dialogOptions = options; return answer; } },
    shell: { showItemInFolder: (file) => shown.push(file) },
    send: (channel, payload) => { sent.push([channel, payload]); onSend?.(channel, payload); }, logLine: (line) => logs.push(line),
    readSettings: async () => structuredClone(state.settings),
    updateSettings: async (mutate) => { const next = structuredClone(state.settings); if ((await mutate(next)) === false) return; state.settings = next; },
    projects: { current: () => ({ name: "Secret Game" }) }, projectRoot: () => "C:\\Users\\Nate\\Secret Game", projectDataPath: (file) => file, EXECUTOR_LOG_PATH: "executor-log.jsonl", TASKS_PATH: "tasks.json",
    getEyes: async () => ({ readJson: async () => [{ id: "t1", title: "Fix the Secret Game login", status: "done", updatedAt: NOW, lastAttempt: { route: "Claude Code · Sonnet 5.5" }, verification: { state: "verified", checks: { total: 3, passed: 3, failed: 0 } }, secretField: KEY }, { id: "t2", title: "Archived one", archived: true, status: "done" }] }),
    brainLedgerTail: async () => [{ event: "start", runId: "run_0" }, { event: "finish", at: NOW, runId: "run_1", task: "t1", title: "Fix the Secret Game login", ok: true, code: 0, seconds: 12, tail: ["all green", `TOKEN=${KEY}`] }],
    traceStudio: { rows: () => [{ at: NOW - 2000, level: "info", source: "files", text: "opened D:\\Profiles\\Nate\\Documents\\notes.txt for Nate on NATE-PC" }, { at: NOW - 1000, level: "info", source: "agents", text: "loop started for Secret Game" }] },
    traceRenderer: { rows: () => [{ at: NOW - 500, level: "error", source: "boot.js:12", text: "TypeError in the window" }] },
    ipcMain: { handle: (channel, fn) => channels.set(channel, fn) },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } },
  });
  vm.runInContext(`${block}\n${handlers}`, context);
  const call = async (channel, payload) => JSON.parse(JSON.stringify(await channels.get(channel)({}, payload)));
  const data = path.join(root, "data");
  const marker = () => { try { return crashReport.parseMarker(fs.readFileSync(path.join(data, "session-marker.json"), "utf8")); } catch { return null; } };
  const rows = () => { try { return crashReport.parseRows(fs.readFileSync(path.join(data, "crash.jsonl"), "utf8")); } catch { return []; } };
  const start = () => vm.runInContext("reportStart()", context);
  return { context, events, sent, logs, shown, channels, state, call, marker, rows, start, pageUp: () => vm.runInContext("reportHost?.pageUp()", context), root };
}
export const folder = (t) => { const root = fs.mkdtempSync(path.join(tmpdir(), "mefi-reportwire-")); t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 })); return root; };

