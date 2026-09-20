import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};

test("the picker and the headless path share one registration, so both switch to a first project and announce the change", () => {
  const register = section("async function registerProjectFolder(", 'ipcMain.handle("projects:add"');
  assert.ok(register.includes("projects.add(folder)"));
  assert.ok(register.includes("selectProject(added.id)"), "the first folder becomes the active project");
  assert.ok(register.includes('send("projects:changed", result)'));
  assert.ok(!register.includes("showOpenDialog"), "registration itself never opens a dialog");
  const picker = section('ipcMain.handle("projects:add"', 'ipcMain.handle("projects:add-path"');
  assert.ok(picker.includes("showOpenDialog") && picker.includes("registerProjectFolder(picked.filePaths[0])"));
});

test("projects:add-path refuses an unnamed folder and resolves a named one before registering it", () => {
  const handler = section('ipcMain.handle("projects:add-path"', 'ipcMain.handle("projects:remove"');
  assert.ok(handler.includes('typeof folder !== "string" || !folder.trim()'));
  assert.ok(handler.includes("registerProjectFolder(path.resolve(folder.trim()))"));
  assert.ok(!handler.includes("showOpenDialog"));
});

test("the renderer bridge exposes the headless registration beside the picker", () => {
  assert.ok(preload.includes('projectsAdd: () => ipcRenderer.invoke("projects:add")'));
  assert.ok(preload.includes('projectsAddPath: (folder) => ipcRenderer.invoke("projects:add-path", { path: folder })'));
});
