import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/graph.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");

test("Catalog insights uses native sorting buttons and reports only the active column's direction", () => {
  class Element {
    constructor(text = "") { this.textContent = text; this.dataset = {}; this.attributes = {}; this.listeners = {}; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) { return selector === "button" ? this.button : null; }
    click() { this.listeners.click?.(); }
  }
  const table = template.match(/<table id="table">([\s\S]*?)<\/table>/)[1];
  const headers = [...table.matchAll(/<th\s([^>]*)>([\s\S]*?)<\/th>/g)].map(([, attrs, content]) => {
    const header = new Element();
    header.dataset.k = attrs.match(/data-k="([^"]+)"/)[1];
    assert.match(attrs, /scope="col"/);
    assert.match(content, /^<button type="button">[^<]+<\/button>$/, "every sortable header has a native keyboard control");
    header.button = new Element(content.match(/>([^<]+)</)[1]);
    return header;
  });
  assert.equal(headers.length, 11);
  const nodes = new Map();
  const document = { getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, querySelectorAll: () => headers };
  const window = {};
  vm.runInContext(source, vm.createContext({ window, document }));
  const models = [
    { name: "Alpha", vendor: "A", quality: { index: 20 }, usage: {}, limits: {}, pricing: {} },
    { name: "Zulu", vendor: "Z", quality: { index: 40 }, usage: {}, limits: {}, pricing: {} },
  ];
  window.MefiGraph.mount({ models, taskPresets: [] });
  const quality = headers.find((header) => header.dataset.k === "quality");
  const name = headers.find((header) => header.dataset.k === "name");
  assert.equal(quality.attributes["aria-sort"], "descending");
  quality.button.click();
  assert.equal(quality.attributes["aria-sort"], "ascending");
  assert.match(quality.button.attributes["aria-label"], /descending$/);
  const rowNames = () => [...nodes.get("table-body").innerHTML.matchAll(/<td><b>([^<]+)<\/b>/g)].map((match) => match[1]);
  assert.deepEqual(rowNames(), ["Alpha", "Zulu"]);
  name.button.click();
  assert.equal(quality.attributes["aria-sort"], undefined);
  assert.equal(name.attributes["aria-sort"], "descending");
  assert.deepEqual(rowNames(), ["Zulu", "Alpha"]);
  name.button.click();
  assert.deepEqual(rowNames(), ["Alpha", "Zulu"]);
  assert.equal(headers.filter((header) => header.attributes["aria-sort"]).length, 1);
});
