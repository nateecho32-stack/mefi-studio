// The renderer ships as one concatenated <script>, so a runtime error reports
// booklet.html with a bundle-absolute line. This covers the translation back to
// renderer/<file>:<line> that the perf-render fixture now attaches to captured
// errors: the boundary (first bundle line), a mid-bundle assignment, and the
// fallbacks for out-of-bundle or foreign-source coordinates.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildBookletSourceManifest, resolveBookletLocation } =
  require("../scripts/booklet-source-location.cjs");

const SOURCES = [
  { source: "renderer/a.js", content: "const a = 1;\nconst b = 2;" },
  { source: "renderer/b.js", content: "// b line 1\nthrow new Error('boom');" },
];

function fixture() {
  const code = SOURCES.map((entry) => entry.content).join("\n");
  // Mirrors renderer/booklet.template.html: `<script>__BOOKLET_CODE__</script>`.
  const html = `<!doctype html>\n<html>\n<script>${code}</script>\n</html>\n`;
  return { manifest: buildBookletSourceManifest(html, code, SOURCES), code };
}

test("bundle coordinates resolve to the renderer file and line", () => {
  const { manifest } = fixture();
  // Lines: 3 = a.js:1, 4 = a.js:2, 5 = b.js:1, 6 = b.js:2.
  assert.equal(manifest.codeStartLine, 3);

  const assignment = resolveBookletLocation(manifest, "file:///app/renderer/booklet.html", 6, 7);
  assert.equal(assignment.source, "renderer/b.js:2");
  assert.equal(assignment.file, "renderer/b.js");
  assert.equal(assignment.fileLine, 2);
  assert.equal(assignment.sourceId, "file:///app/renderer/booklet.html", "raw fields are preserved");
  assert.equal(assignment.lineNumber, 6);
  assert.equal(assignment.columnNumber, 7);
});

test("the first bundle line is a boundary, not an off-by-one", () => {
  const { manifest } = fixture();
  assert.equal(resolveBookletLocation(manifest, "renderer/booklet.html", 3, 1).source, "renderer/a.js:1");
  assert.equal(resolveBookletLocation(manifest, "renderer/booklet.html", 5, 1).source, "renderer/b.js:1");
});

test("unmappable coordinates keep a null source so the bundle fallback survives", () => {
  const { manifest } = fixture();
  // Before the bundle starts.
  assert.equal(resolveBookletLocation(manifest, "file:///app/renderer/booklet.html", 2, 1).source, null);
  // A different document raised it.
  assert.equal(resolveBookletLocation(manifest, "file:///app/renderer/other.js", 6, 1).source, null);
  // Missing or malformed inputs never throw, only decline to map.
  assert.equal(resolveBookletLocation(null, "file:///app/renderer/booklet.html", 6, 1).source, null);
  assert.equal(resolveBookletLocation(manifest, "file:///app/renderer/booklet.html", null, null).source, null);
  assert.deepEqual(
    resolveBookletLocation(manifest, "file:///app/renderer/booklet.html", 2, 1),
    { sourceId: "file:///app/renderer/booklet.html", lineNumber: 2, columnNumber: 1, source: null, file: null, fileLine: null }
  );
});
