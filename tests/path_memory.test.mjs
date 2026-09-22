import test from "node:test";
import assert from "node:assert/strict";
import { PATH_LIMITS, areaOf, emptyOverseer, mergePaths, normalizeOverseer, overseerMerge, pathsForArea, relativeFile } from "../scripts/assistant.mjs";

const ROOT = "C:\\Users\\dev\\Studio";
const at = (n) => 1_700_000_000_000 + n * 60_000;

test("a path is remembered in one repository-relative form", () => {
  assert.equal(relativeFile("C:\\Users\\dev\\Studio\\scripts\\eyes.mjs", ROOT), "scripts/eyes.mjs");
  assert.equal(relativeFile("C:/Users/dev/Studio/scripts/eyes.mjs", ROOT), "scripts/eyes.mjs", "either separator, one row");
  assert.equal(relativeFile("scripts\\eyes.mjs"), "scripts/eyes.mjs");
  assert.equal(relativeFile("./scripts/eyes.mjs"), "scripts/eyes.mjs");
  assert.equal(relativeFile("c:/users/dev/studio/main.cjs", ROOT), "main.cjs", "the root match ignores case on Windows");
  assert.equal(relativeFile(""), "");
  assert.equal(relativeFile(null), "");
});

test("area is the top path segment, and a root file is its own area", () => {
  assert.equal(areaOf("scripts/eyes.mjs"), "scripts");
  assert.equal(areaOf("renderer/idle.js"), "renderer");
  assert.equal(areaOf("tests/fixtures/deep/a.mjs"), "tests");
  assert.equal(areaOf("main.cjs"), "main.cjs", "a file at the root has no directory to name it");
  assert.equal(areaOf(""), "");
});

test("a repeated file raises its hit count instead of duplicating", () => {
  let overseer = emptyOverseer();
  overseer = mergePaths(overseer, { changed: ["scripts/eyes.mjs"], root: ROOT }, at(1));
  overseer = mergePaths(overseer, { changed: ["scripts/eyes.mjs", "scripts/assistant.mjs"], root: ROOT }, at(2));
  overseer = mergePaths(overseer, { changed: ["C:\\Users\\dev\\Studio\\scripts\\eyes.mjs"], root: ROOT }, at(3));

  assert.equal(overseer.hotPaths.length, 2, "the same file reached three ways is one row");
  const [first, second] = overseer.hotPaths;
  assert.equal(first.file, "scripts/eyes.mjs");
  assert.equal(first.hits, 3);
  assert.equal(first.firstAt, at(1), "first sighting is kept");
  assert.equal(first.lastAt, at(3));
  assert.equal(second.file, "scripts/assistant.mjs");
  assert.equal(second.hits, 1);
});

test("hot rows sort by hits, then by recency", () => {
  let overseer = emptyOverseer();
  overseer = mergePaths(overseer, { changed: ["a/one.js", "b/two.js"] }, at(1));
  overseer = mergePaths(overseer, { changed: ["b/two.js"] }, at(2));
  overseer = mergePaths(overseer, { changed: ["c/three.js"] }, at(3));
  assert.deepEqual(overseer.hotPaths.map((row) => row.file), ["b/two.js", "c/three.js", "a/one.js"]);
});

test("a file that proves hot is dropped from cold, and never lands on both", () => {
  let overseer = emptyOverseer();
  overseer = mergePaths(overseer, { changed: ["scripts/eyes.mjs"], explored: ["renderer/idle.js", "docs/architecture.md"] }, at(1));
  assert.deepEqual(overseer.coldPaths.map((row) => row.file), ["renderer/idle.js", "docs/architecture.md"]);

  // The next verified attempt proves idle.js was the answer after all.
  overseer = mergePaths(overseer, { changed: ["renderer/idle.js"], explored: ["docs/architecture.md"] }, at(2));
  const hot = overseer.hotPaths.map((row) => row.file);
  const cold = overseer.coldPaths.map((row) => row.file);
  assert.ok(hot.includes("renderer/idle.js"), "evidence beats the earlier guess");
  assert.ok(!cold.includes("renderer/idle.js"), "the two lists must never disagree about one file");
  assert.equal(hot.filter((file) => cold.includes(file)).length, 0);
});

test("a file changed in the same attempt is never also recorded as cold", () => {
  const overseer = mergePaths(emptyOverseer(), { changed: ["scripts/eyes.mjs"], explored: ["scripts/eyes.mjs", "scripts/paths.cjs"] }, at(1));
  assert.deepEqual(overseer.hotPaths.map((row) => row.file), ["scripts/eyes.mjs"]);
  assert.deepEqual(overseer.coldPaths.map((row) => row.file), ["scripts/paths.cjs"]);
});

