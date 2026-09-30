// Just enough HTML to put a well-formed piece of renderer/booklet.template.html
// into the shared fake DOM (tests/fixtures/renderer-dom.mjs): tags, attributes
// (quoted, bare and boolean), self-closing SVG children, text and comments. The
// suites for Settings cards use it so the markup under test is the real
// template's, and a card or a row renamed on one side and not the other fails
// there. It is deliberately not a browser: no entities beyond the five below,
// no implied end tags.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Element, createDom } from "./renderer-dom.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VOID = new Set(["input", "br", "hr", "img", "meta", "link", "use", "path", "circle", "rect", "ellipse", "source", "wbr"]);
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]);

export function parseHtml(html) {
  const root = new Element("FRAGMENT");
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const [whole, close, tag, attrs, selfClose, text] of html.matchAll(tokens)) {
    if (whole.startsWith("<!--")) continue;
    if (text !== undefined) {
      if (text.trim()) {
        const node = new Element("#text");
        node.textContent = decode(text);
        stack.at(-1).append(node);
      }
      continue;
    }
    const name = tag.toUpperCase();
    if (close) {
      const at = stack.findLastIndex((node) => node.tagName === name);
      if (at > 0) stack.length = at;
      continue;
    }
    const node = new Element(name);
    for (const [, key, double, single, bare] of attrs.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const value = decode(double ?? single ?? bare ?? "");
      node.setAttribute(key, value);
      if (key === "open") node.open = true;
      if (key === "checked") node.checked = true;
      if (key === "value") node.value = value;
      if (key === "type") node.type = value;
    }
    stack.at(-1).append(node);
    if (!selfClose && !VOID.has(tag.toLowerCase())) stack.push(node);
  }
  return root;
}

/** The template text from `from` up to (not including) `to`, both required. */
export function templatePiece(from, to) {
  const template = readFileSync(path.join(ROOT, "renderer", "booklet.template.html"), "utf8").replace(/\r\n/g, "\n");
  const start = template.indexOf(from);
  const end = template.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`the template no longer has "${from.slice(0, 50)}" … "${to.slice(0, 50)}"`);
  return template.slice(start, end);
}

/** A fake document holding the given template pieces, every id reachable by getElementById. */
export function domWith(...pieces) {
  const dom = createDom();
  for (const html of pieces) {
    const page = parseHtml(html);
    dom.body.append(page);
    for (const node of page.descendants()) if (node.id) dom.elements.set(node.id, node);
  }
  return dom;
}
