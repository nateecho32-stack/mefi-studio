// What the frame does when a suite turns it off (nothing at all), that the 0.5 layout is Studio's only layout (no
// Settings switch, no Search action, no ?layout=, saved choice or MEFI_STUDIO_LAYOUT), the module's public surface,
// the panels other modules mount, and where the frame is registered in the build. Fake DOM:
// tests/fixtures/shell-vm.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadShell, plain } from "./fixtures/shell-vm.mjs";
import { build } from "../scripts/build-booklet.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lf = (text) => text.replace(/\r\n/g, "\n");
const read = async (...parts) => lf(await readFile(path.join(studio, ...parts), "utf8"));
// A source file is too long to print when a pattern it must not hold is found: say where.
const absent = (text, pattern, message) => { const found = pattern.exec(text); assert.ok(!found, `${message}: found ${JSON.stringify(found?.[0])} at ${found?.index}`); };

test("v2 off (a suite's page without the frame): the frame wires nothing, registers nothing, and touches no storage, no host and no timer", () => {
  const touched = [];
  const bridge = new Proxy({}, { get: (_target, name) => { touched.push(String(name)); return undefined; } });
  const page = loadShell({ layout: false, observers: true, extra: { mefiStudio: bridge } });
  assert.equal(page.window.MefiShell.active(), false);
  assert.deepEqual(page.calls.registered, [], "nothing is registered: there is no way in to offer, the layout is always on");
  assert.deepEqual(page.added, [], "no window listener");
  assert.deepEqual(page.document.body.listeners, {}, "no document listener");
  assert.deepEqual(page.observers, [], "no observer");
  assert.deepEqual(page.reads, [], "no stored key is read");
  assert.deepEqual(page.writes, [], "none is written");
  assert.deepEqual(page.timers, [], "no timer");
  assert.deepEqual(page.frames, [], "no frame of animation");
  assert.deepEqual(touched, [], "the host bridge is not so much as looked at");
  assert.deepEqual(page.props, {}, "no inline variable");
  assert.deepEqual(page.calls.layoutSet, []);
  assert.deepEqual(page.calls.go, []);
  assert.deepEqual(page.document.body.children.map((node) => node.id), ["app-rail", "app-local-nav"], "nothing added to the page");
  assert.equal(Object.keys(page.root.dataset).includes("frame"), false);
});

test("v2 off: the public calls answer quietly and change nothing", () => {
  const page = loadShell({ layout: false });
  const shell = page.window.MefiShell;
  assert.deepEqual([shell.open("list"), shell.close("list"), shell.toggle("list"), shell.isOpen("list"), shell.resize("list", 300), shell.size("list"), shell.info("list"), shell.resetLayout(), shell.openInbox === undefined, shell.status()].map((value) => value ?? null), [false, false, false, false, 0, 0, null, false, false, null]);
  assert.deepEqual(page.calls.layoutSet, []);
  assert.deepEqual(page.writes, []);
  assert.equal(shell.setMode("build"), "build", "a mode that is on is left alone");
  assert.deepEqual(page.calls.vibe, [], "and MefiVibe is not called for it");
  assert.equal(shell.setMode("vibe"), "vibe", "the mode is MefiVibe's: without the frame this is only its setter, and nothing else moves");
  assert.deepEqual(page.calls.layoutSet, []);
});

test("the 0.5 layout is the only layout: no Search action, no Settings switch, and no ?layout=, saved choice, shell choice or MEFI_STUDIO_LAYOUT brings the classic one back", async () => {
  const page = loadShell({});
  assert.equal(page.calls.registered.some((row) => row.id === "layout-switch"), false, "Search has no Switch layout");
  // Every launch the contract reads is v2: the old ways back to classic are not read.
  for (const [search, stored] of [["", {}], ["?layout=v1", {}], ["", { "mefiStudio.layout": "v1" }], ["?capture=1", {}], ["?smoke=1", {}], ["?shell=classic", { "mefiStudio.shell": "classic" }]]) {
    const launch = loadShell({ realNav: true, layout: false, search, stored });
    assert.equal(launch.nav.applyLayout(), true, `${search || "(no query)"} ${JSON.stringify(stored)}: the 0.5 layout`);
    assert.equal(typeof launch.nav.setLayout, "undefined", "no setter for a choice");
    assert.equal(typeof launch.nav.setShell, "undefined", "nor for the shell");
    assert.equal(launch.nav.get?.("shellRail") ?? null, null, "Search has no Switch navigation");
  }
  const main = await read("main.cjs");
  absent(main, /MEFI_STUDIO_LAYOUT|layoutQuery|layoutFromEnv/, "main.cjs reads no layout from the environment");
  assert.match(main, /query: \{ capture: CAPTURE \? "1" : "0", smoke: SMOKE \? "1" : "0"(, \.\.\.\(typeof startupMarks !== "undefined" && startupMarks \? \{\} : \{ marks: "0" \}\))? \}/, "the window loads with the diagnostic flags and the startup marks' switch only");
  const template = await read("renderer", "booklet.template.html");
  absent(template, /settings-layout-v2/, "Settings has no layout switch");
});

