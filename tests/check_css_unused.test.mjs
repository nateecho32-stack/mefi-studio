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

test("findUnusedSelectors: classes composed by template-literal interpolation stay alive", () => {
  const css = ".music-effect-orbitTrails::before { content: \"\"; }";
  const usage = 'element("label", `music-effect ${effectClass}`, null, effects);';
  const hits = findUnusedSelectors(css, usage);
  assert.deepEqual(hits, [], `dynamic composition must not flag live classes: ${JSON.stringify(hits)}`);
});

test("findUnusedSelectors: interpolation prefixes do not revive classes outside their family", () => {
  const css = ".totally-dead { color: red; }";
  const usage = 'element("label", `music-effect ${effectClass}`);';
  const hits = findUnusedSelectors(css, usage);
  assert.deepEqual(hits.map((hit) => hit.missing), [["totally-dead"]]);
});

test("findUnusedSelectors: a literal ending in a hyphen before the interpolation still forms its family", () => {
  const css = ".music-preview-orbs i { background: gold; }";
  const usage = 'const preview = element("span", `music-node-preview music-preview-${key}`, null, choice);';
  const hits = findUnusedSelectors(css, usage);
  assert.deepEqual(hits, [], `hyphen-ended interpolation must not flag live classes: ${JSON.stringify(hits)}`);
});

test("findUnusedSelectors: a hyphen-ended interpolation does not revive neighbouring families", () => {
  const css = ".music-previewz-dead { color: red; }";
  const usage = 'const preview = element("span", `music-node-preview music-preview-${key}`, null, choice);';
  const hits = findUnusedSelectors(css, usage);
  assert.deepEqual(hits.map((hit) => hit.missing), [["music-previewz-dead"]]);
});

test("findUnusedSelectors: a prefix only counts when it touches an interpolation", () => {
  const css = ".music-effect-orbitTrails { color: red; }";
  const usage = 'element("label", "music-effect", null, effects);';
  const hits = findUnusedSelectors(css, usage);
  assert.equal(hits.length, 1, "a plain string near no interpolation composes nothing");
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

test("CLI --unused: the generated booklet artifact cannot keep a class alive from the usage corpus", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "check-css-booklet-"));
  try {
    const sheet = path.join(dir, "sheet.css");
    await writeFile(sheet, ".used { color: red; }\n.artifact-only { color: blue; }\n");
    await writeFile(path.join(dir, "page.html"), '<div class="used"></div>');
    await writeFile(
      path.join(dir, "booklet.html"),
      '<style>.artifact-only { color: blue; }</style>\n<div class="used artifact-only"></div>'
    );

    const res = await execFileP(process.execPath, [CLI, "--unused", "sheet.css"], { cwd: dir }).catch((err) => err);
    assert.equal(res.code, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /UNUSED-SELECTOR sheet\.css:2: \.artifact-only \(missing artifact-only\)/);
    assert.doesNotMatch(res.stdout, /\.used/, "a class used by a real sibling page must stay alive");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI --unused: default mode scans every renderer stylesheet and stays clean on this tree", async () => {
  const res = await execFileP(process.execPath, [CLI, "--unused"], { cwd: STUDIO }).catch((err) => err);
  assert.equal(res.code ?? 0, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ALL-SELECTORS-USED/);
});
