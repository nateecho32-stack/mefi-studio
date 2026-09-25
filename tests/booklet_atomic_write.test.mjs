import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { classifyPath } from "../scripts/updater.mjs";

const source = await readFile(new URL("../scripts/build-booklet.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function writeBuildFile(");
const end = source.indexOf("export async function build(", start);
assert.ok(start >= 0 && end > start);

function writer({ denyRenames = 0, code = "EPERM", failCleanup = false } = {}) {
  const files = new Map([["renderer/booklet.html", "previous complete output"]]);
  const writes = [], delays = [];
  let renames = 0;
  const failure = Object.assign(new Error("fixture rename refused"), { code, path: "fixture-temp", dest: "renderer/booklet.html" });
  const env = vm.createContext({
    process: { pid: 42, platform: "win32" }, randomUUID: () => `writer-${writes.length}`,
    async open(file, flag) {
      assert.equal(flag, "wx", "a build exclusively owns its temporary output");
      assert.equal(classifyPath(file), "ignore", "the temporary file cannot trigger another live update");
      assert.equal(files.has(file), false);
      files.set(file, ""); writes.push(file);
      return { async writeFile(content) { files.set(file, content); }, async close() {} };
    },
    async rename(from, to) {
      renames += 1;
      if (renames <= denyRenames) throw failure;
      assert.ok(files.has(from));
      files.set(to, files.get(from)); files.delete(from);
    },
    async rm(file) {
      if (failCleanup) throw new Error("fixture cleanup refused");
      files.delete(file);
    },
    setTimeout(callback, delay) { delays.push(delay); callback(); },
  });
  vm.runInContext(source.slice(start, end), env);
  return { env, files, writes, delays, failure, renames: () => renames };
}

test("overlapping output writers keep independent complete bytes, including within one process", async () => {
  const h = writer();
  await Promise.all([
    h.env.writeBuildFile("renderer/booklet.html", "first complete output"),
    h.env.writeBuildFile("renderer/booklet.html", "second complete output"),
  ]);
  assert.equal(new Set(h.writes).size, 2);
  assert.equal(h.files.get("renderer/booklet.html"), "second complete output");
  assert.equal(h.files.size, 1);
});

test("a brief Windows destination lock retries the atomic rename", async () => {
  const h = writer({ denyRenames: 2 });
  await h.env.writeBuildFile("renderer/booklet.html", "replacement");
  assert.equal(h.renames(), 3);
  assert.deepEqual(h.delays, [20, 40]);
  assert.equal(h.files.get("renderer/booklet.html"), "replacement");
  assert.equal(h.files.size, 1);
});

test("a persistent destination lock leaves the previous output and its original error intact", async () => {
  const h = writer({ denyRenames: Infinity });
  await assert.rejects(h.env.writeBuildFile("renderer/booklet.html", "replacement"), (error) => error === h.failure);
  assert.equal(h.renames(), 5, "lock retries are bounded");
  assert.equal(h.files.get("renderer/booklet.html"), "previous complete output");
  assert.equal(h.files.size, 1, "only this attempt's temporary file is cleaned up");
});

test("non-lock errors are not retried or masked by a cleanup failure", async () => {
  const h = writer({ denyRenames: Infinity, code: "ENOSPC", failCleanup: true });
  await assert.rejects(h.env.writeBuildFile("renderer/booklet.html", "replacement"), (error) => error === h.failure);
  assert.equal(h.renames(), 1);
  assert.equal(h.files.get("renderer/booklet.html"), "previous complete output");
});
