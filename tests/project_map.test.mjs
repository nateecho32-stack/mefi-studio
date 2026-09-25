// The Project Map (0.4.0 M7) must list only the project's own files, fold
// every settled attempt into lasting systems, and hand briefs the systems and
// files a task is about. The ignore rules are the part a mistake leaks through,
// so they are pinned path by path.
import test from "node:test";
import assert from "node:assert/strict";
import {
  IGNORED, normalizePath, indexEntry, parseIndex, systemKeyFor, buildMap, relatedFor, briefLine, namePrompt, applyNames,
} from "../scripts/project-map.cjs";

const HOUR = 60 * 60 * 1000;
import mapModule from "../scripts/project-map.cjs";
const NOW = 1_800_000_000_000;

test("the ignore list is frozen and holds every prefix the roadmap names", () => {
  assert.ok(Object.isFrozen(IGNORED));
  for (const prefix of ["data/", "node_modules/", ".git/", "dist/", "build/", "coverage/", ".mefi/", "tools/logs/", ".claude/", ".codex/"]) {
    assert.ok(IGNORED.includes(prefix), prefix);
  }
});

test("POSIX paths are made project-relative and nothing outside the root is listed", () => {
  const root = "/home/echo/proj";
  assert.equal(normalizePath("/home/echo/proj/src/app.js", root), "src/app.js");
  assert.equal(normalizePath("/home/echo/proj/src/app.js", `${root}/`), "src/app.js");
  assert.equal(normalizePath("./src/app.js", root), "src/app.js");
  assert.equal(normalizePath("src//deep/./app.js", root), "src/deep/app.js");
  assert.equal(normalizePath("/home/echo/other/app.js", root), null);
  // A sibling folder that shares the root's prefix is still outside.
  assert.equal(normalizePath("/home/echo/project2/app.js", root), null);
  assert.equal(normalizePath(root, root), null);
  // POSIX matches the root exactly: another case is another folder.
  assert.equal(normalizePath("/home/Echo/proj/src/app.js", root), null);
  // An absolute path cannot be placed without a root.
  assert.equal(normalizePath("/home/echo/proj/src/app.js", ""), null);
});

test("paths that climb, are empty or carry control characters are refused", () => {
  assert.equal(normalizePath("../secrets.txt", "/p"), null);
  assert.equal(normalizePath("src/../../etc/passwd", "/p"), null);
  assert.equal(normalizePath("/p/src/../x.js", "/p"), null);
  assert.equal(normalizePath("", "/p"), null);
  assert.equal(normalizePath("   ", "/p"), null);
  assert.equal(normalizePath(".", "/p"), null);
  assert.equal(normalizePath(null, "/p"), null);
  assert.equal(normalizePath(42, "/p"), null);
  assert.equal(normalizePath("src/a\u0000b.js", "/p"), null);
  assert.equal(normalizePath(`src/${"x".repeat(500)}.js`, "/p"), null);
});

test("Windows paths match their root case-insensitively and come out with forward slashes", () => {
  const root = "C:\\Users\\Echo\\Proj";
  assert.equal(normalizePath("C:\\Users\\Echo\\Proj\\renderer\\idle.js", root), "renderer/idle.js");
  assert.equal(normalizePath("c:\\users\\echo\\proj\\renderer\\idle.js", root), "renderer/idle.js");
  assert.equal(normalizePath("C:/Users/Echo/Proj/scripts/eyes.mjs", root), "scripts/eyes.mjs");
  assert.equal(normalizePath("C:\\Users\\Echo\\Proj\\Scripts\\Eyes.mjs", "c:/users/echo/proj/"), "Scripts/Eyes.mjs");
  assert.equal(normalizePath("renderer\\idle.js", root), "renderer/idle.js");
  // Git Bash spells the drive as /c/.
  assert.equal(normalizePath("/c/Users/Echo/Proj/main.cjs", root), "main.cjs");
  assert.equal(normalizePath("D:\\Users\\Echo\\Proj\\main.cjs", root), null);
  assert.equal(normalizePath("C:\\Users\\Echo\\Other\\main.cjs", root), null);
  assert.equal(normalizePath("C:\\Users\\Echo\\Proj\\..\\Other\\main.cjs", root), null);
  // A drive root works too, and a UNC share.
  assert.equal(normalizePath("C:\\tools\\a.js", "C:\\"), "tools/a.js");
  assert.equal(normalizePath("\\\\server\\share\\proj\\lib\\a.js", "\\\\Server\\Share\\proj"), "lib/a.js");
  // Quotes a worker printed around a path are not part of it.
  assert.equal(normalizePath("\"C:\\Users\\Echo\\Proj\\main.cjs\"", root), "main.cjs");
});

