// The Skills page's channels inside the host (main.cjs "Skills"): the real block run against a real
// temporary project with only Electron's dialogs replaced. Import and export open the dialogs here
// (the page never names a folder), a name that is not a skill opens no dialog, the safety copies go to
// the project's data folder and not into the project, MEFI_STUDIO_NO_SKILL_EDIT=1 stops the writes, and
// the bridge carries names and text, never a path.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractZip } from "../scripts/release-updater.mjs";

const source = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const mainRequire = createRequire(new URL("../main.cjs", import.meta.url));
const addons = mainRequire("./scripts/agent-addons.cjs");
const format = mainRequire("./scripts/skill-format.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));
const good = (name = "bug-triage", body = "1. Read it.") => format.build({ name, description: "Sort a bug report", body });

async function host({ env = {}, open = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-skills-ipc-"));
  const project = path.join(root, "project"), data = path.join(root, "data"), documents = path.join(root, "documents"), away = path.join(root, "away");
  for (const folder of [project, data, documents, away]) await mkdir(folder, { recursive: true });
  const dialogs = { open: [], save: [] };
  const next = { open: { canceled: true }, save: { canceled: true } };
  const context = vm.createContext({
    require: mainRequire, path, process: { env: { ...env } }, console, Promise, Buffer,
    projects: { open: () => (open ? { id: "p1" } : null) }, projectRoot: () => project, TASKS_PATH: "eyes-tasks.json", projectDataPath: () => path.join(data, "projects", "p1", "eyes-tasks.json"),
    agentAddons: { inventory: (given) => addons.inventory(given, { home: path.join(root, "home") }) },
    loadModule: (relative) => import(new URL(`../${relative}`, import.meta.url)),
    window: { id: "main-window" }, app: { getPath: (name) => (name === "documents" ? documents : root) },
    dialog: { showOpenDialog: async (win, options) => { dialogs.open.push({ win, options }); return next.open; }, showSaveDialog: async (win, options) => { dialogs.save.push({ win, options }); return next.save; } },
  });
  vm.runInContext(section("// ---- Skills: the Skills page's files", "// ---- end of skills"), context);
  return { context, project, data, documents, away, dialogs, next, env: context.process.env, base: path.join(project, ".agents", "skills"), done: () => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }) };
}

test("import opens the folder dialog here, takes only SKILL.md from what was chosen, and a cancel changes nothing", async () => {
  const h = await host();
  try {
    const folder = path.join(h.away, "team-review");
    await mkdir(folder);
    await writeFile(path.join(folder, "SKILL.md"), good("team-review"));
    await writeFile(path.join(folder, "notes.txt"), "left behind");
    assert.deepEqual(plain(await h.context.skillsImport()), { ok: false, canceled: true });
    assert.deepEqual(plain(h.dialogs.open[0].options), { title: "Import a skill: choose its folder", properties: ["openDirectory"], buttonLabel: "Import" });
    assert.equal(h.dialogs.open[0].win.id, "main-window", "the dialog belongs to the window");
    await assert.rejects(() => readdir(h.base), /ENOENT/, "a cancel wrote nothing");
    h.next.open = { canceled: false, filePaths: [folder] };
    const done = plain(await h.context.skillsImport());
    assert.equal(done.ok, true);
    assert.equal(done.skill.name, "team-review");
    assert.equal(done.skipped, 1);
    assert.deepEqual(await readdir(path.join(h.base, "team-review")), ["SKILL.md"]);
    h.next.open = { canceled: false, filePaths: [] };
    assert.equal(plain(await h.context.skillsImport()).canceled, true, "no folder chosen is a cancel");
    h.next.open = { canceled: false, filePaths: [path.join(h.away, "missing")] };
    assert.equal(plain(await h.context.skillsImport()).error, "That folder can't be opened.");
  } finally { await h.done(); }
});

test("export checks the skill first, then opens the Save dialog, and writes a folder or a zip where it is told", async () => {
  const h = await host();
  try {
    assert.equal(plain(await h.context.skillsHost().create({ name: "shareable", description: "Shareable", body: "Steps." })).ok, true);
    const missing = plain(await h.context.skillsExport({ name: "not-a-skill", kind: "folder" }));
    assert.equal(missing.ok, false); assert.equal(missing.missing, true);
    assert.equal(plain(await h.context.skillsExport({ name: "../../etc", kind: "zip" })).field, "name");
    assert.equal(h.dialogs.save.length, 0, "no dialog is opened for a name that is not a skill");
    assert.deepEqual(plain(await h.context.skillsExport({ name: "shareable", kind: "folder" })), { ok: false, canceled: true });
    assert.deepEqual(plain(h.dialogs.save[0].options), { title: "Export a skill as a folder", buttonLabel: "Export", defaultPath: path.join(h.documents, "shareable") });
    h.next.save = { canceled: false, filePath: path.join(h.away, "shareable-out") };
    const folder = plain(await h.context.skillsExport({ name: "shareable", kind: "folder" }));
    assert.deepEqual(folder, { ok: true, where: path.join(h.away, "shareable-out"), kind: "folder" });
    assert.deepEqual(await readdir(path.join(h.away, "shareable-out")), ["SKILL.md"]);
    h.next.save = { canceled: false, filePath: path.join(h.away, "shareable") };
    const zipped = plain(await h.context.skillsExport({ name: "shareable", kind: "zip" }));
    assert.deepEqual(zipped, { ok: true, where: path.join(h.away, "shareable.zip"), kind: "zip" });
    assert.deepEqual(plain(h.dialogs.save.at(-1).options), { title: "Export a skill as a zip", buttonLabel: "Export", defaultPath: path.join(h.documents, "shareable.zip"), filters: [{ name: "Zip file", extensions: ["zip"] }] });
    await extractZip(path.join(h.away, "shareable.zip"), path.join(h.away, "unpacked"));
    assert.deepEqual(await readdir(path.join(h.away, "unpacked", "shareable")), ["SKILL.md"]);
    assert.equal(plain(await h.context.skillsExport({ name: "shareable", kind: "anything-else" })).where, path.join(h.away, "shareable"), "an unknown kind is a folder");
    h.next.save = { canceled: false, filePath: "" };
    assert.equal(plain(await h.context.skillsExport({ name: "shareable", kind: "zip" })).canceled, true, "no path is a cancel");
  } finally { await h.done(); }
});

