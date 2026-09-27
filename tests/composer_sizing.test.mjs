import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const start = source.indexOf("  function growArea(");
const end = source.indexOf("  // The reply-is-coming bubble:", start);
assert.ok(start >= 0 && end > start);
function fixture(CSS) {
  const env = vm.createContext({ window: { CSS } });
  vm.runInContext(source.slice(start, end), env);
  return env.growArea;
}

test("native composer sizing configures once and never forces scroll-height reads", () => {
  const grow = fixture({ supports(property, value) { assert.equal(property, "field-sizing"); assert.equal(value, "content"); return true; } });
  let writes = 0;
  const style = new Proxy({}, { set(target, property, value) { writes++; target[property] = value; return true; } });
  const area = { style, value: "An unchanged draft", get scrollHeight() { throw new Error("Native sizing must not force layout"); } };
  grow(area);
  assert.deepEqual({ ...style }, { fieldSizing: "content", height: "auto", minHeight: "38px", maxHeight: "120px", overflowY: "auto" });
  const initial = writes;
  for (let i = 0; i < 40; i++) grow(area);
  assert.equal(writes, initial, "status pushes leave both content and styles alone");
  area.value = "Changed draft"; grow(area);
  assert.equal(writes, initial, "the browser owns subsequent resizing");
  style.fieldSizing = "fixed"; grow(area);
  assert.equal(style.fieldSizing, "content", "an externally reset control can be initialized again");
  assert.equal(area.value, "Changed draft");
});

test("web previews without native sizing retain growth, capping and overflow behavior", () => {
  for (const CSS of [undefined, {}, { supports: () => false }]) {
    const grow = fixture(CSS);
    const area = { style: {}, scrollHeight: 20, value: "Draft" };
    grow(area);
    assert.equal(area.style.height, "38px"); assert.equal(area.style.overflowY, "hidden");
    area.scrollHeight = 76; grow(area);
    assert.equal(area.style.height, "76px"); assert.equal(area.style.overflowY, "hidden");
    area.scrollHeight = 240; grow(area);
    assert.equal(area.style.height, "120px"); assert.equal(area.style.overflowY, "auto");
    area.value = ""; area.scrollHeight = 20; grow(area);
    assert.equal(area.style.height, "38px"); assert.equal(area.style.overflowY, "hidden");
    assert.equal(area.style.fieldSizing, undefined);
  }
});

test("missing composers are safe and native sizing is independent per surface", () => {
  const grow = fixture({ supports: () => true });
  grow(null); grow(undefined);
  const first = { style: {} }, second = { style: {} };
  grow(first); grow(second);
  assert.equal(first.style.fieldSizing, "content");
  assert.equal(second.style.fieldSizing, "content");
  first.style.maxHeight = "140px"; grow(second);
  assert.equal(first.style.maxHeight, "140px");
  assert.equal(second.style.maxHeight, "120px");
});