test("the docs say it is the only layout, under the Layout contract", async () => {
  const docs = await read("docs", "unified-studio.md");
  const section = docs.slice(docs.indexOf("## Layout contract"), docs.indexOf("## The companion"));
  assert.ok(section.includes("**The only layout.**"), "the section says the 0.5 layout is the only one");
  absent(section, /Try the 0\.5 layout|Switch layout: 0\.5 or classic|MEFI_STUDIO_LAYOUT/, "and no longer describes the ways in");
  assert.match(docs, /## The frame/);
  assert.match(await read("docs", "architecture.md"), /\*\*Frame \(layout v2\)\*\*/);
});

test("the source keeps its promises: one storage key behind try/catch, no write of the contract's variables, no writes to the host", async () => {
  const source = (await read("renderer", "shell.js")).split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  assert.equal([...source.matchAll(/localStorage/g)].length, 2, "localStorage is reached in exactly two places");
  assert.match(source, /const readStore = \(key\) => \{ try \{ return localStorage\.getItem\(key\); \} catch \{ return null; \} \};/);
  assert.match(source, /const writeStore = \(key, value\) => \{ try \{ localStorage\.setItem\(key, value\); return true; \} catch \{ return false; \} \};/);
  absent(source, /sessionStorage|indexedDB|document\.cookie/, "no other store");
  assert.deepEqual([...source.matchAll(/(?:readStore|writeStore)\(([A-Z_]+)/g)].map((match) => match[1]), ["PREFS_KEY", "PREFS_KEY"], "and only the one key");
  assert.match(source, /const PREFS_KEY = "mefiStudio\.shell\.layout\.v1";/);
  // The four region variables are the contract's to write: this file asks through MefiNav.layout.set, and reads only the rail's.
  assert.deepEqual([...source.matchAll(/--shell-[a-z-]+/g)].map((match) => match[0]), ["--shell-rail-w"]);
  absent(source, /setVar\(rootEl\(\), "--shell-|style\.setProperty\("--shell-/, "the contract's variables are not written here");
  // It calls no host function by name: the feed is the pushes and modules the page already has.
  absent(source, /window\.mefiStudio\??\.[A-Za-z]/, "the bridge is not called by name");
  assert.match(source, /for \(const subscribe of \["onTasks", "onAssistant", "onAssistantStatus", "onProjects"\]\) \{ try \{ window\.mefiStudio\?\.\[subscribe\]\?\.\(\(\) => scheduleLive\(\)\); \} catch \{ \/\* a bridge without the push \*\/ \} \}/, "the four pushes are all it listens to");
});

test("what MefiShell exposes is what the docs and the other slices rely on", () => {
  const page = loadShell({});
  const names = Object.keys(page.window.MefiShell).sort();
  assert.deepEqual(names, ["DEFAULTS", "LIMITS", "MODES", "PRESETS", "REGIONS", "active", "close", "disable", "enable", "info", "isOpen", "layout", "mode", "mount", "onChange", "onInbox", "open", "openInbox", "pages", "plan", "region", "resetLayout", "resize", "setMode", "size", "status", "sync", "toggle"]);
  assert.equal(page.window.MefiShell.onInbox, null, "a hook, empty until the inbox module sets it");
  assert.deepEqual(plain(page.window.MefiShell.MODES), ["vibe", "build"]);
});

test("mount(): content in a region, in order, shown and hidden and removed, with the empty state only while nothing is shown", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const node = (id) => { const made = page.document.createElement("div"); made.id = id; return made; };
  const list = page.region("list"), stack = list.children.find((child) => child.className === "shell-stack");
  assert.equal(list.dataset.empty, "true", "nothing mounted: the honest empty state");
  assert.deepEqual(list.children.find((child) => child.className === "shell-empty").children.map((child) => child.textContent), ["Nothing listed yet", "This fills in when the page you are on has things to list."]);
  assert.equal(page.region("inspector").children.find((child) => child.className === "shell-empty").children[0].textContent, "Nothing to inspect yet");
  assert.equal(page.region("main").hidden, true, "main is not in the way until something is in it");
  const second = shell.mount("list", "b", node("panel-b"), { title: "Second", order: 20 });
  const first = shell.mount("list", "a", () => node("panel-a"), { title: "First", order: 10 });
  assert.equal(list.dataset.empty, "false");
  assert.deepEqual(stack.children.map((child) => child.getAttribute("data-key")), ["a", "b"], "by order, not by arrival");
  assert.deepEqual(stack.children.map((child) => child.getAttribute("aria-label")), ["First", "Second"]);
  assert.equal(first.element.id, "panel-a");
  assert.equal(first.shown, true);
  first.hide();
  assert.equal(stack.children[0].hidden, true);
  assert.equal(first.shown, false);
  assert.equal(list.dataset.empty, "false", "another panel is still there");
  second.hide();
  assert.equal(list.dataset.empty, "true", "all hidden: the empty state is back");
  first.show();
  assert.equal(list.dataset.empty, "false");
  second.unmount();
  assert.deepEqual(stack.children.map((child) => child.getAttribute("data-key")), ["a"]);
  assert.equal(second.shown, false);
  second.show();
  second.unmount();
  assert.equal(stack.children.length, 1, "a removed panel stays removed");
  // The same key again replaces the panel.
  shell.mount("list", "a", node("panel-a2"));
  assert.deepEqual(stack.children.map((child) => child.firstChild.id), ["panel-a2"]);
  assert.equal(first.shown, false, "the old handle is dead");
  // Main, the tab strip and the top bar take panels too.
  const inMain = shell.mount("main", "page", node("page-node"));
  assert.equal(page.region("main").hidden, false);
  inMain.hide();
  assert.equal(page.region("main").hidden, true);
  shell.mount("tabs", "strip", node("strip-node"));
  assert.ok(page.$("strip-node"));
  shell.mount("top", "extra", node("extra-node"));
  shell.mount("status", "item", node("item-node"));
  const slot = (id) => page.$(id)?.parentNode?.parentNode;
  assert.equal(slot("extra-node")?.className, "shell-top-extra", "the bar has a slot for other modules' controls");
  assert.equal(slot("item-node")?.className, "shell-status-extra", "and the status bar one for their items");
  assert.equal(page.$("shell-top").children[0].className, "shell-top-left", "the slot is between the bar's two ends");
});

test("mount() refuses what it cannot hold, and a factory that fails leaves an empty panel and no crash", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  for (const args of [["nowhere", "k", page.document.createElement("div")], ["list", "", page.document.createElement("div")], ["list", "k", 42], ["list", "k", null], ["list", 7, page.document.createElement("div")]]) {
    const handle = shell.mount(...args);
    assert.equal(handle.shown, false);
    assert.equal(handle.element, null);
    assert.doesNotThrow(() => { handle.show(); handle.hide(); handle.unmount(); });
  }
  assert.equal(page.region("list").dataset.empty, "true");
  const broken = shell.mount("list", "broken", () => { throw new Error("no"); });
  assert.equal(broken.element, null);
  const empty = shell.mount("list", "empty", () => "text");
  assert.equal(empty.element, null);
  assert.doesNotThrow(() => shell.mount("list", "fine", page.document.createElement("div")).hide());
});

test("the factory is given where it is drawn, and runs only once however often the region is placed again", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const given = [];
  const handle = shell.mount("inspector", "details", (where) => { given.push(plain({ region: where.region, key: where.key })); return page.document.createElement("div"); });
  handle.hide(); handle.show(); handle.hide(); handle.show();
  shell.mount("inspector", "other", page.document.createElement("div"));
  assert.deepEqual(given, [{ region: "inspector", key: "details" }]);
});

