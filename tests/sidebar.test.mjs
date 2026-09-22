import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const [source, navSource] = await Promise.all([
  readFile(new URL("../renderer/sidebar.js", import.meta.url), "utf8"),
  readFile(new URL("../renderer/nav.js", import.meta.url), "utf8"),
]);

function environment({ rail = false } = {}) {
  const timers = new Set();
  let document;
  class Target {
    listeners = {};
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    dispatchEvent(event) { for (const listener of this.listeners[event.type] || []) listener(event); }
    emit(type, fields = {}) { this.dispatchEvent({ type, target: this, preventDefault() {}, ...fields }); }
  }
  class Element extends Target {
    constructor(id = "", tag = "div") {
      super(); this.id = id; this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {};
      this.inert = false; this.hidden = false; this.disabled = false; this.isConnected = true;
      this.classList = { remove() {}, toggle() {} };
    }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
    setAttribute(name, value) { this.attrs[name] = value; }
    closest(selector) {
      const found = selector.split(",").some((part) => {
        part = part.trim();
        if (part === "[hidden]") return this.hidden;
        if (part === "[inert]") return this.inert;
        if (part === "#workspace-sidebar-panel[inert]") return this.id === "workspace-sidebar-panel" && this.inert;
        if (part === "[data-nav]") return Boolean(this.dataset.nav);
        if (["button", "input", "textarea", "select", "summary"].includes(part)) return this.tag === part;
        return false;
      });
      return found ? this : this.parent?.closest(selector) ?? null;
    }
    querySelectorAll(selector) {
      const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      return selector === "*" ? all : all.filter((child) => child.closest(selector) === child);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    getClientRects() { return this.closest("[hidden], [inert]") ? [] : [{}]; }
    focus() {
      if (this.disabled || this.closest("[hidden], [inert]")) return;
      const previous = document.activeElement;
      document.activeElement = this;
      if (previous === this) return;
      for (let element = previous; element; element = element.parent) element.emit("focusout", { target: previous, relatedTarget: this });
      this.emit("focus");
      for (let element = this; element; element = element.parent) element.emit("focusin", { target: this, relatedTarget: previous });
    }
  }
  const root = new Element("workspace-sidebar");
  const panel = new Element("workspace-sidebar-panel");
  const toggle = new Element("workspace-sidebar-toggle", "button");
  const dismiss = new Element("workspace-sidebar-close", "button");
  const link = new Element("sidebar-workspace", "button"); link.dataset.nav = "workspace";
  const input = new Element("workspace-person-name", "input");
  const outside = new Element("workspace-input", "textarea");
  const body = new Element("body"); body.append(root, outside); root.append(toggle, panel); panel.append(dismiss, link, input);
  // The navigation rail's M+ is the panel's door when the rail shell is on.
  const brand = new Element("app-rail-brand", "button");
  if (rail) body.append(brand);
  const elements = new Map([body, root, panel, toggle, dismiss, link, input, outside, ...(rail ? [brand] : [])].map((element) => [element.id, element]));
  document = Object.assign(new Target(), { body, activeElement: outside, readyState: "loading", getElementById: (id) => elements.get(id), querySelector: () => null });
  if (rail) document.documentElement = { dataset: { shell: "rail" } };
  const window = new Target();
  const context = vm.createContext({
    window, document, console,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (timer) => timers.delete(timer),
  });
  vm.runInContext(navSource, context);
  vm.runInContext(source, context);
  const flush = () => { const pending = [...timers]; timers.clear(); for (const fn of pending) fn(); };
  const hover = (element) => element.emit("pointerenter", { pointerType: "mouse" });
  const leave = (element) => element.emit("pointerleave", { pointerType: "mouse" });
  return { sidebar: window.MefiSidebar, nav: window.MefiNav, window, document, root, panel, toggle, dismiss, link, input, outside, brand, hover, leave, flush };
}

test("hover reveals the menu without moving focus and crossing into it cancels delayed closure", () => {
  const env = environment();
  assert.equal(env.panel.inert, true);
  env.hover(env.toggle);
  assert.equal(env.sidebar.isOpen(), true);
  assert.equal(env.document.activeElement, env.outside);
  env.leave(env.toggle);
  env.hover(env.panel);
  env.flush();
  assert.equal(env.sidebar.isOpen(), true);
  env.leave(env.panel);
  assert.equal(env.sidebar.isOpen(), true, "leaving leaves time to return");
  env.flush();
  assert.equal(env.sidebar.isOpen(), false);
  assert.equal(env.panel.inert, true);
  assert.equal(env.panel.attrs["aria-hidden"], "true");
});

test("keyboard access works without hover and closes when focus leaves", () => {
  const env = environment();
  env.toggle.emit("pointerenter", { pointerType: "touch" });
  assert.equal(env.sidebar.isOpen(), false);
  env.toggle.focus();
  assert.equal(env.sidebar.isOpen(), true);
  env.toggle.emit("click");
  assert.equal(env.document.activeElement, env.link);
  env.input.focus();
  env.flush();
  assert.equal(env.sidebar.isOpen(), true);
  env.outside.focus(); env.flush();
  assert.equal(env.sidebar.isOpen(), false);
});

test("moving off the menu closes it even after focusing a menu control", () => {
  const env = environment();
  env.hover(env.toggle);
  env.leave(env.toggle); env.hover(env.panel);
  env.input.focus();
  env.leave(env.panel); env.flush();
  assert.equal(env.sidebar.isOpen(), false);
  assert.equal(env.panel.inert, true);
  assert.equal(env.document.activeElement, env.toggle, "closing does not strand focus in hidden content");
  env.flush();
  assert.equal(env.sidebar.isOpen(), false, "restoring focus must not reopen the menu");
});

test("Escape closes the sidebar before the underlying sheet, including from a preference field", () => {
  const env = environment(); let sheetClosed = false;
  env.nav.state.sheet = "tasks";
  env.window.MefiTasks = { close: () => { sheetClosed = true; } };
  env.sidebar.open(); env.input.focus();
  env.nav.handleKey({ key: "Escape", target: env.input, preventDefault() {} });
  assert.equal(env.sidebar.isOpen(), false);
  assert.equal(env.document.activeElement, env.toggle);
  assert.equal(sheetClosed, false);
  env.nav.handleKey({ key: "Escape", target: env.toggle, preventDefault() {} });
  assert.equal(sheetClosed, true);
});

test("transient navigation closes the menu without stealing focus and blocks hover until dismissal", () => {
  const env = environment();
  env.sidebar.open({ focus: true });
  env.nav.state.transient = "palette";
  env.outside.focus();
  env.window.emit("mefi:nav", { detail: { action: "open", id: "palette" } });
  assert.equal(env.sidebar.isOpen(), false);
  assert.equal(env.document.activeElement, env.outside);
  assert.equal(env.toggle.disabled, true);
  assert.equal(env.toggle.hidden, true);
  env.hover(env.toggle); assert.equal(env.sidebar.isOpen(), false);
  env.nav.state.transient = null;
  env.window.emit("mefi:nav", { detail: { action: "close", id: "palette" } });
  assert.equal(env.toggle.hidden, false);
  env.hover(env.toggle); assert.equal(env.sidebar.isOpen(), true);
});

test("closing a sheet restores its inert sidebar opener to the edge without reopening the menu", () => {
  const env = environment();
  env.sidebar.open({ focus: true });
  env.nav.state.sheet = "tasks";
  env.nav.state.focusReturn.sheet = env.link;
  env.window.emit("mefi:nav", { detail: { action: "open", id: "tasks" } });
  env.nav.release("tasks");
  assert.equal(env.document.activeElement, env.toggle);
  assert.equal(env.sidebar.isOpen(), false);
  assert.equal(env.toggle.attrs["aria-expanded"], "false");
});

test("project changes restore sidebar keyboard focus without stealing focus from the workspace", () => {
  const env = environment();
  env.sidebar.open({ focus: true });
  env.window.emit("mefi:project-changed");
  assert.equal(env.document.activeElement, env.toggle);
  assert.equal(env.sidebar.isOpen(), false, "restoring the edge does not reopen the closed menu");
  env.outside.focus();
  env.sidebar.open();
  env.window.emit("mefi:project-changed");
  assert.equal(env.document.activeElement, env.outside, "a project update preserves an outside editing target");
  assert.equal(env.sidebar.isOpen(), false);
});

test("outside presses, project switches and window blur dismiss the menu", () => {
  const env = environment();
  for (const dismiss of [
    () => env.document.emit("pointerdown", { target: env.outside }),
    () => env.window.emit("mefi:project-changed"),
    () => env.window.emit("blur"),
  ]) {
    env.sidebar.open(); dismiss(); assert.equal(env.sidebar.isOpen(), false);
  }
  env.sidebar.open({ focus: true }); env.dismiss.emit("click");
  assert.equal(env.document.activeElement, env.toggle);
  assert.equal(env.sidebar.isOpen(), false);
  env.sidebar.open({ focus: true }); env.window.emit("blur");
  assert.equal(env.document.activeElement, env.toggle, "native dialogs cannot leave focus in the inert panel");
  assert.equal(env.sidebar.isOpen(), false);
});

test("closing the panel returns focus to its door: the rail's M+ on the rail shell, the edge strip otherwise", () => {
  const railed = environment({ rail: true });
  railed.sidebar.open({ focus: true });
  assert.equal(railed.sidebar.isOpen(), true);
  railed.sidebar.close({ restoreFocus: true });
  assert.equal(railed.document.activeElement, railed.brand, "the edge strip is not on screen under the rail, so focus must not fall to it");
  const classic = environment();
  classic.sidebar.open({ focus: true });
  classic.sidebar.close({ restoreFocus: true });
  assert.equal(classic.document.activeElement, classic.toggle);
});
