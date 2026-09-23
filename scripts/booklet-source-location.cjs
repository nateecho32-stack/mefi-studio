"use strict";

// Maps a console-message source location inside the generated, self-contained
// renderer/booklet.html back to the original `renderer/<file>:<line>`.
//
// The build concatenates the renderer scripts into a single inline `<script>`
// block (`scripts/build-booklet.mjs`), so Chromium reports every runtime error
// against booklet.html and a bundle-absolute line, not the module that threw.
// `buildBookletSourceManifest` records where each concatenated segment starts so
// `resolveBookletLocation` can name the real assignment. Bundler line numbers are
// 1-based (verified against Electron 44's `console-message`); the manifest is
// produced from the same final html, so no 0/1-based guess is needed.

function countLines(text) {
  // 1-based line count; a trailing newline yields a final empty line, which is
  // exactly how the "\n" join separator advances the next segment's start line.
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

// `sources` is the ordered emit list: [{ source: "renderer/explorer.js", content }].
// `code` is the joined bundle and `html` the generated booklet; the manifest's
// start lines are 1-based positions inside `html`.
function buildBookletSourceManifest(html, code, sources) {
  const codeStart = html.indexOf(code);
  if (codeStart < 0) throw new Error("the concatenated booklet code was not found in the generated html");
  const codeStartLine = countLines(html.slice(0, codeStart));
  const segments = [];
  let line = codeStartLine;
  for (const entry of sources) {
    segments.push({ source: entry.source, startLine: line });
    line += countLines(entry.content);
  }
  return { file: "renderer/booklet.html", codeStartLine, segments };
}

function isBookletSource(sourceId) {
  if (!sourceId) return false;
  return /(?:^|[/\\])booklet\.html(?:[?#]|$)/.test(String(sourceId));
}

// Returns the raw bundle coordinates unchanged plus, when they belong to a
// segment of the generated booklet, `source`/`file`/`fileLine` naming the
// original renderer module. Unmappable locations keep a null `source` so the
// caller falls back to the raw `sourceId:line:column`.
function resolveBookletLocation(manifest, sourceId, lineNumber, columnNumber) {
  const result = {
    sourceId: sourceId ?? null,
    lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
    columnNumber: Number.isFinite(columnNumber) ? columnNumber : null,
    source: null,
    file: null,
    fileLine: null,
  };
  const segments = manifest && Array.isArray(manifest.segments) ? manifest.segments : null;
  if (!segments || segments.length === 0 || result.lineNumber === null) return result;
  if (!isBookletSource(result.sourceId)) return result;
  if (Number.isFinite(manifest.codeStartLine) && result.lineNumber < manifest.codeStartLine) return result;
  let match = null;
  for (const segment of segments) {
    if (segment.startLine <= result.lineNumber) match = segment;
    else break;
  }
  if (!match) return result;
  result.file = match.source;
  result.fileLine = result.lineNumber - match.startLine + 1;
  result.source = `${match.source}:${result.fileLine}`;
  return result;
}

module.exports = { buildBookletSourceManifest, resolveBookletLocation, countLines };
