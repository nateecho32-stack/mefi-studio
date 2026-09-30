import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile, lstat, utimes } from "node:fs/promises";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipDirectory, extractZip } from "../scripts/release-updater.mjs";

// The host half of the Skills page (scripts/skills.cjs) against real temporary folders: what it
// lists, what it will write and where (only <project>/.agents/skills/<name>/SKILL.md), what it
// never overwrites, what it keeps aside first, what a link can not make it follow, what an import
// must meet, and the kill switch. The inventory agents read (agent-addons.cjs) is the real one.
const require = createRequire(import.meta.url);
const { createSkills, KEEP_BACKUPS } = require("../scripts/skills.cjs");
const format = require("../scripts/skill-format.cjs");
const addons = require("../scripts/agent-addons.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));

async function workspace(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-skills-host-"));
  const project = path.join(root, "project"), home = path.join(root, "home"), keep = path.join(root, "kept"), outside = path.join(root, "outside"), away = path.join(root, "away");
  for (const folder of [project, home, outside, away]) await mkdir(folder, { recursive: true });
  const touched = [];
  // A filesystem that remembers every path it was asked to change, so "nothing outside" is a measurement.
  const recording = new Proxy(fsp, { get: (target, key) => {
    const real = target[key];
    if (typeof real !== "function") return real;
    if (!["writeFile", "rename", "link", "mkdir", "rm", "rmdir", "unlink", "copyFile", "symlink", "appendFile", "truncate", "chmod", "utimes"].includes(key)) return real;
    return (...args) => { for (const arg of args.slice(0, key === "rename" || key === "link" || key === "copyFile" ? 2 : 1)) if (typeof arg === "string") touched.push(path.resolve(arg)); return real.apply(target, args); };
  } });
  let enabled = options.enabled ?? true;
  const skills = createSkills({
    root: () => (options.noProject ? null : project), fs: recording, enabled: () => enabled,
    backups: options.backups === undefined ? () => keep : options.backups, inventory: (given) => addons.inventory(given, { home }),
    zip: options.zip === undefined ? zipDirectory : options.zip, now: options.now,
  });
  return { root, project, home, keep, outside, away, touched, skills, base: path.join(project, ".agents", "skills"), off: () => { enabled = false; }, done: () => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }) };
}
const draft = (name = "bug-triage", extra = {}) => ({ name, description: "Sort a bug report into severity and owner", body: "1. Read it.\n2. Fix it.", ...extra });
const fileOf = (w, name) => path.join(w.base, name, "SKILL.md");
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); };
async function link(target, at, type) { try { await symlink(target, at, type); return true; } catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return false; throw error; } }

test("listing an untouched project reads and writes nothing, and offers the starters", async () => {
  const w = await workspace();
  try {
    const listed = plain(await w.skills.list());
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.skills, []);
    assert.equal(listed.dir, ".agents/skills");
    assert.equal(listed.writable, true);
    assert.deepEqual(listed.starters.map((starter) => starter.name), format.STARTERS.map((starter) => starter.name));
    assert.deepEqual(listed.limits, { maxBytes: 32000, autoLoadChars: 16000, maxDescription: 300, namePattern: "^[a-z0-9][a-z0-9-]{0,63}$", nameProblem: "Use lowercase letters, numbers and dashes, up to 64 characters." });
    assert.deepEqual(w.touched, [], "a list changes nothing");
    await assert.rejects(() => stat(path.join(w.project, ".agents")), /ENOENT/, "and does not make the folder");
    const closed = await (await workspace({ noProject: true })).skills.list();
    assert.deepEqual(plain(closed), { ok: false, error: "Open a project first." });
  } finally { await w.done(); }
});

