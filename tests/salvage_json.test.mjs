// main.cjs salvageJson recovers what it can from a torn store file, and
// eyes.mjs writePins lands atomically. salvageJson is sliced out of the real
// main.cjs text, so the shipped code, not a copy, is what runs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { writePins, readPins } from "../scripts/eyes.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const start = source.indexOf("function salvageJson(text, fallback) {");
const end = source.indexOf("\n}\n", start);
assert.ok(start >= 0 && end > start, "main.cjs still defines salvageJson(text, fallback)");
const env = vm.createContext({});
vm.runInContext(source.slice(start, end + 2), env);
// Cross-realm values: compare through JSON, as the other vm-host suites do.
const salvage = (text, fallback) => JSON.parse(JSON.stringify(env.salvageJson(text, fallback)));

test("a torn array tail keeps the longest intact prefix of elements", () => {
  // The eyes-tasks incident shape.
  const torn = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }], null, 2).slice(0, -40);
  const got = salvage(torn, []);
  assert.ok(Array.isArray(got) && got.length >= 1, `salvaged ${got?.length} of 3`);
  assert.equal(got[0].id, "a");
});

test("trailing garbage after a complete object is dropped", () => {
  assert.deepEqual(salvage(`${JSON.stringify({ a: 1, b: 2 })}<<<torn bytes`, {}), { a: 1, b: 2 });
});

test("a torn scalar tail still yields the intact element prefix", () => {
  assert.deepEqual(salvage("[1, 2", []), [1]);
});

test("hopeless tears return null so the reset path takes over", () => {
  assert.equal(env.salvageJson('["unclosed string tear', []), null, "tear inside a string");
  assert.equal(env.salvageJson('{"a": [1, 2', {}), null, "tear inside a nested array");
});

test("the shape guard rejects an object for an array store and vice versa", () => {
  assert.equal(env.salvageJson('{"x":1}]', []), null);
  assert.equal(env.salvageJson("[1]", {}), null);
});

test("a null fallback never salvages: assistant state is rebuilt from memory", () => {
  assert.equal(env.salvageJson('{"a":1}', null), null);
});

test("intact JSON round-trips through the walk", () => {
  assert.deepEqual(salvage(JSON.stringify([{ id: "a" }, { id: "b" }]), []), [{ id: "a" }, { id: "b" }]);
});

test("writePins lands atomically and reaps only stale tmp siblings", async () => {
  const eyesSource = await readFile(new URL("../scripts/eyes.mjs", import.meta.url), "utf8");
  assert.ok(eyesSource.includes("return writeJson(pinsPath, pins)"), "writePins delegates to the atomic writeJson");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eyes-salvage-"));
  try {
    const pinsPath = path.join(dir, "eyes-pins.json");
    // A writer killed between writeFile and rename orphans its tmp sibling
    // (seen live as machine-status.json.tmp-9148-eyny9w); the next successful
    // write reaps it once it is older than the age guard.
    const staleTmp = `${pinsPath}.tmp-999999-stale`;
    fs.writeFileSync(staleTmp, '{"torn":');
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(staleTmp, old, old);
    await writePins(pinsPath, { ses_x: [{ note: "hello" }] });
    assert.equal((await readPins(pinsPath)).ses_x?.[0]?.note, "hello");
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes(".tmp-")), [], "orphaned tmp reaped by the next write");
    // A young tmp belongs to a live racing writer and survives the same write.
    const freshTmp = `${pinsPath}.tmp-999999-fresh`;
    fs.writeFileSync(freshTmp, '{"live":');
    await writePins(pinsPath, { ses_x: [{ note: "hello" }] });
    assert.ok(fs.existsSync(freshTmp), "young tmp is not swept");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
