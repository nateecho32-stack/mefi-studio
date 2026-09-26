// Vibe's New app: where the folder goes and what it is called, checked before
// anything is written (scripts/new-app.cjs; main.cjs projects:create writes it).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const newApp = require("../scripts/new-app.cjs");
const home = path.resolve("/home/mefi");
const studio = path.resolve("/code/studio");

test("a name becomes a folder under Mefi Apps in the home folder", () => {
  const planned = newApp.plan({ name: "  Pixel  Garden! ", about: "A cosy game", home, studioRoot: studio });
  assert.equal(planned.ok, true);
  assert.equal(planned.name, "Pixel Garden!");
  assert.equal(planned.slug, "pixel-garden");
  assert.equal(planned.folder, path.join(home, "Mefi Apps", "pixel-garden"));
  assert.equal(newApp.slugOf("Café Déjà Vu"), "cafe-deja-vu");
  assert.equal(newApp.plan({ name: "Notes", parent: path.resolve("/work"), home, studioRoot: studio }).folder, path.join(path.resolve("/work"), "notes"));
});

test("an unusable name, or a folder inside Studio's own repository, is refused", () => {
  assert.equal(newApp.plan({ name: "   ", home }).ok, false);
  assert.equal(newApp.plan({ name: "!!!", home }).ok, false);
  assert.equal(newApp.plan({ name: "con", home }).ok, false, "a reserved Windows name");
  const inside = newApp.plan({ name: "game", parent: path.join(studio, "games"), home, studioRoot: studio });
  assert.equal(inside.ok, false);
  assert.match(inside.error, /outside Studio's own/);
});

test("the starter README says what the app is", () => {
  const text = newApp.readme({ name: "Pixel Garden", about: "Grow pixel plants." });
  assert.match(text, /^# Pixel Garden\n\nGrow pixel plants\.\n/);
});

const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const handlerSource = main.slice(main.indexOf('  ipcMain.handle("projects:create"'), main.indexOf('  ipcMain.handle("projects:remove"'));
async function host(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-new-app-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const studioRoot = path.join(root, "studio"); await mkdir(studioRoot);
  let handler; const selected = [];
  const env = { ipcMain: { handle: (_channel, fn) => { handler = fn; } }, newApp, path, os: { homedir: () => root }, STUDIO_ROOT: studioRoot,
    readdir, mkdir, writeFile, projects: { list: () => ({ activeId: "old" }) }, assistantLog() {},
    registerProjectFolder: async () => ({ addedId: "new" }), selectProject: async (id) => { selected.push(id); return { ok: true }; },
    require: (name) => name === "node:child_process" ? { execFile: (_file, _args, _options, done) => done(null) } : require(name.replace("./scripts/", "../scripts/")),
  };
  vm.runInNewContext(handlerSource, env);
  return { root, studioRoot, selected, env, create: (payload) => handler(null, payload) };
}

test("New app host selects a second project and preserves an existing folder", async (t) => {
  const h = await host(t);
  const result = await h.create({ name: "Pixel Garden", about: "Grow plants" });
  assert.equal(result.ok, true);
  assert.deepEqual(h.selected, ["new"]);
  assert.match(await readFile(path.join(result.folder, "README.md"), "utf8"), /Grow plants/);
  const again = await h.create({ name: "Pixel Garden", about: "Replacement" });
  assert.equal(again.ok, false);
  assert.match(await readFile(path.join(result.folder, "README.md"), "utf8"), /Grow plants/);
});

test("New app refuses a junction into Studio and surfaces a failed README write", async (t) => {
  const h = await host(t);
  const alias = path.join(h.root, "alias");
  await symlink(h.studioRoot, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal((await h.create({ name: "Game", parent: alias })).ok, false);
  assert.deepEqual(await readdir(h.studioRoot), []);
  h.env.writeFile = async () => { throw new Error("Disk is full"); };
  const result = await h.create({ name: "Notes" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Disk is full/);
  assert.deepEqual(h.selected, []);
});

test("a refused project switch reports the created folder so opening it can be retried", async (t) => {
  const h = await host(t);
  h.env.selectProject = async () => ({ ok: false, busy: true, error: "A build is still running" });
  const result = await h.create({ name: "Notes" });
  assert.equal(result.ok, false); assert.equal(result.created, true); assert.equal(result.addedId, "new");
  assert.ok((await readdir(result.folder)).includes("README.md"));
});