test("create writes the file the inventory then lists, and what a save makes is what an agent loads", async () => {
  const w = await workspace();
  try {
    const made = plain(await w.skills.create(draft()));
    assert.equal(made.ok, true);
    assert.equal(made.skill.name, "bug-triage");
    assert.equal(made.skill.path, ".agents/skills/bug-triage/SKILL.md");
    assert.equal(made.skill.description, "Sort a bug report into severity and owner");
    assert.equal(made.skill.editable, true);
    assert.equal(made.skill.loadsByItself, true);
    assert.equal(await readFile(fileOf(w, "bug-triage"), "utf8"), "---\nname: bug-triage\ndescription: Sort a bug report into severity and owner\n---\n\n1. Read it.\n2. Fix it.\n");
    assert.deepEqual((await readdir(path.join(w.base, "bug-triage"))), ["SKILL.md"], "no temporary file is left behind");
    // The page's list, and the inventory the agents read, agree on it.
    assert.deepEqual(plain(await w.skills.list()).skills.map((skill) => skill.name), ["bug-triage"]);
    const catalog = await addons.catalog(w.project, { home: w.home });
    assert.deepEqual(catalog.map(({ name, scope }) => ({ name, scope })), [{ name: "bug-triage", scope: "project" }]);
    const text = await addons.instructions(w.project, { agentSkills: { builder: [catalog[0].id] } }, "builder", { home: w.home });
    assert.match(text, /Skill: bug-triage\n---\nname: bug-triage\ndescription: Sort a bug report into severity and owner\n---/);
    assert.match(text, /1\. Read it\./, "an agent given the skill is given what the page wrote");
    // A save of different words is read back the same way.
    const saved = plain(await w.skills.save(draft("bug-triage", { description: "Triage a bug", body: "Only step." })));
    assert.equal(saved.ok, true);
    assert.match(await addons.instructions(w.project, { agentSkills: { builder: [catalog[0].id] } }, "builder", { home: w.home }), /description: Triage a bug[\s\S]*Only step\./);
    const read = plain(await w.skills.read("bug-triage"));
    assert.deepEqual({ name: read.name, description: read.description, body: read.body }, { name: "bug-triage", description: "Triage a bug", body: "Only step.\n" });
  } finally { await w.done(); }
});

test("create and import never overwrite, including two made at the same moment", async () => {
  const w = await workspace();
  try {
    assert.equal((await w.skills.create(draft())).ok, true);
    const before = await readFile(fileOf(w, "bug-triage"), "utf8");
    const again = plain(await w.skills.create(draft("bug-triage", { description: "Different", body: "Different." })));
    assert.deepEqual(again, { ok: false, error: "A skill named bug-triage already exists. Studio never overwrites one.", exists: true });
    assert.equal(await readFile(fileOf(w, "bug-triage"), "utf8"), before, "the first is untouched");
    // A folder that is already there (somebody's own, with no SKILL.md yet) is not taken over either.
    await mkdir(path.join(w.base, "hand-made"));
    await writeFile(path.join(w.base, "hand-made", "notes.txt"), "mine");
    assert.equal((await w.skills.create(draft("hand-made"))).exists, true);
    assert.deepEqual(await readdir(path.join(w.base, "hand-made")), ["notes.txt"]);
    // Two at once: one wins, the other is told, and what is on disk is exactly one of them.
    const pair = plain(await Promise.all([w.skills.create(draft("race", { body: "First." })), w.skills.create(draft("race", { body: "Second." }))]));
    assert.deepEqual(pair.map((result) => result.ok).sort(), [false, true]);
    assert.equal(pair.find((result) => !result.ok).exists, true);
    assert.match(await readFile(fileOf(w, "race"), "utf8"), /^---\nname: race\n[\s\S]*\n(First|Second)\.\n$/);
    assert.deepEqual(await readdir(path.join(w.base, "race")), ["SKILL.md"]);
    // An import of a skill that exists is refused too.
    const source = path.join(w.away, "bug-triage");
    await mkdir(source);
    await writeFile(path.join(source, "SKILL.md"), format.build(draft("bug-triage", { body: "From away." })));
    assert.equal((await w.skills.importFrom(source)).exists, true);
    assert.equal(await readFile(fileOf(w, "bug-triage"), "utf8"), before);
  } finally { await w.done(); }
});

