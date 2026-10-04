import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const code = source.slice(source.indexOf("  function claim(id) {"), source.indexOf("  function top() {"));
function fixture() {
  const frames = [], document = {}, state = { sheet: null, transient: null, focusReturn: { sheet: null, transient: null } };
  const node = id => ({ id, isConnected: true, hidden: false, value: "unsent draft", classList: { toggle() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [], closest: () => null, focus() { document.activeElement = this; } });
  const body = node("body"), opener = node("opener"), summary = node("summary"), draft = node("search"), input = node("task-new"), otherInput = node("other-input");
  document.body = body; body.dataset = {}; document.activeElement = opener;
  const root = node("tasks-overlay"), otherRoot = node("other-overlay");
  const destinations = { tasks: { layer: "sheet", element: root.id, focus: "#task-new" }, other: { layer: "sheet", element: otherRoot.id, focus: "#other-input" }, menu: { layer: "transient", element: otherRoot.id, focus: "#other-input" } };
  document.getElementById = id => id === root.id ? root : id === otherRoot.id ? otherRoot : null;
  document.querySelectorAll = selector => selector === "#task-new" ? [input] : selector === "#other-input" ? [otherInput] : [];
  document.querySelector = () => opener;
  const env = vm.createContext({ document, state, window: {}, WORKSPACE_PAGES: new Set(), get: id => destinations[id], markSwap() {}, layerRoot: dest => document.getElementById(dest?.element), idleActive: () => false, dialogRoot: () => null, isWorkspacePage: () => false, syncPageInert() {}, visibleNavTarget: n => !!n && !n.hidden, dispatchNav() {}, requestAnimationFrame: fn => frames.push(fn) });
  vm.runInContext(`${source.match(/  let focusClaimSequence = 0;/)?.[0] ?? ""}\n${code}`, env);
  return { env, document, state, root, otherRoot, opener, summary, draft, input, otherInput, frames, paint() { for (const fn of frames.splice(0)) fn(); } };
}

test("a current navigation claim still focuses its default input and preserves drafts", () => {
  const f = fixture(); f.env.claim("tasks"); f.paint(); assert.equal(f.document.activeElement, f.input); assert.equal(f.input.value, "unsent draft");
});
for (const target of ["summary", "draft", "otherInput"]) test(`a delayed claim preserves subsequent ${target} focus and drafts`, () => {
  const f = fixture(); f.env.claim("tasks"); f[target].focus(); f.paint(); assert.equal(f.document.activeElement, f[target]); assert.equal(f.draft.value, "unsent draft"); assert.equal(f.input.value, "unsent draft");
});
test("release invalidates its queued navigation focus", () => {
  const f = fixture(); f.env.claim("tasks"); f.env.release("tasks"); f.paint(); assert.equal(f.document.activeElement, f.opener);
});
test("a hidden destination cannot take delayed focus", () => {
  const f = fixture(); f.env.claim("tasks"); f.root.hidden = true; f.paint(); assert.equal(f.document.activeElement, f.opener);
});
test("only the newest repeated claim can supply initial focus", () => {
  const f = fixture(); f.env.claim("tasks"); f.env.claim("tasks"); f.frames.shift()(); assert.equal(f.document.activeElement, f.opener); f.paint(); assert.equal(f.document.activeElement, f.input);
});
test("close and reopen invalidates the earlier claim even when focus returns to the opener", () => {
  const f = fixture(); f.env.claim("tasks"); f.env.release("tasks"); f.env.claim("tasks"); f.frames.shift()(); assert.equal(f.document.activeElement, f.opener); f.paint(); assert.equal(f.document.activeElement, f.input);
});
test("a newer sheet supplies its own default focus", () => {
  const f = fixture(); f.env.claim("tasks"); f.env.claim("other"); f.paint(); assert.equal(f.document.activeElement, f.otherInput);
});
test("a transient claim wins over pending sheet focus", () => {
  const f = fixture(); f.env.claim("tasks"); f.env.claim("menu"); f.paint(); assert.equal(f.document.activeElement, f.otherInput);
});
test("releasing an unrelated destination does not cancel current initial focus", () => {
  const f = fixture(); f.env.claim("tasks"); f.env.release("other"); f.paint(); assert.equal(f.document.activeElement, f.input);
});
