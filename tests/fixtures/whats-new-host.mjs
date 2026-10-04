// main.cjs's "What's new" block, sliced out and run against stubs (the real
// rules in scripts/whats-new.cjs, a real notes file, settings held in memory),
// so the host suite and the renderer suite talk to the same thing: what runs in
// main is what answers the page.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
export const whatsNew = require("../../scripts/whats-new.cjs");
export const main = readFileSync(new URL("../../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const slice = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `main.cjs has ${from}`);
  return main.slice(start, end);
};
export const block = slice("// ---- What's new: the notes for the version that is running", "// ---- end of what's new");
export const handlers = slice('  // ---- What\'s new (the "What\'s new" block)', "\n  // ---- Community");

export const NOTES = { "0.4.4": ["Setup is one sign-in."], "0.5.0": ["One calm shell.", "Windows tells you when something needs you."] };

/**
 * One launch of the app: a fresh context runs the block once, so the
 * fresh-install fact (no settings.json at launch) is read once per launch.
 * `t` is the test context (its cleanup removes the temp folder).
 */
export function launch(t, { version = "0.5.0", settings = {}, existed = true, env = {}, mode = {}, notes = NOTES, file = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-whatsnew-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "assets"));
  if (file) writeFileSync(path.join(dir, "assets", "whats-new.json"), JSON.stringify(notes));
  const state = { settings: structuredClone(settings), writes: 0 };
  const channels = new Map();
  const context = vm.createContext({
    path, process: { env }, STUDIO_ROOT: dir, whatsNew,
    settingsDisk: { good: existed ? "{}" : null, unreadable: false },
    SMOKE: Boolean(mode.smoke), CAPTURE: false, CLI_MODE: false,
    app: { getVersion: () => version },
    readFile: (name, encoding) => readFile(name, encoding),
    readSettings: async () => structuredClone(state.settings),
    updateSettings: async (mutate) => {
      const next = structuredClone(state.settings);
      if ((await mutate(next)) === false) return state.settings;
      state.settings = next;
      state.writes += 1;
      return state.settings;
    },
    ipcMain: { handle: (channel, fn) => channels.set(channel, fn) },
  });
  vm.runInContext(`${block}\n${handlers}`, context);
  const call = async (channel, payload) => JSON.parse(JSON.stringify(await channels.get(channel)({}, payload)));
  return { state, channels, call, dir, context };
}
