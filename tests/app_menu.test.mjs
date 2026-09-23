import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const mainSource = await readFile(new URL("../main.cjs", import.meta.url), "utf8");

function slice(start, end) {
  const from = mainSource.indexOf(start);
  const to = mainSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `main.cjs still has ${start} … ${end}`);
  return mainSource.slice(from, to);
}

function host() {
  const events = [];
  const env = {
    window: {
      isDestroyed: () => false,
      webContents: { reload: () => events.push("reload"), reloadIgnoringCache: () => events.push("reload-ignoring-cache") },
    },
    rendererValue: async (expression) => { events.push(`save:${expression}`); return null; },
    Menu: { buildFromTemplate: (template) => template },
    app: { isQuitting: false, quit: () => events.push(`quit:${env.app.isQuitting}`) },
  };
  vm.createContext(env);
  vm.runInContext(slice("async function saveResume()", "async function applyReload("), env);
  return { env, events };
}

const item = (menu, label) => menu.flatMap((entry) => entry.submenu ?? []).find((entry) => entry.label === label);
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

test("Reload and Force Reload save the resume point before the page goes away", async () => {
  const { env, events } = host();
  const menu = env.applicationMenu();
  const reload = item(menu, "Reload");
  assert.equal(reload.accelerator, "CmdOrCtrl+R");
  reload.click();
  await flush();
  assert.deepEqual(events, ["save:window.MefiNav?.saveResume?.() ?? null", "reload"]);
  events.length = 0;
  item(menu, "Force Reload").click();
  await flush();
  assert.deepEqual(events, ["save:window.MefiNav?.saveResume?.() ?? null", "reload-ignoring-cache"]);
});

test("Quit from the menu quits instead of parking in the tray, and the edit shortcuts stay", () => {
  const { env, events } = host();
  const menu = env.applicationMenu();
  item(menu, "Quit").click();
  assert.deepEqual(events, ["quit:true"]);
  assert.ok(menu.some((entry) => entry.role === "editMenu"), "copy, paste and undo keep their shortcuts");
});

test("the window installs this menu, not Electron's default", () => {
  assert.match(slice("function createWindow()", "window = new BrowserWindow"), /Menu\.setApplicationMenu\(applicationMenu\(\)\);/);
});