test("save replaces an existing skill atomically, keeps the other front matter, says when nothing changed, and keeps the old text aside", async () => {
  let clock = Date.parse("2026-09-30T10:00:00.000Z");
  const w = await workspace({ now: () => (clock += 1000) });
  try {
    const original = "---\nname: bug-triage\ndescription: Old words\nallowed-tools:\n  - Read\n  - Grep\n---\n\nOld body.\n";
    await mkdir(path.join(w.base, "bug-triage"), { recursive: true });
    await writeFile(fileOf(w, "bug-triage"), original);
    assert.equal(plain(await w.skills.save({ name: "never-made", description: "d", body: "b" })).missing, true, "a save is for a skill that exists");
    const first = plain(await w.skills.save(draft("bug-triage", { description: "New words", body: "New body." })));
    assert.equal(first.ok, true);
    const now = await readFile(fileOf(w, "bug-triage"), "utf8");
    assert.equal(now, "---\nname: bug-triage\ndescription: New words\nallowed-tools:\n  - Read\n  - Grep\n---\n\nNew body.\n", "another tool's keys survive an edit");
    assert.deepEqual(await readdir(path.join(w.base, "bug-triage")), ["SKILL.md"], "the temporary file is gone");
    const kept = await readdir(path.join(w.keep, "bug-triage"));
    assert.equal(kept.length, 1);
    assert.equal(await readFile(path.join(w.keep, "bug-triage", kept[0]), "utf8"), original, "what was replaced is kept outside the project");
    assert.ok(!inside(w.project, path.join(w.keep)), "the safety folder is not in the project");
    // The same words again change nothing and keep nothing.
    const writes = w.touched.length;
    const same = plain(await w.skills.save(draft("bug-triage", { description: "New words", body: "New body." })));
    assert.equal(same.unchanged, true);
    assert.equal(w.touched.length, writes, "no write happened");
    assert.equal((await readdir(path.join(w.keep, "bug-triage"))).length, 1);
    // A failed check changes nothing.
    const bad = plain(await w.skills.save(draft("bug-triage", { description: "" })));
    assert.equal(bad.ok, false); assert.equal(bad.field, "description");
    assert.equal(await readFile(fileOf(w, "bug-triage"), "utf8"), now);
  } finally { await w.done(); }
});

test("a save keeps ten copies of a skill's past and no more", async () => {
  let clock = Date.parse("2026-09-30T10:00:00.000Z");
  const w = await workspace({ now: () => (clock += 1000) });
  try {
    assert.equal(KEEP_BACKUPS, 10);
    await w.skills.create(draft("loop", { body: "v0" }));
    for (let version = 1; version <= 14; version += 1) assert.equal((await w.skills.save(draft("loop", { body: `v${version}` }))).ok, true);
    const kept = (await readdir(path.join(w.keep, "loop"))).sort();
    assert.equal(kept.length, 10);
    const bodies = await Promise.all(kept.map(async (file) => (await readFile(path.join(w.keep, "loop", file), "utf8")).match(/v\d+/)[0]));
    assert.deepEqual(bodies, ["v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12", "v13"], "the ten newest replaced versions stay");
  } finally { await w.done(); }
});

test("when the old text can not be kept, nothing is replaced or deleted", async () => {
  const w = await workspace();
  try {
    await w.skills.create(draft("keep-me"));
    const before = await readFile(fileOf(w, "keep-me"), "utf8");
    // The safety folder's place is taken by a file, so no copy can be made.
    await writeFile(w.keep, "a file where the folder should be");
    const saved = plain(await w.skills.save(draft("keep-me", { body: "Changed." })));
    assert.deepEqual(saved, { ok: false, error: "Studio could not keep a copy of the current file first, so nothing was changed." });
    assert.equal(await readFile(fileOf(w, "keep-me"), "utf8"), before, "the skill is as it was");
    const removed = plain(await w.skills.delete("keep-me"));
    assert.equal(removed.ok, false);
    assert.equal(removed.error, "Studio could not keep a copy of the current file first, so nothing was changed.");
    assert.equal(await readFile(fileOf(w, "keep-me"), "utf8"), before, "and was not deleted");
    assert.deepEqual(await readdir(path.join(w.base, "keep-me")), ["SKILL.md"]);
    // A host that keeps no copies at all (no folder named) still works; it simply has nothing to keep.
    const bare = await workspace({ backups: null });
    await bare.skills.create(draft("plain"));
    assert.equal((await bare.skills.save(draft("plain", { body: "Edited." }))).ok, true);
    await bare.done();
  } finally { await w.done(); }
});