test("ignored prefixes are never listed, at any case, and vendored folders at any depth", () => {
  for (const prefix of IGNORED) assert.equal(normalizePath(`${prefix}x.json`, "/p"), null, prefix);
  assert.equal(normalizePath("Data/eyes-tasks.json", "/p"), null);
  assert.equal(normalizePath("DIST/app/main.js", "/p"), null);
  assert.equal(normalizePath("data", "/p"), null);
  assert.equal(normalizePath("tools/logs/run.log", "/p"), null);
  assert.equal(normalizePath("website/node_modules/react/index.js", "/p"), null);
  assert.equal(normalizePath("vendor/lib/.git/config", "/p"), null);
  assert.equal(normalizePath("C:\\P\\data\\settings.json", "C:\\P"), null);
  // Only whole segments: these share a prefix's letters but are project files.
  assert.equal(normalizePath("database/schema.sql", "/p"), "database/schema.sql");
  assert.equal(normalizePath("distance.js", "/p"), "distance.js");
  assert.equal(normalizePath("tools/verify.mjs", "/p"), "tools/verify.mjs");
  assert.equal(normalizePath("builders/x.js", "/p"), "builders/x.js");
  // A caller may add its own prefixes.
  assert.equal(normalizePath("website/out/a.html", "/p", ["website/out"]), null);
  assert.equal(normalizePath("website/src/a.html", "/p", ["website/out/"]), "website/src/a.html");
});

test("an index entry is normalized, deduped and bounded, and an edit is not also a read", () => {
  const entry = indexEntry({
    taskId: "task_1", runId: "run_1", at: NOW, root: "/p",
    reads: ["/p/a/b.js", "a/b.js", "/p/a/c.js", "A/C.js", "data/x.json", "/elsewhere/z.js", "a/e.js"],
    edits: ["/p/a/e.js", { file: "x.js", files: ["x.js", "a/d.js"] }, "node_modules/k/index.js"],
    commands: 3,
  });
  assert.deepEqual(entry, { taskId: "task_1", runId: "run_1", at: NOW, reads: ["a/b.js", "a/c.js"], edits: ["a/e.js", "x.js", "a/d.js"], commands: 3 });
  assert.equal(indexEntry({ taskId: "t", commands: [{}, {}], edits: ["a.js"] }).commands, 2);
  assert.equal(indexEntry({ taskId: "t", reads: ["data/a.json"], edits: ["/outside/b.js"], root: "/p" }), null);
  assert.equal(indexEntry({ taskId: "t" }), null);
  const many = Array.from({ length: 450 }, (_, index) => `src/f${index}.js`);
  const big = indexEntry({ taskId: "t", reads: many, edits: many.slice(0, 250) });
  assert.equal(big.edits.length, 200);
  // The 250 edited files leave the read list even past the edit cap.
  assert.equal(big.reads.length, 200);
  assert.equal(big.reads[0], "src/f250.js");
});

test("the index parses JSONL, skips malformed rows and re-applies the rules to stored paths", () => {
  const text = [
    JSON.stringify({ taskId: "t1", runId: "r1", at: 1, reads: ["a.js"], edits: ["b.js"], commands: 2 }),
    "{not json",
    "",
    JSON.stringify(["an", "array"]),
    JSON.stringify({ taskId: "t2", note: "no file lists" }),
    JSON.stringify({ taskId: "t3", at: 3, reads: ["data/leak.json", "../up.js"], edits: ["/abs/c.js"] }),
    `${JSON.stringify({ taskId: "t4", at: 4, edits: ["src\\win.js"] })}\r`,
  ].join("\n");
  const rows = parseIndex(text);
  assert.deepEqual(rows.map((row) => row.taskId), ["t1", "t4"]);
  assert.deepEqual(rows[1].edits, ["src/win.js"]);
  assert.deepEqual(parseIndex(""), []);
  assert.deepEqual(parseIndex(null), []);
});