test("the old text of a saved or deleted skill is kept in the project's data folder, not in the project", async () => {
  const h = await host();
  try {
    const skills = h.context.skillsHost();
    await skills.create({ name: "kept", description: "Kept", body: "First." });
    await skills.save({ name: "kept", description: "Kept", body: "Second." });
    await skills.delete("kept");
    const place = path.join(h.data, "projects", "p1", "skill-backups", "kept");
    const files = (await readdir(place)).sort();
    assert.equal(files.length, 2, "one for the save, one for the delete");
    const texts = await Promise.all(files.map((file) => readFile(path.join(place, file), "utf8")));
    assert.ok(texts.some((text) => text.includes("First.")) && texts.some((text) => text.includes("Second.")));
    assert.deepEqual((await readdir(h.project)).sort(), [".agents"], "nothing but .agents in the project");
    assert.deepEqual(await readdir(path.join(h.project, ".agents", "skills")), [], "and it holds no backup folder either");
  } finally { await h.done(); }
});

test("MEFI_STUDIO_NO_SKILL_EDIT=1: no dialog for an import, no write from any call, the page is told it is read-only", async () => {
  const h = await host({ env: { MEFI_STUDIO_NO_SKILL_EDIT: "1" } });
  try {
    assert.deepEqual(plain(await h.context.skillsImport()), { ok: false, off: true, error: "Editing skills is switched off on this PC." });
    assert.equal(h.dialogs.open.length, 0, "the dialog is not even shown");
    const skills = h.context.skillsHost();
    for (const result of [await skills.create({ name: "x", description: "d", body: "b" }), await skills.save({ name: "x", description: "d", body: "b" }), await skills.delete("x")]) assert.equal(plain(result).off, true);
    await assert.rejects(() => readdir(h.base), /ENOENT/);
    assert.equal(plain(await skills.list()).writable, false);
    h.env.MEFI_STUDIO_NO_SKILL_EDIT = "0";
    assert.equal(plain(await skills.list()).writable, true, "only 1 turns it off, and it is read each time");
  } finally { await h.done(); }
  const closed = await host({ open: false });
  try { assert.deepEqual(plain(await closed.context.skillsHost().list()), { ok: false, error: "Open a project first." }); } finally { await closed.done(); }
});

test("the channels take names and text and never a path, are project-gated, and the bridge says so too", async () => {
  for (const line of [
    'ipcMain.handle("skills:list", () => skillsHost().list());',
    'ipcMain.handle("skills:read", (_event, payload) => skillsHost().read(String(payload?.name ?? "")));',
    'ipcMain.handle("skills:save", (_event, payload) => skillsHost().save({ name: payload?.name, description: payload?.description, body: payload?.body }));',
    'ipcMain.handle("skills:create", (_event, payload) => skillsHost().create({ name: payload?.name, description: payload?.description, body: payload?.body }));',
    'ipcMain.handle("skills:delete", (_event, payload) => skillsHost().delete(String(payload?.name ?? "")));',
    'ipcMain.handle("skills:import", () => skillsImport());',
    'ipcMain.handle("skills:export", (_event, payload) => skillsExport({ name: payload?.name, kind: payload?.kind }));',
  ]) assert.ok(source.includes(line), line);
  const gate = source.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  assert.ok(!/skills:/.test(gate), "skills: is not app-wide: it waits for a project");
  const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
  for (const name of ["skillsList", "skillsRead", "skillsSave", "skillsCreate", "skillsDelete", "skillsImport", "skillsExport"]) assert.match(preload, new RegExp(`  ${name}: `), name);
  assert.doesNotMatch(preload.match(/skillsSave:[^\n]*/)[0], /path|file|folder/i, "a save carries a name, a description and a body");
  assert.match(preload, /skillsExport: \(payload\) => ipcRenderer\.invoke\("skills:export", \{ name: typeof payload\?\.name === "string" \? payload\.name\.slice\(0, 100\) : "", kind: payload\?\.kind === "zip" \? "zip" : "folder" \}\)/);
  assert.match(source, /inventory: \(root\) => agentAddons\.inventory\(root\),/);
  assert.match(readFileSync(new URL("../scripts/agent-addons.cjs", import.meta.url), "utf8"), /module\.exports = \{ catalog, inventory, instructions, validate \};/);
});