test("delete keeps a copy, removes only SKILL.md, and leaves a folder that holds anything else", async () => {
  const w = await workspace();
  try {
    await w.skills.create(draft("gone"));
    await w.skills.create(draft("has-extras"));
    await writeFile(path.join(w.base, "has-extras", "helper.py"), "print('mine')");
    const gone = plain(await w.skills.delete("gone"));
    assert.deepEqual(gone, { ok: true, name: "gone", keptFiles: 0 });
    await assert.rejects(() => stat(path.join(w.base, "gone")), /ENOENT/, "an empty folder goes with it");
    assert.equal((await readdir(path.join(w.keep, "gone"))).length, 1, "a copy of what was deleted is kept");
    const extras = plain(await w.skills.delete("has-extras"));
    assert.deepEqual(extras, { ok: true, name: "has-extras", keptFiles: 1 });
    assert.deepEqual(await readdir(path.join(w.base, "has-extras")), ["helper.py"], "somebody's helper file is not ours to remove");
    assert.equal(plain(await w.skills.delete("gone")).missing, true);
    assert.equal(plain(await w.skills.delete("../../etc")).field, "name");
  } finally { await w.done(); }
});

test("a hostile name, from any call, writes nothing and touches nothing outside .agents/skills", async () => {
  const w = await workspace();
  try {
    await w.skills.create(draft("fine"));
    const hostile = ["", "..", ".", "../escape", "..\\escape", "a/b", "a\\b", "/etc/passwd", "C:\\Windows", "C:/x", "a:b", "x".repeat(65), "UPPER", "with space", ".hidden", "con", "nul", "a\u0000b", "a\nb", "é", "..%2f", "%2e%2e", "a/../../b", null, undefined, 42, {}, []];
    const before = w.touched.length;
    for (const name of hostile) {
      for (const result of [await w.skills.create({ ...draft(), name }), await w.skills.save({ ...draft(), name }), await w.skills.delete(name), await w.skills.read(name), await w.skills.exportTo({ name, target: path.join(w.away, "x"), kind: "folder" })]) {
        assert.equal(result.ok, false, `${JSON.stringify(name)} is refused`);
      }
    }
    assert.equal(w.touched.length, before, "not one write, move or delete was attempted for a bad name");
    // And across everything done so far, every path changed is under the skills folder, the safety folder or a temp of them.
    await w.skills.save(draft("fine", { body: "Changed." }));
    await w.skills.delete("fine");
    for (const target of w.touched) assert.ok(inside(w.base, target) || inside(w.project, target) && inside(path.join(w.project, ".agents"), target) || inside(w.keep, target) || inside(w.away, target), `${target} is within the allowed places`);
    assert.deepEqual((await readdir(w.project)).sort(), [".agents"], "nothing else appeared in the project");
    assert.deepEqual(await readdir(w.outside), [], "nothing was written beside the project");
  } finally { await w.done(); }
});

