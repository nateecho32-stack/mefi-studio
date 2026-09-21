"use strict";
// Project folder containment, shared by the project facade (scripts/projects.cjs)
// and the store reader (scripts/eyes.mjs) so both scope OpenCode sessions to a
// folder with one rule: case-insensitive on Windows, separator-agnostic, and a
// sibling folder that merely shares a prefix ("app-neighbor" beside "app")
// never counts as inside.
const path = require("node:path");

function pathKey(value) {
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function containsPath(root, value) {
  if (!value) return false;
  const relative = path.relative(pathKey(root), pathKey(value));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

module.exports = { pathKey, containsPath };
