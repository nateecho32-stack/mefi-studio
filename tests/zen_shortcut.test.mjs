import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
function fixture(enabled = true) {
  const classes = new Set(), calls = [];
  const document = { body: { classList: { contains: name => classes.has(name) } }, documentElement: { dataset: {} }, activeElement: null, querySelectorAll: () => [] };
  const window = {
    MefiIdle: {
      setManualZen(on) { calls.push(["zen", on]); if (on) classes.add("command-zen"); else classes.delete("command-zen"); return true; },
      ambientZenStatus: () => ({ manual: classes.has("command-zen") }),
    },
    MefiCompanionHub: { close: () => calls.push(["hub-close"]), isOpen: () => false },
    MefiMusic: { closeAudio: () => calls.push(["audio-close"]) },
  };
  const env = vm.createContext({ localStorage: { getItem: () => enabled ? null : "off" }, window, document, state: {}, visibleNavTarget: () => true, get: () => null, closeHelpMenu: () => false, go: id => calls.push(["go", id]) });
  vm.runInContext(source.slice(source.indexOf("  function toggleZen()"), source.indexOf('  window.addEventListener("keydown", handleKey)')), env);
  const key = (key, extra = {}) => {
    const event = { key, preventDefault() { this.defaultPrevented = true; }, ...extra };
    env.handleKey(event); return event;
  };
  return { key, calls, classes, document };
}

test("Ctrl+Z opens the Map, closes menus, toggles Zen, and ignores key repeat", () => {
  const f = fixture();
  assert.equal(f.key("z", { ctrlKey: true }).defaultPrevented, true);
  assert.deepEqual(f.calls, [["hub-close"], ["audio-close"], ["go", "command"], ["zen", true]]);
  f.key("z", { ctrlKey: true, repeat: true });
  assert.ok(f.classes.has("command-zen"));
  f.key("z", { ctrlKey: true });
  assert.equal(f.classes.has("command-zen"), false);
});

test("Escape restores Zen controls without opening another menu", () => {
  const f = fixture(); f.key("z", { ctrlKey: true });
  assert.equal(f.key("Escape").defaultPrevented, true);
  assert.deepEqual(f.calls.at(-1), ["zen", false]);
});

test("Undo and Redo remain available in editable fields", () => {
  for (const chord of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }]) {
    const f = fixture(), field = { closest: () => field };
    const event = f.key("z", { ...chord, target: field });
    assert.equal(event.defaultPrevented, undefined);
    assert.equal(f.calls.length, 0);
  }
});


test("the per-device Zen shortcut switch leaves Ctrl+Z untouched", () => {
  const f = fixture(false);
  assert.equal(f.key("z", { ctrlKey: true }).defaultPrevented, undefined);
  assert.equal(f.calls.length, 0);
});
