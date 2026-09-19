// Functional smoke for main.cjs salvageJson + eyes.mjs writePins atomicity.
// salvageJson is extracted from the real main.cjs source text so the shipped
// code, not a copy, is what runs.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSrc = fs.readFileSync(path.join(root, "main.cjs"), "utf8");
const match = mainSrc.match(/function salvageJson\(text, fallback\) \{[\s\S]*?\n\}/);
if (!match) throw new Error("salvageJson not found in main.cjs");
const salvageJson = new Function(`return (${match[0]})`)();

let failures = 0;
function expect(ok, label) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
}

// Torn array tail: the eyes-tasks incident shape. Recovers the longest
// intact prefix of elements.
const tornTasks = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }], null, 2).slice(0, -40);
const got = salvageJson(tornTasks, []);
expect(Array.isArray(got) && got.length >= 1, `torn array salvages a prefix (${got && got.length} of 3)`);

// Trailing garbage after a complete object.
const dirty = `${JSON.stringify({ a: 1, b: 2 })}<<<torn bytes`;
expect(salvageJson(dirty, {}).a === 1, "object + trailing garbage salvages");

// A torn scalar tail still yields the intact element prefix.
const partial = salvageJson("[1, 2", []);
expect(Array.isArray(partial) && partial.length === 1, `torn scalar tail keeps the intact element (${partial && partial.length})`);

// Hopeless tears return null so the reset path takes over.
expect(salvageJson('["unclosed string tear', []) === null, "tear inside a string returns null");
expect(salvageJson('{"a": [1, 2', {}) === null, "tear inside a nested array returns null");

// Shape guard: an object in an array slot (or vice versa) is rejected.
expect(salvageJson('{"x":1}]', []) === null, "wrong shape rejected");
expect(salvageJson("[1]", {}) === null, "array rejected for object store");

// null fallback never salvages (assistant state is rebuilt from memory).
expect(salvageJson('{"a":1}', null) === null, "null fallback skips salvage");

// Intact JSON still parses on first try inside the walk.
const intact = [{ id: "a" }, { id: "b" }];
const round = salvageJson(JSON.stringify(intact), []);
expect(round.length === 2, "intact array round-trips");

// writePins now lands atomically: write, read back, no tmp files left.
const eyesSrc = fs.readFileSync(path.join(root, "scripts", "eyes.mjs"), "utf8");
expect(eyesSrc.includes("return writeJson(pinsPath, pins)"), "writePins delegates to atomic writeJson");

(async () => {
  const eyes = await import(`file://${path.join(root, "scripts", "eyes.mjs").replace(/\\/g, "/")}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eyes-salvage-"));
  const pinsPath = path.join(dir, "eyes-pins.json");
  await eyes.writePins(pinsPath, { ses_x: [{ note: "hello" }] });
  const readBack = await eyes.readPins(pinsPath);
  expect(readBack.ses_x && readBack.ses_x[0].note === "hello", "writePins round-trips through the atomic path");
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes(".tmp-"));
  expect(leftovers.length === 0, `no tmp files left behind (${leftovers.join(", ") || "clean"})`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `SALVAGE SMOKE: ${failures} failure(s)` : "SALVAGE SMOKE: all pass");
  process.exit(failures ? 1 : 0);
})();
