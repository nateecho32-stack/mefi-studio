// The main window's guards (main.cjs): the minimum size every layout is built
// for, and a window that never leaves its own page. guardWindowNavigation runs
// here for real, sliced out of main.cjs, against stand-ins for webContents and
// shell, with the booklet's real path (spaces, an apostrophe and a plus sign
// included); createWindow is checked for wiring it and for the minimum.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(STUDIO, "renderer", "booklet.html");
const main = (await readFile(path.join(STUDIO, "main.cjs"), "utf8")).replace(/\r\n/g, "\n");

function slice(from, to) {
  const start = main.indexOf(from);
  assert.ok(start >= 0, `main.cjs still has ${from.trim()}`);
  const end = main.indexOf(to, start + from.length);
  assert.ok(end > start, `main.cjs still has ${to.trim()} after ${from.trim()}`);
  return main.slice(start, end);
}

function guard({ openExternal = async () => {} } = {}) {
  const opened = [];
  const handlers = {};
  const contents = {
    setWindowOpenHandler(fn) { handlers.open = fn; },
    on(type, fn) { handlers[type] = fn; },
  };
  const context = vm.createContext({
    require: createRequire(import.meta.url), path, URL, process: { platform: process.platform },
    shell: { openExternal: (url) => { opened.push(url); return openExternal(url); } },
  });
  vm.runInContext(slice("function guardWindowNavigation(", "\nfunction createWindow() {"), context);
  context.guardWindowNavigation(contents, PAGE);
  const refused = (url, { legacy = false } = {}) => {
    let prevented = false;
    const event = { preventDefault() { prevented = true; } };
    if (legacy) handlers["will-navigate"](event, url);
    else handlers["will-navigate"]({ ...event, url });
    return prevented;
  };
  return { opened, handlers, open: (url) => handlers.open({ url }), refused };
}

test("links that ask for a new window open in the browser, http and https only, and never as an app window", async () => {
  const window = guard();
  for (const url of ["https://discord.gg/example", "http://127.0.0.1:4173/", "HTTPS://OPENCODE.AI/GO"]) {
    assert.deepEqual({ ...window.open(url) }, { action: "deny" }, `${url} gets no child window`);
  }
  for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "data:text/html,hi", "mefi://settings"]) {
    assert.deepEqual({ ...window.open(url) }, { action: "deny" });
  }
  assert.deepEqual(window.opened, ["https://discord.gg/example", "http://127.0.0.1:4173/", "HTTPS://OPENCODE.AI/GO"], "only the web links reach the default browser");
  // A browser that refuses to start is not an unhandled rejection in main.
  const refusing = guard({ openExternal: () => Promise.reject(new Error("no browser")) });
  refusing.open("https://example.com/");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(refusing.opened, ["https://example.com/"]);
});

test("the window navigates only to its own page: reloads with any query stay, everything else is refused", () => {
  const window = guard();
  const page = pathToFileURL(PAGE).href;
  assert.equal(window.refused(`${page}?capture=0&smoke=0`), false, "the booklet as loadFile opens it");
  assert.equal(window.refused(`${page}?shell=classic#settings-updates`), false, "the booklet with another query and a hash");
  assert.equal(window.refused(page.replace(/'/g, "%27")), false, "however the path is escaped");
  if (process.platform === "win32") assert.equal(window.refused(page.toUpperCase().replace("FILE:", "file:")), false, "Windows paths compare without case");
  for (const url of [
    "https://example.com/",
    "http://localhost:4173/renderer/booklet.html",
    pathToFileURL(path.join(STUDIO, "renderer", "booklet.template.html")).href,
    `${page}.html`,
    pathToFileURL(path.join(STUDIO, "data", "models.json")).href,
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(window.refused(url), true, `${url} is refused`);
  }
  assert.equal(window.refused("https://example.com/", { legacy: true }), true, "a build that passes the url second is guarded too");
  assert.equal(window.refused(`${page}?capture=0`, { legacy: true }), false);
});

test("createWindow keeps a 600x560 minimum and guards the page it loads", () => {
  const min = /const MIN_WINDOW = Object\.freeze\(\{ width: (\d+), height: (\d+) \}\);/.exec(main);
  assert.ok(min, "main.cjs declares MIN_WINDOW");
  assert.deepEqual([Number(min[1]), Number(min[2])], [600, 560]);
  const body = slice("function createWindow() {", "\n}\n");
  for (const option of [
    "minWidth: MIN_WINDOW.width,",
    "minHeight: MIN_WINDOW.height,",
    "width: Math.max(MIN_WINDOW.width, saved?.width ?? 1460),",
    "height: Math.max(MIN_WINDOW.height, saved?.height ?? 940),",
  ]) {
    assert.ok(body.includes(option), `createWindow's options include ${option}`);
  }
  assert.ok(body.includes('const page = path.join(STUDIO_ROOT, "renderer", "booklet.html");'));
  assert.ok(body.includes("guardWindowNavigation(window.webContents, page);"), "the window is guarded");
  assert.ok(body.includes("view.loadFile(page, {"), "the guard allows exactly the page the window loads");
  assert.ok(body.indexOf("guardWindowNavigation(") < body.indexOf("loadView().catch("), "guarded before the first load");
});
