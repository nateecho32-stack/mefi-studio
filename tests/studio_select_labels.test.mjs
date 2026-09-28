import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The enhanced select's accessible name. el.labels walks the whole document
// after any DOM change, so studio-ui keeps which <label for> names a select
// and reads its text live; aria-label and the wrapping label are read as-is.

const source = (await readFile(new URL("../renderer/studio-ui.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = source.indexOf("  const labelOf = ");
const to = source.indexOf("  function layer()", from);
assert.ok(from >= 0 && to > from, "labelOf markers");

function harness() {
  const context = vm.createContext({});
  vm.runInContext(`${source.slice(from, to)}\nthis.labelOf = labelOf; this.forget = () => { forLabels = new WeakMap(); };`, context);
  return context;
}

function select({ id = "pick", labels = [], ariaLabel = null, title = "", wrapper = null } = {}) {
  const el = { id, title, walks: 0, getAttribute: (name) => (name === "aria-label" ? ariaLabel : null), closest: () => wrapper };
  Object.defineProperty(el, "labels", { get() { el.walks += 1; return labels; } });
  return el;
}
const label = (htmlFor, text) => ({ htmlFor, textContent: text, isConnected: true });

test("a <label for> is found once and its text is read live", () => {
  const { labelOf } = harness();
  const name = label("pick", " Provider ");
  const el = select({ labels: [name] });
  assert.equal(labelOf(el), "Provider");
  name.textContent = "Model provider";
  assert.equal(labelOf(el), "Model provider");
  assert.equal(labelOf(el), "Model provider");
  assert.equal(el.walks, 1, "the document is walked once, not per refresh");
});

test("a label that left the page or now names another control is looked up again", () => {
  const { labelOf } = harness();
  const first = label("pick", "First"), second = label("pick", "Second");
  const labels = [first];
  const el = select({ labels });
  assert.equal(labelOf(el), "First");
  first.isConnected = false;
  labels.splice(0, 1, second);
  assert.equal(labelOf(el), "Second");
  second.htmlFor = "other";
  labels.length = 0;
  assert.equal(labelOf(el), "Options");
  assert.equal(el.walks, 3);
});

test("a select with no <label for> is asked again only after navigation", () => {
  const context = harness();
  const labels = [];
  const el = select({ labels, title: "Fallback title" });
  assert.equal(context.labelOf(el), "Fallback title");
  labels.push(label("pick", "Added later"));
  assert.equal(context.labelOf(el), "Fallback title");
  context.forget();
  assert.equal(context.labelOf(el), "Added later");
});

test("aria-label wins, then the <label for>, then the wrapping label's title", () => {
  const { labelOf } = harness();
  assert.equal(labelOf(select({ ariaLabel: "Explicit", labels: [label("pick", "For")] })), "Explicit");
  const wrapper = { querySelector: (selector) => (selector === "b, strong" ? { textContent: " Wrapped " } : null) };
  assert.equal(labelOf(select({ id: "", wrapper })), "Wrapped");
  assert.equal(labelOf(select({ labels: [label("pick", "For")], wrapper })), "For");
});

test("navigation forgets the kept labels", () => {
  assert.match(source, /window\.addEventListener\("mefi:nav", \(\) => \{ forLabels = new WeakMap\(\);/);
});
