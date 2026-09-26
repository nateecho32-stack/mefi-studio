import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/file-inputs.js", import.meta.url), "utf8");
class Element {
  constructor(tag = "textarea") { this.tagName = tag; this.value = ""; this.children = []; this.events = {}; this.isConnected = true; this.maxLength = -1; this.classList = { add() {}, remove() {} }; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  insertAdjacentElement(_position, child) { this.bar = child; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  dispatchEvent(event) { for (const callback of this.events[event.type] || []) callback(event); }
  focus() { this.focused = true; }
  click() { this.dispatchEvent({ type: "click" }); }
}
function fixture(options = {}) {
  const document = new Element("document"); document.createElement = (tag) => new Element(tag);
  const window = {};
  vm.runInNewContext(source, { document, window, TextDecoder, Event });
  const input = new Element(); let edits = 0;
  input.addEventListener("input", () => edits++);
  window.MefiFileInputs.bind(input, options);
  const drop = (files) => input.dispatchEvent({ type: "drop", dataTransfer: { types: ["Files"], files }, preventDefault() {}, stopPropagation() {} });
  const settle = async () => { for (let i = 0; i < 50 && window.MefiFileInputs.isReading(input); i++) await new Promise(setImmediate); assert.equal(window.MefiFileInputs.isReading(input), false); };
  return { input, window, document, drop, settle, status: () => input.bar.children[2].textContent, edits: () => edits };
}

test("multiple dropped files become editable unsent draft content in order", async () => {
  const f = fixture(); f.input.value = "Use these references";
  f.drop([new File(["# Existing plan\n- [ ] Continue"], "plan.md"), new File(["export const feature = true;"], "feature.ts")]);
  assert.equal(f.window.MefiFileInputs.isReading(f.input), true);
  await f.settle();
  assert.match(f.input.value, /^Use these references/);
  assert.ok(f.input.value.indexOf("plan.md") < f.input.value.indexOf("feature.ts"));
  assert.match(f.input.value, /- \[ \] Continue/);
  assert.equal(f.edits(), 1, "draft persistence receives one input event, no submit");
  assert.match(f.status(), /2 files added/);
});

test("picker shares the import path and bounds bytes, formats, binary content and draft length", async () => {
  const f = fixture({ limit: 200 });
  const [button, picker] = f.input.bar.children;
  button.click();
  picker.files = [new File(["fine"], "small.md"), new File(["x"], "image.png"), new File(["\0binary"], "binary.txt"), new File(["x".repeat(131073)], "large.txt"), new File(["x".repeat(201)], "long.txt")];
  picker.dispatchEvent({ type: "change" }); await f.settle();
  assert.match(f.input.value, /small.md/);
  assert.doesNotMatch(f.input.value, /image.png|binary.txt|large.txt|long.txt/);
  assert.match(f.status(), /aren't supported/); assert.match(f.status(), /binary/); assert.match(f.status(), /128 KB/); assert.match(f.status(), /won't fit/);
  assert.ok(f.input.value.length <= 200);
});

test("slow file reads cannot cross a project change or overwrite newer typed text", async () => {
  let scope = "project-a", resolve;
  const f = fixture({ scope: () => scope }); f.input.value = "Original";
  const bytes = new TextEncoder().encode("old project context").buffer;
  const file = { name: "plan.md", size: bytes.byteLength, slice: () => ({ arrayBuffer: () => new Promise((yes) => { resolve = yes; }) }) };
  f.drop([file]); scope = "project-b"; f.input.value = "New project draft"; resolve(bytes); await f.settle();
  assert.equal(f.input.value, "New project draft"); assert.equal(f.edits(), 0);
  assert.match(f.status(), /draft changed/);
  f.drop([file]); f.input.value += " plus more typing"; resolve(bytes); await f.settle();
  assert.match(f.input.value, /^New project draft plus more typing/);
  assert.match(f.input.value, /old project context/);
});

test("read-only inputs, removed controls, excess files and oversized drafts retain their existing text", async () => {
  const f = fixture(); const file = new File(["text"], "plan.md");
  f.input.value = "Keep me"; f.input.disabled = true; f.drop([file]); await f.settle();
  assert.equal(f.input.value, "Keep me");
  f.input.disabled = false; f.drop(Array(9).fill(file)); await f.settle(); assert.match(f.status(), /up to 8/);
  f.drop([file]); f.input.isConnected = false; await f.settle(); assert.equal(f.input.value, "Keep me");
  f.input.isConnected = true; f.input.maxLength = 10; f.drop([file]); await f.settle(); assert.equal(f.input.value, "Keep me");
});

test("unhandled file drops prevent navigation while ordinary text drops retain browser behavior", () => {
  const f = fixture(); let prevented = 0;
  f.document.dispatchEvent({ type: "drop", dataTransfer: { types: ["Files"] }, preventDefault() { prevented++; } });
  f.document.dispatchEvent({ type: "drop", dataTransfer: { types: ["text/plain"] }, preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
});


test("the chat host keeps an attached excerpt past the former 2000-character cutoff", async () => {
  const host = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = host.indexOf("async function assistantMessage(raw,");
  const end = host.indexOf("// The card's Work on it:", start);
  assert.ok(start > 0 && end > start);
  let delivered;
  const state = { messages: [] };
  const context = vm.createContext({
    projects: { current: () => ({ id: "p1" }) }, assistantState: state,
    ensureAssistant: async () => {}, assistantUiContext: () => null,
    assistantMessageId: () => "message-1", assistantTrim() {}, assistantCaps: () => ({ messages: 100 }), assistantLog() {},
    assistantReplyWork: () => ({ id: "reply-1" }), assistantAiUsable: () => false, ASSISTANT_PRIORITY: { responder: 1 },
    enqueue: async (_role, callback) => callback(), assistantRespond: async (user) => { delivered = user.text; return { role: "assistant", text: "Received" }; },
  });
  vm.runInContext(host.slice(start, end), context);
  const text = "Read this attached file:\n" + "x".repeat(3000) + " END_OF_REFERENCE";
  const result = await context.assistantMessage(text);
  assert.equal(result.ok, true); assert.equal(delivered, text); assert.equal(state.messages[0].text, text);
});
