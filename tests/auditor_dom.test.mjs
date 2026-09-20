// The auditor's DOM check must not false-positive on renderer-built ids:
// nav.js assigns `more.id = "cmd-more-tools"` at runtime and later looks the
// id up, so the id register has to include `.id = "..."` assignments as well
// as template attributes — while a genuinely missing id must still be flagged.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { audit } from "../scripts/auditor.mjs";

async function fixtureStudio({ script, template }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditor-dom-"));
  await mkdir(path.join(root, "renderer"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "renderer", "nav.js"), script);
  await writeFile(path.join(root, "renderer", "booklet.template.html"), template);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: {} }));
  await writeFile(path.join(root, "main.cjs"), "");
  await writeFile(path.join(root, "preload.cjs"), "");
  await writeFile(path.join(root, "scripts", "build-booklet.mjs"), "");
  return root;
}

async function domFindings(fixture) {
  const root = await fixtureStudio(fixture);
  try {
    const result = await audit({ root });
    return result.findings.filter((finding) => finding.area === "dom");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a runtime-assigned id that is later looked up is not a false positive", async () => {
  const findings = await domFindings({
    script: [
      'const more = document.createElement("details");',
      'more.id = "cmd-more-tools";',
      "const quoted = document.createElement('div');",
      "quoted.id = 'cmd-single-quoted';",
      'const existing = document.getElementById("cmd-more-tools");',
      'const other = document.getElementById("cmd-single-quoted");',
    ].join("\n"),
    template: '<div id="cmd-dock"></div>',
  });
  assert.deepEqual(findings, [], "an id built by renderer code must satisfy its own lookup");
});

test("a lookup with no template id and no runtime assignment is still flagged", async () => {
  const findings = await domFindings({
    script: 'const ghost = document.getElementById("ghost-panel");',
    template: '<div id="cmd-dock"></div>',
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /#ghost-panel/);
  assert.equal(findings[0].level, "error");
});

test("single-quoted getElementById lookups are audited too", async () => {
  const findings = await domFindings({
    script: "const ghost = document.getElementById('ghost-panel');",
    template: '<div id="cmd-dock"></div>',
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /#ghost-panel/);
});

test("querySelector id lookups are audited; dynamic selectors are skipped", async () => {
  const findings = await domFindings({
    script: [
      'document.querySelector("#ghost-panel").remove();',
      'document.querySelectorAll("#other-ghost, #cmd-dock").forEach(() => {});',
      "const section = document.querySelector(`#tab-${name}`);",
    ].join("\n"),
    template: '<div id="cmd-dock"></div>',
  });
  const messages = findings.map((finding) => finding.message);
  assert.equal(messages.length, 2, messages.join("; "));
  assert.ok(messages.some((message) => message.includes("#ghost-panel")));
  assert.ok(messages.some((message) => message.includes("#other-ghost")));
});