test("a link is never followed: not .agents, not .agents/skills, not a skill's folder, not its SKILL.md", async () => {
  const w = await workspace();
  try {
    const target = path.join(w.outside, "elsewhere");
    await mkdir(target);
    // .agents itself is a link out of the project.
    if (!(await link(target, path.join(w.project, ".agents"), "junction"))) return;
    for (const result of [await w.skills.create(draft()), await w.skills.importFrom(await (async () => { const source = path.join(w.away, "s"); await mkdir(source); await writeFile(path.join(source, "SKILL.md"), format.build(draft("s"))); return source; })())]) {
      assert.equal(result.ok, false);
      assert.match(result.error, /^\.agents is a link, and Studio does not write through links\.$/);
    }
    assert.deepEqual(await readdir(target), [], "nothing was written through it");
    assert.equal(plain(await w.skills.list()).blocked, ".agents is a link, and Studio does not write through links.", "the page is told, not shown an empty list as if all were well");
    await rm(path.join(w.project, ".agents"), { recursive: true, force: true });
    // .agents/skills is a link.
    await mkdir(path.join(w.project, ".agents"));
    await link(target, path.join(w.project, ".agents", "skills"), "junction");
    assert.match((await w.skills.create(draft())).error, /^\.agents\/skills is a link/);
    assert.deepEqual(await readdir(target), []);
    await rm(path.join(w.project, ".agents", "skills"), { recursive: true, force: true });
    // A skill's own folder is a link: it is not listed, read, saved over, deleted or exported.
    await mkdir(path.join(w.base), { recursive: true });
    await writeFile(path.join(target, "SKILL.md"), format.build(draft("linked")));
    await link(target, path.join(w.base, "linked"), "junction");
    assert.deepEqual(plain(await w.skills.list()).skills, []);
    for (const result of [await w.skills.read("linked"), await w.skills.save(draft("linked", { body: "x" })), await w.skills.delete("linked"), await w.skills.exportTo({ name: "linked", target: path.join(w.away, "out"), kind: "folder" })]) assert.equal(result.ok, false);
    assert.equal(await readFile(path.join(target, "SKILL.md"), "utf8"), format.build(draft("linked")), "what the link points at is untouched");
    assert.equal((await w.skills.create(draft("linked"))).exists, true, "and a name taken by a link is taken");
    // A SKILL.md that is a link is not a skill (the inventory skips it too).
    await mkdir(path.join(w.base, "filelink"));
    if (await link(path.join(target, "SKILL.md"), path.join(w.base, "filelink", "SKILL.md"), "file")) {
      assert.deepEqual(plain(await w.skills.list()).skills.map((skill) => skill.name), []);
      assert.equal((await w.skills.save(draft("filelink", { body: "x" }))).ok, false);
      assert.equal((await addons.catalog(w.project, { home: w.home })).length, 0, "the inventory agrees");
    }
  } finally { await w.done(); }
});

test("listing shows what is there, honestly: problems, what agents skip, what cannot be opened, other tools' skills", async () => {
  const w = await workspace();
  try {
    const put = async (folder, text, at = w.base) => { await mkdir(path.join(at, folder), { recursive: true }); await writeFile(path.join(at, folder, "SKILL.md"), text); };
    await put("good", format.build(draft("good")));
    await put("no-front-matter", "Just some words, no front matter.\nSecond line.");
    await put("mismatch", "---\nname: something-else\ndescription: d\n---\nB");
    await put("no-description", "---\nname: no-description\n---\nB");
    await put("Bad_Name", "---\nname: Bad_Name\ndescription: d\n---\nB");
    await put("big-but-readable", format.build(draft("big-but-readable", { body: "x".repeat(40000) })));
    await put("too-big-to-open", format.build(draft("too-big-to-open", { body: "x".repeat(70000) })));
    await put("over-the-auto-load", format.build(draft("over-the-auto-load", { body: "y".repeat(20000) })));
    await mkdir(path.join(w.base, ".hidden-dir"));
    await writeFile(path.join(w.base, ".hidden-dir", "SKILL.md"), "hidden");
    await mkdir(path.join(w.base, "empty-folder"));
    await writeFile(path.join(w.base, "a-loose-file.md"), "not a folder");
    await put("from-claude", "---\nname: from-claude\ndescription: d\n---\nB", path.join(w.project, ".claude", "skills"));
    await put("from-home", "---\nname: from-home\ndescription: d\n---\nB", path.join(w.home, ".claude", "skills"));
    const listed = plain(await w.skills.list());
    const row = (name) => listed.skills.find((skill) => skill.name === name);
    assert.deepEqual(listed.skills.map((skill) => skill.name), ["Bad_Name", "big-but-readable", "good", "mismatch", "no-description", "no-front-matter", "over-the-auto-load", "too-big-to-open"], "sorted by name whatever the case, hidden folders, empty folders and loose files left out");
    assert.equal(row("good").problem, undefined);
    assert.match(row("no-front-matter").problem, /^It has no front matter\. Saving adds a name and a description\.$/);
    assert.equal(row("no-front-matter").description, "Just some words, no front matter.", "a description is taken from the words when none is given");
    assert.match(row("mismatch").problem, /^Its front matter names it something-else, but its folder is mismatch\./);
    assert.match(row("no-description").problem, /no description/);
    assert.equal(row("Bad_Name").problem, "Use lowercase letters, numbers and dashes, up to 64 characters.");
    assert.equal(row("Bad_Name").editable, false, "a name the page would not allow is shown, not edited");
    assert.match(row("big-but-readable").problem, /Agents skip anything over 32 KB; shorten it/);
    assert.equal(row("big-but-readable").editable, true);
    assert.match(row("too-big-to-open").problem, /too big to open here/);
    assert.equal(row("too-big-to-open").editable, false);
    assert.equal(row("over-the-auto-load").loadsByItself, false, "over 16 KB: agents load it only when it is called by name");
    assert.equal(row("good").loadsByItself, true);
    // Other tools' folders and the owner's home are named, read-only.
    assert.deepEqual(listed.others.map(({ name, scope, source }) => [name, scope, source]).sort(), [["from-claude", "project", ".claude/skills"], ["from-home", "user", ".claude/skills"]]);
    assert.ok(!listed.starters.some((starter) => starter.name === "good"));
  } finally { await w.done(); }
});