test("a file's system is the longest matching area, else its top folder, else root", () => {
  const areas = [
    { name: "Scripts", path: "scripts/", what: "host modules" },
    { name: "Agent loop", path: ".\\scripts\\agent", what: "the loop" },
    { name: "Main", path: "main.cjs", what: "the main process" },
    { name: "Scripts again", path: "scripts", what: "duplicate" },
    { name: "Nowhere", path: ".", what: "matches nothing" },
  ];
  assert.equal(systemKeyFor("scripts/eyes.mjs", areas), "scripts");
  assert.equal(systemKeyFor("scripts/agent/loop.cjs", areas), "scripts/agent");
  assert.equal(systemKeyFor("SCRIPTS/Agent/loop.cjs", areas), "scripts/agent");
  assert.equal(systemKeyFor("main.cjs", areas), "main.cjs");
  assert.equal(systemKeyFor("renderer/idle.js", areas), "renderer");
  assert.equal(systemKeyFor("README.md", areas), "root");
  assert.equal(systemKeyFor("renderer\\idle.js", []), "renderer");
  // A prefix of letters is not a prefix of folders.
  assert.equal(systemKeyFor("scriptsx/a.js", areas), "scriptsx");
  // An area's own id wins over its path.
  assert.equal(systemKeyFor("renderer/idle.js", [{ id: "ui", name: "UI", path: "renderer" }]), "ui");
  // Very large top folders split one level deeper, but not for their own files.
  assert.equal(systemKeyFor("tests/fixtures/a.json", [], { split: ["tests"] }), "tests/fixtures");
  assert.equal(systemKeyFor("tests/a.test.mjs", [], { split: ["tests"] }), "tests");
  assert.equal(systemKeyFor("data/x.json", areas), null);
});

const areas = [
  { name: "Renderer", path: "renderer/", what: "The app's views." },
  { name: "Host scripts", path: "scripts", what: "Main-process modules." },
  { name: "Docs", path: "docs/", what: "Long-form docs." },
];

function sampleIndex() {
  return [
    { taskId: "t_done", runId: "r1", at: NOW - 2 * HOUR, reads: ["renderer/nav.js"], edits: ["renderer/idle.js", "scripts/eyes.mjs"], commands: 1 },
    { taskId: "t_active", runId: "r2", at: NOW - HOUR, reads: ["scripts/backlog.cjs"], edits: ["renderer/idle.js", "scripts/assistant.mjs"], commands: 0 },
    { taskId: "t_open", runId: "r3", at: NOW - 3 * 24 * HOUR, reads: ["renderer/idle.js"], edits: ["tools/replay.mjs", "renderer/boot.js"], commands: 0 },
    { taskId: "t_archived", runId: "r4", at: NOW - 30 * HOUR, reads: [], edits: ["renderer/idle.js", "scripts/eyes.mjs"], commands: 0 },
    { taskId: "t_missing", runId: "r5", at: NOW - 10 * HOUR, reads: [], edits: ["main.cjs"], commands: 0 },
  ];
}
const sampleTasks = [
  { id: "t_done", status: "done", title: "Done work" },
  { id: "t_active", status: "awaiting_verification", title: "Checking" },
  { id: "t_open", status: "open", title: "Queued" },
  { id: "t_archived", status: "archived", title: "Old" },
];