test("an attempt with nothing changed teaches nothing", () => {
  const seeded = mergePaths(emptyOverseer(), { changed: ["scripts/eyes.mjs"] }, at(1));
  const after = mergePaths(seeded, { changed: [], explored: ["renderer/idle.js"] }, at(2));
  assert.deepEqual(after.hotPaths, seeded.hotPaths, "an unverified or empty attempt is noise, not a lesson");
  assert.deepEqual(after.coldPaths, [], "and its read set must not become cold on its own");
});

test("both lists stay bounded however long the project runs", () => {
  let overseer = emptyOverseer();
  for (let i = 0; i < PATH_LIMITS.hot + PATH_LIMITS.cold + 40; i += 1) {
    overseer = mergePaths(overseer, { changed: [`area${i}/file${i}.js`], explored: [`cold${i}/file${i}.js`] }, at(i));
  }
  assert.equal(overseer.hotPaths.length, PATH_LIMITS.hot, "the board must not grow an unbounded store");
  assert.equal(overseer.coldPaths.length, PATH_LIMITS.cold);
});

test("the read side answers per area and caps what a prompt can carry", () => {
  let overseer = emptyOverseer();
  overseer = mergePaths(overseer, { changed: ["scripts/a.mjs", "scripts/b.mjs", "renderer/c.js"], explored: ["docs/d.md"] }, at(1));
  overseer = mergePaths(overseer, { changed: ["scripts/a.mjs"] }, at(2));

  const scripts = pathsForArea(overseer, "scripts");
  assert.deepEqual(scripts.hot.map((row) => row.file), ["scripts/a.mjs", "scripts/b.mjs"]);
  assert.equal(scripts.cold.length, 0, "docs is a different area");
  assert.deepEqual(pathsForArea(overseer, "renderer").hot.map((row) => row.file), ["renderer/c.js"]);
  assert.deepEqual(pathsForArea(overseer, "nothing-here").hot, [], "an unseen area returns nothing rather than guessing");
  assert.equal(pathsForArea(overseer, "scripts", 1).hot.length, 1, "the caller bounds what the prompt carries");
});

test("stored state round-trips through normalizeOverseer", () => {
  const merged = mergePaths(emptyOverseer(), { changed: ["scripts/a.mjs"], explored: ["docs/b.md"] }, at(1));
  const reloaded = normalizeOverseer(JSON.parse(JSON.stringify(merged)));
  assert.deepEqual(reloaded.hotPaths, merged.hotPaths);
  assert.deepEqual(reloaded.coldPaths, merged.coldPaths);
  // Playbooks written before this existed must still load.
  const legacy = normalizeOverseer({ reviews: 3, lessons: [{ text: "old", hits: 2 }] });
  assert.deepEqual(legacy.hotPaths, []);
  assert.deepEqual(legacy.coldPaths, []);
  assert.equal(legacy.lessons.length, 1, "the existing playbook is untouched");
  // A hand-edited store must not be able to inject a row without a file.
  assert.deepEqual(normalizeOverseer({ hotPaths: [{ area: "scripts" }, { file: "", hits: 9 }, "nope"] }).hotPaths, []);
});

test("overseerMerge keeps hotPaths/coldPaths", () => {
  // The overseer's review runs every 15 minutes and its result replaces the
  // stored playbook; path memory learned from a verified attempt in between
  // must survive it, or the next dispatch walks in knowing nothing.
  const learned = mergePaths(emptyOverseer(), { changed: ["scripts/a.mjs", "renderer/b.js"], explored: ["docs/c.md"] }, at(1));
  const review = { summary: "fair · builders reporting failures", score: 70, health: "fair", findings: [{ severity: "warn", title: "builders reporting failures", detail: "1 failed run" }], lessons: [] };
  const merged = overseerMerge(learned, review, at(2));
  assert.deepEqual(merged.hotPaths, learned.hotPaths);
  assert.deepEqual(merged.coldPaths, learned.coldPaths);
  assert.equal(merged.reviews, learned.reviews + 1, "the review itself still landed");
  const twice = overseerMerge(merged, review, at(3));
  assert.deepEqual(pathsForArea(twice, "scripts").hot.map((row) => row.file), ["scripts/a.mjs"], "and a second review does not wipe them either");
  assert.deepEqual(normalizeOverseer(JSON.parse(JSON.stringify(twice))).coldPaths, learned.coldPaths, "the stored form carries them");
});
