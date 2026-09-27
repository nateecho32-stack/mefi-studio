import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Search Studio names each Settings choice button. textContent alone ran a
// button's parts together ("Fullevery animation", "VoidMembers", "Classic
// orbsLuminous circles"), so the label comes from the button's own words.
const source = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("  function settingsButtonLabel("), source.indexOf("  function settingsEntries("));

const text = (value) => ({ nodeType: 3, textContent: value });
function element(tag, children = [], attrs = {}) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: children, attrs, parent: null,
    classList: { contains: (name) => String(attrs.class ?? "").split(" ").includes(name) },
    getAttribute: (name) => attrs[name] ?? null,
    get textContent() { return children.map((child) => child.textContent).join(""); },
    querySelector(selector) {
      const wanted = selector.split(",").map((part) => part.trim().toUpperCase());
      for (const child of children) {
        if (child.nodeType !== 1) continue;
        if (wanted.includes(child.tagName)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    closest(selector) {
      for (let at = node; at; at = at.parent) if (selector === "[role=group][aria-labelledby]" && at.attrs.role === "group" && at.attrs["aria-labelledby"]) return at;
      return null;
    },
  };
  for (const child of children) if (child.nodeType === 1) child.parent = node;
  return node;
}

function labels(ids = {}) {
  const context = vm.createContext({ document: { getElementById: (id) => ids[id] ?? null, querySelector: () => null } });
  vm.runInContext(`${code}\nglobalThis.label = settingsControlLabel;`, context);
  return context.label;
}

test("a choice button's detail line and lock badge stay out of its search label", () => {
  const motionHeading = element("span", [text("Motion")]);
  const full = element("button", [text("Full"), element("small", [text("every animation")])]);
  element("div", [full], { role: "group", "aria-labelledby": "motion-label" });
  const premiumHeading = element("h4", [text("Void collection"), element("span", [element("span", [text("Members")])], { class: "music-premium-tag" })]);
  const voidTheme = element("button", [text("Void"), element("span", [element("span", [text("Members")])], { class: "music-premium-lock" })]);
  element("div", [voidTheme], { role: "group", "aria-labelledby": "premium-label" });
  const orbs = element("button", [element("span", [], { "aria-hidden": "true" }), element("strong", [text("Classic orbs")]), element("small", [text("Luminous circles")])]);
  const link = element("button", [text("Appearance settings "), element("span", [text("↗")], { "aria-hidden": "true" })]);
  const label = labels({ "motion-label": motionHeading, "premium-label": premiumHeading });
  assert.equal(label(full), "Motion › Full");
  assert.equal(label(voidTheme), "Void collection › Void");
  assert.equal(label(orbs), "Classic orbs");
  assert.equal(label(link), "Appearance settings");
});

test("an aria-label still wins over the button's own words", () => {
  const button = element("button", [text("Full"), element("small", [text("every animation")])], { "aria-label": "Full motion" });
  assert.equal(labels()(button), "Full motion");
});