test("systems come from areas first and folders otherwise, with files, heat and a task overlay", () => {
  const map = buildMap({ index: sampleIndex(), areas, tasks: sampleTasks, now: NOW });
  assert.equal(map.v, 1);
  assert.equal(map.builtAt, NOW);
  const byId = Object.fromEntries(map.systems.map((system) => [system.id, system]));
  assert.deepEqual(Object.keys(byId).sort(), ["docs", "renderer", "root", "scripts", "tools"]);

  const renderer = byId.renderer;
  assert.equal(renderer.name, "Renderer");
  assert.equal(renderer.path, "renderer/");
  assert.equal(renderer.what, "The app's views.");
  assert.equal(renderer.source, "area");
  assert.deepEqual(renderer.files.map((file) => [file.path, file.edits, file.reads]), [
    ["renderer/idle.js", 3, 1], ["renderer/boot.js", 1, 0], ["renderer/nav.js", 0, 1],
  ]);
  assert.equal(renderer.files[0].lastAt, NOW - HOUR);
  // Last 24 h only: idle.js edited twice (3 + 3) and nav.js read once (1).
  assert.equal(renderer.heat, 7);
  // done, awaiting_verification (active) and open count; archived does not.
  assert.deepEqual(renderer.tasks, { done: 1, active: 1, open: 1 });
  assert.deepEqual(renderer.taskIds, ["t_active", "t_done", "t_open"]);

  // "scripts" (no trailing slash) is the same area.
  assert.equal(byId.scripts.name, "Host scripts");
  assert.equal(byId.scripts.path, "scripts/");
  // A seeded area with no recorded files is still a system.
  assert.deepEqual(byId.docs.files, []);
  assert.equal(byId.docs.heat, 0);
  // Folder and root systems are named by their id until a model names them.
  assert.equal(byId.tools.name, "tools");
  assert.equal(byId.tools.path, "tools/");
  assert.equal(byId.tools.what, "");
  assert.equal(byId.tools.source, "folder");
  assert.equal(byId.root.path, "");
  assert.deepEqual(byId.root.files.map((file) => file.path), ["main.cjs"]);
  // A task that is not on the board does not count.
  assert.deepEqual(byId.root.tasks, { done: 0, active: 0, open: 0 });
  assert.deepEqual(byId.root.taskIds, []);
  // Hottest first; renderer and scripts tie on heat (7) and renderer has more edits.
  assert.equal(byId.scripts.heat, 7);
  assert.deepEqual(map.systems.slice(0, 2).map((system) => system.id), ["renderer", "scripts"]);
});

test("co-change links need two shared attempts and come strongest first", () => {
  const map = buildMap({ index: sampleIndex(), areas, tasks: sampleTasks, now: NOW });
  // renderer+scripts edited together three times; renderer+tools once.
  assert.deepEqual(map.links.map(({ a, b, weight }) => ({ a, b, weight })), [{ a: "renderer", b: "scripts", weight: 3 }]);
  assert.ok(map.links[0].strength > 0 && map.links[0].strength <= 1);

  // 15 systems edited together twice make 105 pairs; five of them a third time.
  const folders = Array.from({ length: 15 }, (_, index) => `m${String(index).padStart(2, "0")}`);
  const index = [
    { taskId: "a", at: NOW, reads: [], edits: folders.map((folder) => `${folder}/x.js`) },
    { taskId: "b", at: NOW, reads: [], edits: folders.map((folder) => `${folder}/y.js`) },
    { taskId: "c", at: NOW, reads: [], edits: folders.slice(0, 5).map((folder) => `${folder}/z.js`) },
    // Reads alone never link systems.
    { taskId: "d", at: NOW, reads: ["solo/a.js", "m00/a.js"], edits: [] },
    { taskId: "e", at: NOW, reads: ["solo/a.js", "m00/a.js"], edits: [] },
  ];
  const wide = buildMap({ index, now: NOW });
  assert.equal(wide.links.length, 80);
  assert.ok(wide.links.slice(0, 10).every((link) => link.weight === 3));
  assert.ok(wide.links.slice(10).every((link) => link.weight === 2));
  assert.ok(wide.links.every((link) => link.a < link.b));
  assert.ok(!wide.links.some((link) => link.a === "solo" || link.b === "solo"));

  // Links to a system dropped by the 80-system cap go with it.
  const crowd = [];
  for (let i = 0; i < 100; i += 1) {
    for (let k = 0; k < 2; k += 1) crowd.push({ taskId: `t${i}`, at: NOW, reads: [], edits: ["hub/x.js", `f${String(i).padStart(3, "0")}/y.js`] });
  }
  const capped = buildMap({ index: crowd, now: NOW });
  assert.equal(capped.systems.length, 80);
  const kept = new Set(capped.systems.map((system) => system.id));
  assert.ok(capped.links.every((link) => kept.has(link.a) && kept.has(link.b)));
});

test("files per system are capped at 60 and task ids at 50, newest first", () => {
  const index = [];
  for (let i = 0; i < 70; i += 1) index.push({ taskId: `t${i}`, at: NOW - (70 - i) * 1000, reads: [], edits: [`big/f${i}.js`] });
  // One file edited more than the rest leads the list.
  index.push({ taskId: "t_extra", at: NOW, reads: ["big/f5.js"], edits: ["big/f3.js"] });
  const tasks = [...index.map((row) => ({ id: row.taskId, status: "done" }))];
  const map = buildMap({ index, tasks, now: NOW });
  const big = map.systems.find((system) => system.id === "big");
  assert.equal(big.files.length, 60);
  assert.equal(big.files[0].path, "big/f3.js");
  assert.equal(big.files[0].edits, 2);
  assert.equal(big.taskIds.length, 50);
  assert.equal(big.taskIds[0], "t_extra");
  assert.equal(big.tasks.done, 71);
  assert.equal(big.edits, 71);
});