test("the page shows at most 200 skills and one unreadable folder does not hide the rest", async () => {
  const w = await workspace();
  try {
    for (let index = 0; index < 205; index += 1) { const name = `s${String(index).padStart(3, "0")}`; await mkdir(path.join(w.base, name), { recursive: true }); await writeFile(path.join(w.base, name, "SKILL.md"), format.build(draft(name))); }
    const listed = plain(await w.skills.list());
    assert.equal(listed.skills.length, 200);
    assert.equal(listed.skills[0].name, "s000");
  } finally { await w.done(); }
});

test("an import takes a chosen folder's SKILL.md under the rules of a save, as it was written, and says what it left behind", async () => {
  const w = await workspace();
  try {
    const source = path.join(w.away, "imported");
    await mkdir(path.join(source, "scripts"), { recursive: true });
    const text = "---\nname: team-review\ndescription: >\n  Review a change\n  the team's way\nallowed-tools:\n  - Read\n---\n\n# Steps\n\n1. Look.\n";
    await writeFile(path.join(source, "SKILL.md"), text);
    await writeFile(path.join(source, "README.md"), "docs");
    await writeFile(path.join(source, "scripts", "x.sh"), "echo");
    const done = plain(await w.skills.importFrom(source));
    assert.equal(done.ok, true);
    assert.equal(done.skill.name, "team-review");
    assert.equal(done.skill.description, "Review a change the team's way");
    assert.equal(done.skipped, 2, "the other files are not imported, and the page can say so");
    assert.equal(await readFile(fileOf(w, "team-review"), "utf8"), text, "the file lands exactly as it was written");
    assert.deepEqual(await readdir(path.join(w.base, "team-review")), ["SKILL.md"]);
    assert.deepEqual((await readdir(source)).sort(), ["README.md", "SKILL.md", "scripts"], "the source is not touched");
    assert.equal((await addons.catalog(w.project, { home: w.home })).some((row) => row.name === "team-review"), true, "and the inventory lists it");
  } finally { await w.done(); }
});