test("the build: shell.js and shell.css are in the booklet, after the scripts they read, and the stylesheet is in the bundle", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-shell-build-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const sources = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(sources.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const html = await readFile(path.join(fixture, "renderer", "booklet.html"), "utf8");
    const at = (text) => html.indexOf(text);
    assert.ok(at("window.MefiShell = shell;") > 0, "the script is inlined");
    assert.ok(at("html[data-frame] .shell-top") > 0, "and its stylesheet");
    assert.ok(at("window.MefiShell = shell;") > at("window.MefiNav = "), "after the navigation it reads");
    assert.ok(at("window.MefiShell = shell;") > at("window.MefiIdle = "), "after idle: the updater tool pins the prefix of the list");
    assert.equal(html.split("window.MefiShell = shell;").length, 2, "once");
  } finally {
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

test("shell.css: everything is under html[data-frame], so with v2 off no rule matches anything", async () => {
  const css = (await read("renderer", "shell.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  // A flat walk over rules, into @media, @container and @supports blocks; @keyframes are names, not selectors.
  const selectors = [];
  const walk = (text) => {
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf("{", at);
      if (open < 0) break;
      const head = text.slice(at, open).trim();
      let depth = 1, close = open + 1;
      while (close < text.length && depth) { if (text[close] === "{") depth += 1; else if (text[close] === "}") depth -= 1; close += 1; }
      const body = text.slice(open + 1, close - 1);
      if (head.startsWith("@keyframes")) { /* animation steps */ } else if (head.startsWith("@")) walk(body);
      else for (const one of head.split(/,(?![^(]*\))/)) selectors.push(one.trim());
      at = close;
    }
  };
  walk(css);
  assert.ok(selectors.length > 150, `read the whole sheet (${selectors.length} selectors)`);
  for (const selector of selectors) assert.match(selector, /^(?:html\[data-frame\]|html\[data-motion="off"\]\[data-frame\]|html\[data-frame\]\[)/, `${selector} can only match while the frame is on`);
});