test("the map is rebuilt from raw rows too, and a previous map's model names carry over", () => {
  const raw = [{ taskId: "t", at: NOW, reads: ["data/x.json"], edits: ["C:\\abs\\y.js", "lib/z.js"] }];
  const map = buildMap({ index: raw, now: NOW });
  assert.deepEqual(map.systems.map((system) => system.id), ["lib"]);
  const previous = { systems: [{ id: "lib", name: "Library", what: "Shared helpers.", named: true }, { id: "docs", name: "Stale", named: true }] };
  const again = buildMap({ index: raw, areas: [{ name: "Docs", path: "docs/" }], now: NOW, previous });
  const lib = again.systems.find((system) => system.id === "lib");
  assert.equal(lib.name, "Library");
  assert.equal(lib.what, "Shared helpers.");
  assert.equal(lib.named, true);
  // An area's name comes from the area, whatever an old map said.
  assert.equal(again.systems.find((system) => system.id === "docs").name, "Docs");
  assert.deepEqual(buildMap({ now: NOW }), { v: 1, builtAt: NOW, systems: [], links: [], sources: { runs: 0, commits: 0 } });
});

test("relatedFor ranks explicit files over words and returns the top edited files", () => {
  const map = buildMap({ index: sampleIndex(), areas, tasks: sampleTasks, now: NOW });
  const byFile = relatedFor(map, { text: "Tidy the renderer", files: ["scripts/eyes.mjs"] });
  assert.equal(byFile.systems[0].id, "scripts");
  assert.deepEqual(byFile.systems[0], { id: "scripts", name: "Host scripts", path: "scripts/" });
  assert.equal(byFile.systems[1].id, "renderer");
  // Round-robin: each chosen system's top file before any second file.
  assert.deepEqual(byFile.hotFiles.slice(0, 2), ["scripts/eyes.mjs", "renderer/idle.js"]);
  assert.ok(byFile.hotFiles.every((file) => !file.endsWith("nav.js")), "read-only files are not hot");

  // Words match names, ids, path segments and file basenames.
  assert.deepEqual(relatedFor(map, { text: "The replay tool drops frames" }).systems.map((system) => system.id), ["tools"]);
  assert.deepEqual(relatedFor(map, { text: "the idle loop" }).systems.map((system) => system.id), ["renderer"]);
  assert.deepEqual(relatedFor(map, { text: "Update the docs" }).systems.map((system) => system.id), ["docs"]);
  // Short words and stopwords count for nothing.
  assert.deepEqual(relatedFor(map, { text: "fix the task so that it should work with this" }), { systems: [], hotFiles: [] });
  // A file under a system's path counts even when the map never saw it.
  assert.equal(relatedFor(map, { files: ["renderer/new-view.js"] }).systems[0].id, "renderer");
  assert.equal(relatedFor(map, { files: ["/p/scripts/new.cjs"], root: "/p" }).systems[0].id, "scripts");
  // Ignored files never steer a brief.
  assert.deepEqual(relatedFor(map, { files: ["data/eyes-tasks.json"] }).systems, []);
  assert.deepEqual(relatedFor(null, { text: "renderer" }), { systems: [], hotFiles: [] });
});

test("relatedFor honours its limit and caps hot files at 8", () => {
  const index = [];
  for (const folder of ["alpha", "bravo", "charlie", "delta"]) {
    for (let i = 0; i < 6; i += 1) index.push({ taskId: `${folder}${i}`, at: NOW, reads: [], edits: [`${folder}/file${i}.js`] });
  }
  const map = buildMap({ index, now: NOW });
  const related = relatedFor(map, { text: "alpha bravo charlie delta" });
  assert.equal(related.systems.length, 3);
  assert.equal(related.hotFiles.length, 8);
  assert.equal(relatedFor(map, { text: "alpha bravo charlie delta", limit: 1 }).systems.length, 1);
  const wide = relatedFor(map, { text: "alpha bravo charlie delta", limit: 4 });
  assert.equal(wide.systems.length, 4);
  // Two from each of four systems.
  assert.deepEqual(new Set(wide.hotFiles.map((file) => file.split("/")[0])).size, 4);
});