test("an import is refused exactly when a save of the same words would be, and writes nothing", async () => {
  const w = await workspace();
  try {
    const make = async (label, text, extra = async () => {}) => { const folder = path.join(w.away, label); await mkdir(folder, { recursive: true }); if (text !== null) await writeFile(path.join(folder, "SKILL.md"), text); await extra(folder); return folder; };
    const good = draft("ok-skill");
    const cases = [
      ["good", format.build(good), true],
      ["no-front-matter", "Only words.", false],
      ["no-name", "---\ndescription: d\n---\nB", false],
      ["path-name", "---\nname: ../evil\ndescription: d\n---\nB", false],
      ["upper-name", "---\nname: Evil\ndescription: d\n---\nB", false],
      ["reserved-name", "---\nname: con\ndescription: d\n---\nB", false],
      ["no-description", "---\nname: a\n---\nB", false],
      ["empty-description", "---\nname: a\ndescription: \"\"\n---\nB", false],
      ["no-body", "---\nname: a\ndescription: d\n---\n", false],
      ["nul", "---\nname: a\ndescription: d\n---\nB\u0000", false],
      ["over-32-kb", format.build(draft("a", { body: "x".repeat(32500) })).replace(/\s+$/, ""), false],
      // Small once rebuilt, but the file itself is over what the inventory accepts, and it is the file that is copied.
      ["over-32-kb-by-blank-lines", format.build(draft("a", { body: "short" })) + "\n".repeat(32100), false],
      ["too-long-description", `---\nname: a\ndescription: ${"d".repeat(400)}\n---\nB`, false],
    ];
    for (const [label, text, ok] of cases) {
      const folder = await make(label, text);
      const imported = plain(await w.skills.importFrom(folder));
      assert.equal(imported.ok, ok, `${label}: ${imported.error ?? "imported"}`);
      if (!ok) assert.ok(imported.error.length > 10, `${label} says why`);
      // The same words as a save's draft agree.
      const parsed = format.parse(text);
      assert.equal(format.check({ name: parsed.name, description: parsed.description, body: parsed.body, extra: parsed.extra }).ok && parsed.frontMatter && !text.includes("\u0000") && Buffer.byteLength(text) <= 32000, ok, `${label}: the same verdict as check`);
    }
    assert.deepEqual((await readdir(w.base)).sort(), ["ok-skill"], "only the good one was written");
    // Not a folder, no SKILL.md, a relative path, a missing one, and a link for SKILL.md.
    const file = path.join(w.away, "a-file"); await writeFile(file, "x");
    assert.equal((await w.skills.importFrom(file)).error, "Choose a folder, not a file.");
    assert.equal((await w.skills.importFrom(await make("empty", null))).error, "That folder has no SKILL.md.");
    assert.equal((await w.skills.importFrom("relative/folder")).error, "Choose a folder to import.");
    assert.equal((await w.skills.importFrom(path.join(w.away, "missing"))).error, "That folder can't be opened.");
    assert.equal((await w.skills.importFrom(undefined)).error, "Choose a folder to import.");
    const linked = await make("linked", null, async (folder) => { await writeFile(path.join(w.outside, "real.md"), format.build(draft("linked-skill"))); await link(path.join(w.outside, "real.md"), path.join(folder, "SKILL.md"), "file"); });
    if ((await lstat(path.join(linked, "SKILL.md")).catch(() => null))?.isSymbolicLink()) assert.equal((await w.skills.importFrom(linked)).error, "That folder has no SKILL.md.", "a SKILL.md that is a link is not followed");
    assert.deepEqual((await readdir(w.base)).sort(), ["ok-skill"]);
  } finally { await w.done(); }
});

test("export writes a new folder or a zip where the owner chose, and never replaces a folder", async () => {
  const w = await workspace();
  try {
    await w.skills.create(draft("shareable"));
    const bytes = await readFile(fileOf(w, "shareable"));
    const folder = path.join(w.away, "shareable-copy");
    const out = plain(await w.skills.exportTo({ name: "shareable", target: folder, kind: "folder" }));
    assert.deepEqual(out, { ok: true, where: folder, kind: "folder" });
    assert.deepEqual(await readdir(folder), ["SKILL.md"]);
    assert.ok(bytes.equals(await readFile(path.join(folder, "SKILL.md"))), "the same bytes");
    const again = plain(await w.skills.exportTo({ name: "shareable", target: folder, kind: "folder" }));
    assert.equal(again.exists, true);
    assert.match(again.error, /^That folder already exists\. Choose a new name; nothing is replaced\.$/);
    assert.equal((await w.skills.exportTo({ name: "shareable", target: path.join(w.away, "no", "parent"), kind: "folder" })).error, "The folder to put it in does not exist.");
    assert.equal((await w.skills.exportTo({ name: "shareable", target: "relative", kind: "folder" })).error, "Choose where to save it.");
    assert.equal((await w.skills.exportTo({ name: "absent", target: path.join(w.away, "z"), kind: "folder" })).missing, true);
    // A zip, with .zip added when the owner's name lacked it; it holds <name>/SKILL.md and nothing else.
    await writeFile(path.join(w.base, "shareable", "extra.txt"), "not exported");
    const zipped = plain(await w.skills.exportTo({ name: "shareable", target: path.join(w.away, "shareable"), kind: "zip" }));
    assert.deepEqual(zipped, { ok: true, where: path.join(w.away, "shareable.zip"), kind: "zip" });
    const unpacked = path.join(w.away, "unpacked");
    await extractZip(path.join(w.away, "shareable.zip"), unpacked);
    assert.deepEqual(await readdir(unpacked), ["shareable"]);
    assert.deepEqual(await readdir(path.join(unpacked, "shareable")), ["SKILL.md"], "only the skill's own file");
    assert.ok(bytes.equals(await readFile(path.join(unpacked, "shareable", "SKILL.md"))));
    assert.deepEqual((await readdir(w.away)).filter((file) => file.includes(".part-")), [], "no half-made zip is left");
    // A zip writer that fails leaves nothing behind and says so.
    const failing = await workspace({ zip: async (_source, target) => { await writeFile(target, "half"); throw new Error("disk full"); } });
    await failing.skills.create(draft("shareable"));
    const failed = plain(await failing.skills.exportTo({ name: "shareable", target: path.join(failing.away, "f.zip"), kind: "zip" }));
    assert.equal(failed.ok, false);
    assert.deepEqual(await readdir(failing.away), [], "neither the zip nor its temporary file remains");
    await failing.done();
    const none = await workspace({ zip: null });
    await none.skills.create(draft("shareable"));
    assert.equal((await none.skills.exportTo({ name: "shareable", target: path.join(none.away, "z.zip"), kind: "zip" })).error, "Zip files can't be made here.");
    await none.done();
  } finally { await w.done(); }
});

