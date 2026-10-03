import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { BOOKLET_INPUTS, build, parseBookletInputs, validateBookletInputs } from "../scripts/build-booklet.mjs";
import { audit } from "../scripts/auditor.mjs";
const { resolveBookletLocation } = createRequire(import.meta.url)("../scripts/booklet-source-location.cjs");
const inputs = () => ({ scripts: ["a.js", "b.js"], styles: ["a.css", "b.css"] });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "booklet-inputs-"));
  for (const directory of ["renderer", "data", "scripts"]) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, "renderer/booklet.template.html"), "<style>__BOOKLET_STYLES__</style>\n<script type=\"application/json\">__BOOKLET_DATA__</script>\n<script>\n__BOOKLET_CODE__\n</script>\n");
  await writeFile(path.join(root, "renderer/a.js"), "// first module\nconst a = 1;\n");
  await writeFile(path.join(root, "renderer/b.js"), "// second module\nthrow new Error('fixture boom');\n");
  await writeFile(path.join(root, "renderer/a.css"), ".a { color: red; }\n");
  await writeFile(path.join(root, "renderer/b.css"), ".b { color: blue; }\n");
  await writeFile(path.join(root, "data/models.json"), JSON.stringify({ models: [], hash: "fixture" }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(root, "main.cjs"), "");
  await writeFile(path.join(root, "preload.cjs"), "");
  return root;
}

test("the shipped inventory covers every script and stylesheet exactly once", async () => {
  const renderer = new URL("../renderer/", import.meta.url);
  const files = await readdir(renderer);
  for (const [kind, extension] of [["scripts", ".js"], ["styles", ".css"]]) {
    assert.deepEqual([...BOOKLET_INPUTS[kind]].sort(), files.filter((name) => name.endsWith(extension)).sort());
    assert.equal(new Set(BOOKLET_INPUTS[kind]).size, BOOKLET_INPUTS[kind].length);
    assert.ok(Object.isFrozen(BOOKLET_INPUTS[kind]));
  }
  const source = await readFile(new URL("../scripts/build-booklet.mjs", import.meta.url), "utf8");
  assert.deepEqual(parseBookletInputs(source), BOOKLET_INPUTS);
});

for (const kind of ["scripts", "styles"]) {
  test(`duplicate ${kind} are rejected before output changes`, async () => {
    const root = await fixture();
    try {
      const value = inputs(); await build({ root, inputs: value });
      const html = await readFile(path.join(root, "renderer/booklet.html"));
      const manifest = await readFile(path.join(root, "renderer/booklet.sources.json"));
      value[kind].push(value[kind][0]);
      await assert.rejects(build({ root, inputs: value }), /duplicate booklet/);
      assert.deepEqual(await readFile(path.join(root, "renderer/booklet.html")), html);
      assert.deepEqual(await readFile(path.join(root, "renderer/booklet.sources.json")), manifest);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test(`a missing ${kind} file retains the last complete output`, async () => {
    const root = await fixture();
    try {
      const value = inputs(); await build({ root, inputs: value });
      const html = await readFile(path.join(root, "renderer/booklet.html"));
      const manifest = await readFile(path.join(root, "renderer/booklet.sources.json"));
      await rm(path.join(root, "renderer", value[kind][0]));
      await assert.rejects(build({ root, inputs: value }), { code: "ENOENT" });
      assert.deepEqual(await readFile(path.join(root, "renderer/booklet.html")), html);
      assert.deepEqual(await readFile(path.join(root, "renderer/booklet.sources.json")), manifest);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("reordering sources keeps emission and error attribution coupled", async () => {
  const root = await fixture();
  try {
    const value = inputs(); value.scripts.reverse(); value.styles.reverse();
    await build({ root, inputs: value });
    const html = await readFile(path.join(root, "renderer/booklet.html"), "utf8");
    assert.ok(html.indexOf(".b {") < html.indexOf(".a {"));
    assert.ok(html.indexOf("// second module") < html.indexOf("// first module"));
    const manifest = JSON.parse(await readFile(path.join(root, "renderer/booklet.sources.json"), "utf8"));
    assert.deepEqual(manifest.segments.map((entry) => entry.source), ["renderer/b.js", "renderer/a.js"]);
    const line = html.slice(0, html.indexOf("throw new Error")).split("\n").length;
    const result = resolveBookletLocation(manifest, "file:///fixture/booklet.html", line, 9);
    assert.equal(result.source, "renderer/b.js:2");
    assert.equal(result.columnNumber, 9);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid and incomplete declarations are refused; legacy build sources remain supported", () => {
  for (const value of [null, {}, { scripts: [], styles: ["a.css"] }, { scripts: ["a.css"], styles: ["b.css"] }, { scripts: ["../a.js"], styles: ["b.css"] }]) {
    assert.throws(() => validateBookletInputs(value), /inventory|invalid/);
  }
  assert.throws(() => parseBookletInputs("export const BOOKLET_INPUTS = makeInputs();"), /malformed/);
  assert.equal(parseBookletInputs('readFile(path.join(RENDERER, "a.js"))'), null);
});

for (const scenario of ["valid foreign root", "omitted script", "omitted style", "missing declared file", "missing declared style", "duplicate script", "duplicate style", "malformed declaration", "legacy root"]) {
  test(`audit({root}) checks its own build inventory: ${scenario}`, async () => {
    const root = await fixture();
    try {
      const value = inputs();
      if (scenario === "omitted script") value.scripts.pop();
      if (scenario === "omitted style") value.styles.pop();
      if (scenario === "missing declared file") value.scripts.push("missing.js");
      if (scenario === "missing declared style") value.styles.push("missing.css");
      if (scenario === "duplicate script") value.scripts.push("a.js");
      if (scenario === "duplicate style") value.styles.push("a.css");
      let source = "throw new Error('Audited build must never execute');\nexport const BOOKLET_INPUTS = " + JSON.stringify(value) + ";";
      if (scenario === "malformed declaration") source = "export const BOOKLET_INPUTS = {broken};";
      if (scenario === "legacy root") source = ['a.js', 'b.js'].map((name) => `readFile(path.join(RENDERER, "${name}"));`).join("\n");
      await writeFile(path.join(root, "scripts/build-booklet.mjs"), source);
      const result = await audit({ root });
      const findings = result.findings.filter((finding) => finding.area === "build");
      if (["valid foreign root", "legacy root"].includes(scenario)) assert.deepEqual(findings, []);
      if (scenario === "omitted script") assert.ok(findings.some((finding) => /b\.js.*not inlined/.test(finding.message)));
      if (scenario === "omitted style") assert.ok(findings.some((finding) => /b\.css.*not inlined/.test(finding.message)));
      if (scenario === "missing declared file") assert.ok(findings.some((finding) => /missing\.js.*missing/.test(finding.message)));
      if (scenario === "missing declared style") assert.ok(findings.some((finding) => /missing\.css.*missing/.test(finding.message)));
      if (scenario.startsWith("duplicate")) assert.ok(findings.some((finding) => /duplicate booklet/.test(finding.message)));
      if (scenario === "malformed declaration") assert.ok(findings.some((finding) => /Invalid booklet input inventory/.test(finding.message)));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
