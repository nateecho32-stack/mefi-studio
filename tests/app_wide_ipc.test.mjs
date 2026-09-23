import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const mainSource = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = mainSource.indexOf("function handleProjectIpc(");
const end = mainSource.indexOf("ipcMain.handle = handleProjectIpc;", start);
assert.ok(start >= 0 && end > start, "main.cjs still has the project IPC wrapper");

function host() {
  const handlers = new Map();
  const env = {
    projectSwitching: true,
    projectOperations: 0,
    projects: { active: () => "project-a", run: (_project, fn) => fn() },
    originalIpcHandle: (channel, handler) => handlers.set(channel, handler),
    Promise,
  };
  vm.createContext(env);
  vm.runInContext(`${mainSource.slice(start, end)}\nglobalThis.handle = handleProjectIpc;`, env);
  return { env, call: (channel) => { env.handle(channel, () => ({ ok: true, channel })); return JSON.parse(JSON.stringify(handlers.get(channel)({}))); } };
}

test("owner and app readings answer during a project switch; project work and restarts wait", () => {
  const h = host();
  for (const channel of ["release:status", "release:check", "update:status", "update:set", "settings:get-key", "catalog:read", "speed:probe", "shell:open", "styler:status", "community:status", "usage:accounts"]) {
    assert.deepEqual(h.call(channel), { ok: true, channel }, channel);
  }
  for (const channel of ["update:apply", "release:apply", "app:restart", "tasks:save", "eyes:state", "settings:set-key"]) {
    assert.deepEqual(h.call(channel), { ok: false, error: "Switching projects. Try again in a moment." }, channel);
  }
});
