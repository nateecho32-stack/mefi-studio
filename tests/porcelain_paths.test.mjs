// Git C-quotes status paths that hold spaces, quotes or non-ASCII bytes, and
// quotes each side of a rename on its own. parsePorcelain must hand back the
// real file names, or uncommittedOnly and the staged-index warnings match
// nothing (or name files that do not exist).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parsePorcelain, unquoteGitPath } from "../scripts/eyes.mjs";

const mcp = createRequire(import.meta.url)("../scripts/agent-mcp.cjs");

test("quoted, octal-escaped and renamed status paths come back as real names", () => {
  const rows = parsePorcelain([
    'A  "caf\\303\\251.js"',
    'R  "old name.js" -> "new name.js"',
    'R  plain.js -> "spaced name.js"',
    "M  src/plain.js",
    '?? "tab\\there.txt"',
  ].join("\n"));
  assert.deepEqual(rows.map((row) => [row.path, row.orig]), [
    ["café.js", null],
    ["new name.js", "old name.js"],
    ["spaced name.js", "plain.js"],
    ["src/plain.js", null],
    ["tab\there.txt", null],
  ]);
  assert.equal(unquoteGitPath('"say \\"hi\\".js"'), 'say "hi".js');
  assert.equal(unquoteGitPath("unquoted.js"), "unquoted.js");
});

test("an MCP command that is a Windows batch shim is found for the cmd.exe route; an .exe is not", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-shim-"));
  try {
    writeFileSync(path.join(dir, "tool.cmd"), "@echo off\r\n");
    writeFileSync(path.join(dir, "both.cmd"), "@echo off\r\n");
    writeFileSync(path.join(dir, "both.exe"), "");
    const env = { PATH: dir };
    assert.equal(mcp.windowsShim("tool", env, "win32"), path.win32.join(dir, "tool.cmd"));
    assert.equal(mcp.windowsShim("both", env, "win32"), null, "an .exe in the same folder wins, as PATHEXT orders it");
    assert.equal(mcp.windowsShim("C:/x/run.bat", env, "win32"), "C:/x/run.bat");
    assert.equal(mcp.windowsShim("tool", env, "linux"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
