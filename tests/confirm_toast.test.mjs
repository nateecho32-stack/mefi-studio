// The toast host's confirm helper (renderer/booklet.js): MefiConfirm resolves
// true only when its committing button is pressed, false when the toast times
// out or is dismissed, and never twice; error toasts live longer than
// confirmations and accept the pointer so a hover can hold them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const start = source.indexOf("  window.MefiToast = (message");
const confirmAt = source.indexOf("  window.MefiConfirm = (message");
const end = source.indexOf("\n  });\n", confirmAt) + "\n  });\n".length;
assert.ok(start > 0 && confirmAt > start && end > confirmAt, "toast and confirm helpers are where the test expects them");
const section = source.slice(start, end);

function environment() {
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.classes = new Set(); this.removed = false;
      this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c) };
    }
    set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(" "); }
    append(...nodes) { this.children.push(...nodes); }
    remove() { this.removed = true; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    fire(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ target: this, ...event }); }
    button() { return this.children.find((child) => child.tag === "button"); }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    querySelector(selector) { return selector === ".toast-action" ? this.button() : null; }
    focus() { document.activeElement = this; }
  }
  const host = new Element("div");
  const document = { getElementById: (id) => (id === "toast-host" ? host : null), createElement: (tag) => new Element(tag), body: new Element("body") };
  const window = {};
  const context = vm.createContext({ window, document, setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(), Number, String, Promise, Math });
  vm.runInContext(section, context);
  return { window, host, document };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// dismiss() drops the "show" class at once and removes the node 300 ms later;
// the class is the synchronous signal the assertions read.
const closed = (toast) => !toast.classes.has("show");

test("MefiConfirm resolves true when the committing button is pressed, and only once", async () => {
  const { window, host } = environment();
  const pending = window.MefiConfirm("Clear 3 records?", { label: "Clear", duration: 500 });
  const toast = host.children.at(-1);
  assert.equal(toast.button().textContent, "Clear");
  assert.ok(toast.classes.has("has-action"), "a confirm toast is interactive");
  assert.ok(!closed(toast), "the toast is showing while the question is open");
  toast.button().fire("click");
  assert.equal(await pending, true);
  assert.ok(closed(toast), "the toast leaves after the answer");
  toast.button().fire("click");
  await settle(320);
  assert.ok(toast.removed, "the node is gone after its exit transition");
});

test("MefiConfirm resolves false when the toast times out, and a held confirm stays open", async () => {
  const { window, host } = environment();
  const timedOut = window.MefiConfirm("Remove?", { duration: 30 });
  assert.equal(await timedOut, false);
  assert.ok(closed(host.children.at(-1)));

  const dismissed = window.MefiConfirm("Switch?", { duration: 60 });
  const held = host.children.at(-1);
  held.fire("mouseenter");
  await settle(90);
  assert.ok(!closed(held), "hovering holds the toast past its life");
  held.fire("mouseleave");
  assert.equal(await dismissed, false, "leaving lets it time out and answer no");

  const handle = window.MefiToast("plain", "info", { duration: 5000 });
  handle.dismiss();
  handle.dismiss();
  assert.ok(closed(host.children.at(-1)), "an explicit dismiss closes the toast once");
});

test("error toasts live longer and accept the pointer; plain ones stay brief", async () => {
  const { window, host } = environment();
  window.MefiToast("clear failed · nope", "bad", { duration: 60 });
  const bad = host.children.at(-1);
  assert.equal(bad.style.pointerEvents, "auto", "a hover can hold an error toast");
  window.MefiToast("saved", "good", { duration: 10 });
  const good = host.children.at(-1);
  assert.notEqual(good.style.pointerEvents, "auto");
  await settle(30);
  assert.ok(closed(good) && !closed(bad), "the brief toast is gone while the error is still up");
  await settle(50);
  assert.ok(closed(bad));
  let dismissed = 0;
  window.MefiToast("x", "info", { duration: 5, onDismiss: () => dismissed++ });
  await settle(20);
  assert.equal(dismissed, 1, "onDismiss fires once");
});

test("dismissing a confirmation returns keyboard focus without stealing it after leaving", async () => {
  const { window, host, document } = environment();
  const opener = document.createElement("button");
  opener.focus();
  const escaped = window.MefiConfirm("Remove?", { duration: 500 });
  const toast = host.children.at(-1);
  assert.equal(document.activeElement, toast.button());
  toast.fire("keydown", { key: "Escape" });
  assert.equal(await escaped, false);
  assert.equal(document.activeElement, opener, "Escape returns focus to the opening control");

  const dismissed = window.MefiConfirm("Remove?", { duration: 500 });
  host.children.at(-1).children.at(-1).fire("click");
  assert.equal(await dismissed, false);
  assert.equal(document.activeElement, opener, "the dismiss button also restores focus");

  const expired = window.MefiConfirm("Remove?", { duration: 20 });
  const elsewhere = document.createElement("button");
  elsewhere.focus();
  assert.equal(await expired, false);
  assert.equal(document.activeElement, elsewhere, "expiry respects a focus move away from the toast");
});