test("the brief line names systems and hot files and stays under 400 characters", () => {
  assert.equal(briefLine({ systems: [], hotFiles: ["a.js"] }), "");
  assert.equal(briefLine(null), "");
  assert.equal(
    briefLine({ systems: [{ id: "renderer", name: "Renderer", path: "renderer/" }, { id: "scripts", name: "Scripts", path: "scripts/" }], hotFiles: ["renderer/idle.js", "scripts/eyes.mjs"] }),
    "Related systems: Renderer (renderer/), Scripts (scripts/). Files agents changed most there: renderer/idle.js, scripts/eyes.mjs.",
  );
  assert.equal(briefLine({ systems: [{ id: "root", name: "root", path: "" }], hotFiles: [] }), "Related systems: root.");
  const long = briefLine({
    systems: [{ id: "a", name: "A", path: "a/" }],
    hotFiles: Array.from({ length: 8 }, (_, index) => `a/${"deep/".repeat(12)}file${index}.js`),
  });
  assert.ok(long.length <= 400, String(long.length));
  assert.match(long, /Files agents changed most there: a\/deep/);
  assert.ok(long.endsWith(".js."), "whole paths are dropped, never cut");
});

test("namePrompt asks only about unnamed systems, in a JSON-only contract", () => {
  const map = buildMap({ index: sampleIndex(), areas, tasks: sampleTasks, now: NOW });
  const prompt = namePrompt(map);
  assert.match(prompt.system, /ONLY JSON/);
  assert.match(prompt.system, /"names"/);
  assert.match(prompt.user, /id "tools"/);
  assert.match(prompt.user, /id "root", path \(project root\)/);
  assert.match(prompt.user, /tools\/replay\.mjs/);
  assert.doesNotMatch(prompt.user, /id "renderer"/);
  assert.match(prompt.user, /Already named/);
  const named = applyNames(map, '{"names":{"tools":{"name":"Tools","what":"Dev tools."},"root":{"name":"Root files","what":"Top level."}}}');
  assert.equal(namePrompt(named), null);
  assert.equal(namePrompt({ systems: [] }), null);
});

test("applyNames reads fenced or chatty replies, ignores unknown ids and clips", () => {
  const map = buildMap({ index: sampleIndex(), areas, tasks: sampleTasks, now: NOW });
  const reply = [
    "Sure! Here are the names:",
    "```json",
    JSON.stringify({ names: {
      tools: { name: `Tooling ${"x".repeat(80)}`, what: `Replay and verify scripts. ${"y".repeat(200)}` },
      root: "Top-level files",
      renderer: { name: "Should not rename an area" },
      ghost: { name: "Not a system" },
      empty: { name: "" },
    } }),
    "```",
    "Let me know if you need more.",
  ].join("\n");
  const named = applyNames(map, reply);
  const byId = Object.fromEntries(named.systems.map((system) => [system.id, system]));
  assert.equal(byId.tools.name.length, 40);
  assert.ok(byId.tools.name.startsWith("Tooling "));
  assert.equal(byId.tools.what.length, 120);
  assert.equal(byId.tools.named, true);
  assert.equal(byId.root.name, "Top-level files");
  assert.equal(byId.renderer.name, "Renderer");
  assert.equal(named.systems.length, map.systems.length);
  assert.ok(!("ghost" in byId));
  // The input map is untouched.
  assert.equal(map.systems.find((system) => system.id === "tools").name, "tools");

  // A bare mapping, the last object winning, and nonsense changing nothing.
  assert.equal(applyNames(map, '{"tools":{"name":"Bare"}}').systems.find((system) => system.id === "tools").name, "Bare");
  assert.equal(applyNames(map, '{"names":{"tools":{"name":"First"}}} then {"names":{"tools":{"name":"Last"}}}').systems.find((system) => system.id === "tools").name, "Last");
  const unchanged = applyNames(map, "no json here {broken");
  assert.deepEqual(unchanged, map);
  assert.notEqual(unchanged, map);
  assert.deepEqual(applyNames(null, "{}").systems, []);
});