test("MEFI_STUDIO_NO_SKILL_EDIT: with editing off nothing in the project is saved, created, deleted or imported, and listing and export still work", async () => {
  const w = await workspace();
  try {
    await w.skills.create(draft("kept"));
    const before = await readFile(fileOf(w, "kept"), "utf8");
    w.off();
    const off = { ok: false, off: true, error: "Editing skills is switched off on this PC." };
    const source = path.join(w.away, "imp"); await mkdir(source); await writeFile(path.join(source, "SKILL.md"), format.build(draft("imp")));
    const writes = w.touched.length;
    assert.deepEqual(plain(await w.skills.create(draft("new-one"))), off);
    assert.deepEqual(plain(await w.skills.save(draft("kept", { body: "x" }))), off);
    assert.deepEqual(plain(await w.skills.delete("kept")), off);
    assert.deepEqual(plain(await w.skills.importFrom(source)), off);
    assert.equal(w.touched.length, writes, "no write was attempted");
    assert.equal(await readFile(fileOf(w, "kept"), "utf8"), before);
    const listed = plain(await w.skills.list());
    assert.equal(listed.writable, false, "the page is told to show itself read-only");
    assert.deepEqual(listed.skills.map((skill) => skill.name), ["kept"]);
    assert.equal(plain(await w.skills.read("kept")).ok, true);
    assert.equal(plain(await w.skills.exportTo({ name: "kept", target: path.join(w.away, "out"), kind: "folder" })).ok, true, "a copy to somewhere the owner chose is not editing the project");
  } finally { await w.done(); }
});

test("hand-made files in other shapes: a BOM, CRLF and an old mtime are read and left alone until saved", async () => {
  const w = await workspace();
  try {
    await mkdir(path.join(w.base, "windows"), { recursive: true });
    const crlf = "\uFEFF---\r\nname: windows\r\ndescription: Made on Windows\r\n---\r\n\r\nLine one\r\nLine two\r\n";
    await writeFile(fileOf(w, "windows"), crlf);
    const old = new Date("2020-01-01T00:00:00Z");
    await utimes(fileOf(w, "windows"), old, old);
    const read = plain(await w.skills.read("windows"));
    assert.equal(read.description, "Made on Windows");
    assert.equal(read.body, "Line one\nLine two\n");
    assert.equal(plain(await w.skills.list()).skills[0].updatedAt, old.getTime());
    assert.equal(await readFile(fileOf(w, "windows"), "utf8"), crlf, "reading changed nothing");
    // The same words saved back are the same file in substance: nothing to write.
    assert.equal(plain(await w.skills.save({ name: "windows", description: "Made on Windows", body: "Line one\nLine two\n" })).unchanged, true);
    assert.equal(await readFile(fileOf(w, "windows"), "utf8"), crlf);
  } finally { await w.done(); }
});
