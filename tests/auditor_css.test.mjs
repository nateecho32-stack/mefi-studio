// renderer/booklet.html is a generated artifact: build-booklet.mjs bakes a copy
// of every stylesheet and script into it. Counting that copy as live usage let a
// stale baked class mask a selector already dropped from its real source, so the
// orphan check only fired during the rebuild window. These fixtures pin both
// directions of the exclusion: a class named only by the baked booklet is still
// an orphan, while classes used by the template or a renderer script stay live.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { audit } from "../scripts/auditor.mjs";

async function fixtureStudio({ sheets = {}, scripts = {}, template = "", booklet = null }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditor-css-"));
  for (const dir of ["renderer", "scripts"]) await mkdir(path.join(root, dir), { recursive: true });
  for (const [name, text] of Object.entries(sheets)) await writeFile(path.join(root, "renderer", name), text);
  for (const [name, text] of Object.entries(scripts)) await writeFile(path.join(root, "renderer", name), text);
  await writeFile(path.join(root, "renderer", "booklet.template.html"), template);
  if (booklet !== null) await writeFile(path.join(root, "renderer", "booklet.html"), booklet);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: {} }));
  await writeFile(path.join(root, "main.cjs"), "");
  await writeFile(path.join(root, "preload.cjs"), "");
  await writeFile(path.join(root, "scripts", "build-booklet.mjs"), "");
  return root;
}

async function cssFindings(fixture) {
  const root = await fixtureStudio(fixture);
  try {
    const result = await audit({ root });
    return result.findings.filter((finding) => finding.area === "css");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a class kept alive only by the baked booklet.html is reported as an orphan", async () => {
  const findings = await cssFindings({
    sheets: { "styles.css": ".used { color: red; }\n.orphan { color: blue; }\n" },
    scripts: { "app.js": 'el.classList.add("used");' },
    template: '<div class="used"></div>',
    booklet: '<style>.orphan { color: blue; }</style><div class="orphan"></div>',
  });
  const messages = findings.map((finding) => finding.message).join("\n");
  assert.match(messages, /selector "\.orphan"/, "the artifact's stale class must not count as usage");
  assert.doesNotMatch(messages, /selector "\.used"/, "a class used by a real source stays live");
});

test("classes used by the template and renderer scripts still count as live", async () => {
  const findings = await cssFindings({
    sheets: { "styles.css": ".template-only { color: red; }\n.script-only { color: blue; }\n" },
    scripts: { "app.js": 'el.classList.add("script-only");' },
    template: '<div class="template-only"></div>',
  });
  assert.deepEqual(findings, [], `remaining sources must keep their classes: ${JSON.stringify(findings)}`);
});