test("git history reads as task-less edits, ignored folders and malformed blocks dropped", () => {
  const log = "\u001eabc1234def\t1700000000\nscripts/a.cjs\ndata/secret.json\n\n\u001enot-a-hash\t1\nx.js\n\u001edef5678abc\t1700000100\nrenderer/b.js\n";
  const rows = mapModule.parseGitLog(log);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].edits, ["scripts/a.cjs"]);
  assert.equal(rows[0].taskId, null);
  assert.equal(rows[0].at, 1700000000000);
  assert.deepEqual(mapModule.parseGitLog(""), []);
});

test("history and runs build one map; warmth halves weekly; a sweeping commit links nothing", () => {
  const day = 24 * 3600 * 1000;
  const history = [
    { taskId: null, at: NOW - 7 * day, edits: ["api/a.js", "web/b.js"] },
    { taskId: null, at: NOW - 7 * day, edits: ["api/a.js", "web/b.js"] },
    { taskId: null, at: NOW - 1000, edits: Array.from({ length: 25 }, (_, i) => `docs/p${i}.md`).concat(["api/a.js"]) },
  ];
  const index = [{ taskId: "t1", at: NOW - 1000, reads: [], edits: ["api/a.js"] }];
  const map = buildMap({ index, history, tasks: [{ id: "t1", status: "active" }], now: NOW });
  assert.deepEqual(map.sources, { runs: 1, commits: 3 });
  const api = map.systems.find((row) => row.id === "api");
  assert.equal(api.edits, 4);
  assert.equal(api.tasks.active, 1);
  assert.ok(api.warmth > 3 && api.warmth < 3 * 4, "a week-old edit counts half");
  assert.deepEqual(map.links.map((link) => [link.a, link.b]), [["api", "web"]], "the 26-file sweep is not a link");
  assert.equal(map.links[0].strength, 0.82, "cosine: 2 shared of api 3 and web 2");
});

test("present inventory adds new files and marks deleted history without losing work evidence", () => {
  const map = buildMap({
    history: [{ at: NOW - 1000, edits: ["game/world/old.lua", "game/world/core.lua"] }],
    inventory: ["game/world/core.lua", "game/world/new.lua", "data/private.json"],
    now: NOW,
  });
  const world = map.systems.find((row) => row.id === "game");
  assert.equal(world.fileCount, 2);
  assert.equal(world.historicalCount, 1);
  assert.equal(world.catalog.find((file) => file.path === "game/world/new.lua").present, true);
  assert.equal(world.catalog.find((file) => file.path === "game/world/old.lua").present, false);
  assert.deepEqual(map.sources, { runs: 0, commits: 1, present: 2 });
});

test("a large flat folder splits into the groups of files that change together, named by their shared word", () => {
  const files = (prefix, n) => Array.from({ length: n }, (_, i) => `scripts/${prefix}-${i}.cjs`);
  const executor = files("executor", 5);
  const brain = files("brain", 4);
  const loose = files("misc", 18);
  const history = [];
  for (let round = 0; round < 3; round += 1) {
    history.push({ taskId: null, at: NOW - round, edits: executor });
    history.push({ taskId: null, at: NOW - round, edits: brain });
  }
  for (const file of loose) history.push({ taskId: null, at: NOW, edits: [file] });
  const flat = buildMap({ history, now: NOW });
  assert.deepEqual(flat.systems.map((row) => row.id), ["scripts"], "without the option a folder stays one system");
  const grouped = buildMap({ history, now: NOW, cluster: {} });
  const byId = Object.fromEntries(grouped.systems.map((row) => [row.id, row]));
  assert.equal(byId["scripts/executor"].fileCount, 5);
  assert.equal(byId["scripts/executor"].name, "Executor");
  assert.equal(byId["scripts/executor"].source, "cluster");
  assert.equal(byId["scripts/executor"].parent, "scripts");
  assert.equal(byId["scripts/brain"].fileCount, 4);
  assert.equal(byId.scripts.fileCount, 18, "files with no partners stay in the folder");
  // An owner's area is never split, whatever its size.
  const area = buildMap({ history, now: NOW, cluster: {}, areas: [{ name: "Scripts", path: "scripts/" }] });
  assert.ok(area.systems.every((row) => row.source !== "cluster"));
  // Deterministic: the same input builds the same map.
  assert.deepEqual(buildMap({ history, now: NOW, cluster: {} }), grouped);
});
