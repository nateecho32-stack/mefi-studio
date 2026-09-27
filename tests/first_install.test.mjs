// What a fresh clone's `npm ci` must do.
// Electron 44 stopped downloading its binary on install, and every Electron
// render suite skips itself when node_modules/electron/dist has no binary, so
// an install that lost the binary turned those suites green without running
// them. And npm only warns when package.json's engines do not match, so an old
// Node installed anyway.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("npm ci stops on a Node older than package.json's engines", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.engines.node, ">=24");
  const settings = (await read(".npmrc")).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[#;]/.test(line));
  assert.deepEqual(settings, ["engine-strict=true"], "engine-strict turns npm's warning into an error; the tracked .npmrc holds nothing else, credentials least of all");
});

test("npm ci's postinstall fetches the Electron binary", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts.postinstall, "node scripts/fetch-electron.mjs");
});

