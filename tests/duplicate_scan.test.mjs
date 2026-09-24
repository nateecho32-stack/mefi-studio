// The watcher's duplicate-declaration scan keeps each file's findings while
// the file's size and modification time hold.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { duplicateDeclarations, scanDuplicateDeclarations } from "../scripts/eyes.mjs";

test("repeat scans report the same findings, and an edited or removed file is read again", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "studio-duplicate-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const doubled = path.join(root, "doubled.mjs"), clean = path.join(root, "clean.cjs"), other = path.join(root, "notes.md");
  await writeFile(doubled, "function alpha() {}\nconst beta = 1;\nfunction alpha() {}\n");
  await writeFile(clean, "function gamma() {}\n");
  await writeFile(other, "function alpha() {}\nfunction alpha() {}\n");
  const files = [doubled, clean, other, path.join(root, "missing.js")];
  const first = await scanDuplicateDeclarations(files);
  assert.deepEqual(first, [{ file: doubled, duplicates: [{ name: "alpha", lines: [1, 3] }] }]);
  first[0].duplicates[0].lines.push(99);
  assert.deepEqual(await scanDuplicateDeclarations(files), [{ file: doubled, duplicates: duplicateDeclarations("function alpha() {}\nconst beta = 1;\nfunction alpha() {}\n") }], "a cached finding is handed out as a copy");

  // The same size under a new modification time is still read again.
  await writeFile(clean, "function gamma() {}\nfunction gamma() {}\n");
  await writeFile(doubled, "function alpha() {}\nconst beta = 1;\nfunction delta() {}\n");
  await utimes(doubled, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(await scanDuplicateDeclarations(files), [{ file: clean, duplicates: [{ name: "gamma", lines: [1, 2] }] }]);
  await rm(clean);
  assert.deepEqual(await scanDuplicateDeclarations(files), []);
});
