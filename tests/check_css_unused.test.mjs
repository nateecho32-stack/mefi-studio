import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findUnusedSelectors } from "../scripts/check-css.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(STUDIO, "scripts", "check-css.mjs");
const execFileP = promisify(execFile);

const SHEET = `:root { --ink: #111; }
.used { color: red; }
.orphan { color: blue; }
.multi .half { margin: 0; }
@media (min-width: 40em) { .mmedia { color: green; } }
@keyframes spin { from { opacity: 0; } to { opacity: 1; } }
`;

const USAGE = [
  '<div class="used"></div>',
  'el.classList.add("half");',
  ".theme .mmedia { color: green; }",
  ""
].join("\n");

test("findUnusedSelectors: flags winner-bearing selectors whose classes appear in no usage", () => {
  const hits = findUnusedSelectors(SHEET, USAGE);
  assert.deepEqual(hits.map((hit) => hit.selector), [".orphan", ".multi .half"]);
  assert.deepEqual(hits[0].missing, ["orphan"]);
  assert.deepEqual(hits[1].missing, ["multi"]);
});

test("findUnusedSelectors: usage in html, js and sibling css all count", () => {
  for (const [kind, usage] of [
    ["html", '<p class="orphan">hi</p>'],
    ["js", 'node.classList.toggle("orphan")'],
    ["css", ".other .orphan { color: blue; }"]
  ]) {
    const hits = findUnusedSelectors(SHEET, usage);
    assert.ok(hits.every((hit) => hit.selector !== ".orphan"), `${kind} usage should keep .orphan alive`);
  }
});

test("findUnusedSelectors: a rule with no declarations carries no winner keys and is not flagged", () => {
  const css = ".ghost { }";
  assert.equal(findUnusedSelectors(css, "").length, 0);
});

test("findUnusedSelectors: @keyframes internals are not selector candidates", () => {
  assert.equal(findUnusedSelectors("@keyframes spin { from { opacity: 0; } to { opacity: 1; } }", "").length, 0);
});

test("findUnusedSelectors: @media context rules are still scanned and report their line", () => {
  const hits = findUnusedSelectors(SHEET, "");
  const mmedia = hits.find((hit) => hit.selector === ".mmedia");
  assert.ok(mmedia, ".mmedia inside @media should be scanned");
  assert.equal(mmedia.line, 5);
  const orphan = hits.find((hit) => hit.selector === ".orphan");
  assert.equal(orphan.line, 3);
});

test("findUnusedSelectors: --allow list keeps a documented class out of the report", () => {
  const hits = findUnusedSelectors(SHEET, USAGE, { allow: ["orphan"] });
  assert.deepEqual(hits.map((hit) => hit.selector), [".multi .half"]);
});

test("findUnusedSelectors: comments in the stylesheet do not create usage", () => {
  const css = "/* .orphan is documented */\n.orphan { color: blue; }";
  const hits = findUnusedSelectors(css, css);
  assert.equal(hits.length, 0, "token usage includes the sheet's own comment text, keeping it conservative");
});

test("CLI --unused: unused class exits 1 with UNUSED-SELECTOR lines; usage from siblings exits 0", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "check-css-unused-"));
  try {
    const sheet = path.join(dir, "sheet.css");
    await writeFile(sheet, ".used { color: red; }\n.orphan { color: blue; }\n");
    await writeFile(path.join(dir, "page.html"), '<div class="used"></div>');

    const dead = await execFileP(process.execPath, [CLI, "--unused", "sheet.css"], { cwd: dir }).catch((err) => err);
    assert.equal(dead.code, 1);
    assert.match(dead.stdout, /UNUSED-SELECTOR sheet\.css:2: \.orphan \(missing orphan\)/);
    assert.match(dead.stdout, /UNUSED-SELECTORS: 1 winner-bearing selector/);

    await writeFile(path.join(dir, "app.js"), 'el.classList.add("orphan");');
    const alive = await execFileP(process.execPath, [CLI, "--unused", "sheet.css"], { cwd: dir });
    assert.match(alive.stdout, /ALL-SELECTORS-USED: every class selector appears in renderer html\/js\/css usage \(1 stylesheet\(s\)\)/);

    await rm(path.join(dir, "app.js"));
    const allowed = await execFileP(process.execPath, [CLI, "--unused", "--allow", "orphan", "sheet.css"], { cwd: dir });
    assert.match(allowed.stdout, /ALL-SELECTORS-USED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI --unused: default mode scans every renderer stylesheet and stays clean on this tree", async () => {
  const res = await execFileP(process.execPath, [CLI, "--unused"], { cwd: STUDIO }).catch((err) => err);
  assert.equal(res.code ?? 0, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ALL-SELECTORS-USED/);
});
