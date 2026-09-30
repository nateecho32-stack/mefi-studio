// Size and density, the model (renderer/size.js, window.MefiSize): the four settings
// and their limits, the old values that must keep working, the draft / Apply / Undo
// flow, what reaches the window and what does not, and the store it lives in (the real
// appearance code of renderer/studio-ui.js, run over a fake window). The page and the
// miniature are tests/size_page.test.mjs; the stylesheet is tests/size_css.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { loadSize, plain } from "./fixtures/size-env.mjs";

const DEFAULTS = { zoom: 100, text: 1, density: "comfortable", detail: "status" };
const OLD_STORE = { preset: "studio", density: "comfortable", glass: 45, glow: 35 };
const stored = (env) => JSON.parse(env.storage.get("mefiStudio.appearance"));
const appearanceEvents = (env) => env.eventsOf("mefi:appearance");

// ---- the limits ----------------------------------------------------------------------
test("the interface scale is a percent in steps of 5 from 70 to 150, and 100 when it is not a number", async () => {
  const { zoomOf } = (await loadSize()).window.MefiSize.model;
  assert.deepEqual([undefined, null, "", "x", true, false, 0, -5, Number.NaN, Infinity].map(zoomOf), Array(10).fill(100));
  assert.deepEqual([69, 70, 72, 73, 100, 104, 148, 152, 400, "110", 107.4].map(zoomOf), [70, 70, 70, 75, 100, 105, 150, 150, 150, 110, 105]);
});

test("a factor from the host becomes the same percent the host would save, half steps included", async () => {
  const { window } = await loadSize();
  const { zoomFromFactor } = window.MefiSize.model;
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = main.indexOf("function zoomFactorOf(value) {");
  const body = main.slice(start, main.indexOf("\n}", start) + 2);
  const zoomFactorOf = vm.runInNewContext(`(${body})`);
  const probes = [0.5, 0.69, 0.7, 0.72, 0.725, 0.75, 1, 1.025, 1.05, 1.125, 1.1249, 1.26, 1.475, 1.4749, 1.5, 1.51, 2, 10, 0, -1, null, "", "x", true, undefined, "1.1", Number.NaN, Infinity];
  for (const value of probes) assert.equal(zoomFromFactor(value) / 100, zoomFactorOf(value), `the window and the host agree on ${String(value)}`);
});

test("text size is a factor in steps of 0.1 from 0.8 to 1.4, and 1 when it is not a number", async () => {
  const { textOf, textPercent, textWord, TEXT_WORDS } = (await loadSize()).window.MefiSize.model;
  assert.deepEqual([undefined, null, "", "abc", true, Number.NaN, Infinity].map(textOf), Array(7).fill(1));
  assert.deepEqual([0.5, 0.75, 0.8, 0.85, 0.9, 1, 1.04, 1.05, 1.1, 1.3, 1.4, 1.41, 3, -1, "1.2"].map(textOf), [0.8, 0.8, 0.8, 0.9, 0.9, 1, 1, 1.1, 1.1, 1.3, 1.4, 1.4, 1.4, 0.8, 1.2]);
  assert.equal(TEXT_WORDS.length, 7, "one word for each step from 80% to 140%");
  assert.deepEqual([0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4].map(textWord), ["Smallest", "Small", "Default", "Large", "Larger", "Very large", "Largest"]);
  assert.deepEqual([0.8, 1, 1.4].map(textPercent), [80, 100, 140]);
});

test("density and detail are the values the layout knows, and anything else is the default", async () => {
  const { densityOf, detailOf } = (await loadSize()).window.MefiSize.model;
  assert.deepEqual(["compact", "comfortable", "spacious"].map(densityOf), ["compact", "comfortable", "spacious"]);
  assert.deepEqual(["roomy", "", null, undefined, 3, "Compact"].map(densityOf), Array(6).fill("comfortable"));
  assert.deepEqual(["titles", "status", "all"].map(detailOf), ["titles", "status", "all"]);
  assert.deepEqual(["more", "", null, undefined, 1].map(detailOf), Array(5).fill("status"));
});

test("a setting is made whole from a part: what is missing comes from the base, what is not a value becomes the default", async () => {
  const { normalize } = (await loadSize()).window.MefiSize.model;
  const base = { zoom: 110, text: 1.2, density: "compact", detail: "all" };
  assert.deepEqual(plain(normalize({ text: 0.9 }, base)), { zoom: 110, text: 0.9, density: "compact", detail: "all" });
  assert.deepEqual(plain(normalize({}, base)), base);
  assert.deepEqual(plain(normalize(null, base)), base, "not an object at all: the base");
  assert.deepEqual(plain(normalize({ zoom: "x", text: "y", density: "z", detail: 9 }, base)), DEFAULTS, "present but unreadable: the default, not the base");
  assert.deepEqual(plain(normalize(undefined)), DEFAULTS);
  assert.deepEqual(plain(normalize({ zoom: 1000, text: 9 })), { ...DEFAULTS, zoom: 150, text: 1.4 });
});

test("it says a setting in the words the page and the Undo toast use", async () => {
  const { words } = (await loadSize()).window.MefiSize.model;
  assert.equal(words(DEFAULTS), "100% · default text · comfortable · titles and status");
  assert.equal(words({ zoom: 125, text: 1.4, density: "spacious", detail: "all" }), "125% · largest text · spacious · everything");
  assert.equal(words({ zoom: 70, text: 0.8, density: "compact", detail: "titles" }), "70% · smallest text · compact · titles");
  assert.equal(words({ text: 1.1 }), "100% · large text · comfortable · titles and status", "a part reads against the defaults");
});

// ---- the old values -------------------------------------------------------------------
test("every older store still reads: no text or detail is the default, an unknown density is comfortable", async () => {
  const { fromStore } = (await loadSize()).window.MefiSize.model;
  const read = (value) => plain(fromStore(value));
  assert.deepEqual(read(OLD_STORE), { density: "comfortable", text: 1, detail: "status" });
  assert.deepEqual(read({ preset: "focus", density: "compact", glass: 0, glow: 0 }), { density: "compact", text: 1, detail: "status" }, "Focus is compact, as it always was");
  assert.deepEqual(read({ density: "roomy" }), { density: "comfortable", text: 1, detail: "status" });
  assert.deepEqual(read({ v: 2, density: "spacious", text: 1.2, detail: "all" }), { density: "spacious", text: 1.2, detail: "all" });
  assert.deepEqual(read({ text: "big", detail: 4 }), { density: "comfortable", text: 1, detail: "status" });
  for (const junk of [null, undefined, "compact", 42, [], [1, 2], true]) assert.deepEqual(read(junk), { density: "comfortable", text: 1, detail: "status" }, `a store that is ${JSON.stringify(junk)}`);
});

test("a saved older store sets the window on launch as it always did, and the new settings are the defaults", async () => {
  const env = await loadSize({ stored: { preset: "focus", density: "compact", glass: 0, glow: 0 } });
  assert.equal(env.root.dataset.density, "compact");
  assert.equal(env.root.dataset.detail, "status");
  assert.equal(env.rootVars()["--text-scale"], "1");
  assert.deepEqual(plain(env.window.MefiSize.get()), { ...DEFAULTS, density: "compact" });
  assert.deepEqual(env.writes, [], "reading an older store writes nothing");
});

test("the saved text size, density and detail are on the window when it starts", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, v: 2, density: "spacious", text: 1.2, detail: "all" } });
  assert.equal(env.root.dataset.density, "spacious", "spacious is a v2 choice");
  assert.equal(env.root.dataset.detail, "all");
  assert.equal(env.rootVars()["--text-scale"], "1.2");
  assert.equal(appearanceEvents(env).length, 1, "the start repaints once, through the store's own call");
  assert.deepEqual(env.writes, [], "and saves nothing");
});

test("the window's density keeps its two older levels where the layout is v1: spacious reads as comfortable there", async () => {
  const env = await loadSize({ layout: null, stored: { ...OLD_STORE, v: 2, density: "spacious", text: 1.3, detail: "all" } });
  env.window.MefiAppearance.apply({}, false);
  assert.equal(env.root.dataset.density, "comfortable");
  env.window.MefiAppearance.apply({ density: "compact" }, false);
  assert.equal(env.root.dataset.density, "compact", "compact still is");
  assert.equal(env.root.dataset.detail, undefined, "and nothing of the new settings is painted");
  assert.equal(env.rootVars()["--text-scale"], undefined);
  const v2 = await loadSize({ stored: { ...OLD_STORE, density: "spacious" } });
  v2.window.MefiAppearance.apply({ glass: 10 }, false);
  assert.equal(v2.root.dataset.density, "spacious", "a v2 window keeps it through any appearance change");
});

// ---- dark by default -------------------------------------------------------------------
test("with the layout off the module defines its object and does nothing else", async () => {
  const env = await loadSize({ layout: null, stored: { ...OLD_STORE, v: 2, text: 1.3, detail: "all" } });
  const size = env.window.MefiSize;
  assert.deepEqual(env.added, [], "no listener");
  assert.deepEqual(env.registry, [], "no destination in the registry");
  assert.deepEqual(env.calls, [], "no host call, not even to listen for the scale");
  assert.deepEqual(env.writes, [], "nothing stored");
  assert.equal(env.root.dataset.detail, undefined);
  assert.equal(env.rootVars()["--text-scale"], undefined);
  assert.equal(env.elements.get("size-body").children.length, 0, "no page drawn");
  assert.deepEqual(plain(await size.apply({ text: 1.2 })), { ok: false, error: "Size and density are part of the 0.5 layout." });
  assert.equal(size.open(), false);
  assert.deepEqual(plain(size.preview({ text: 1.2 })), DEFAULTS, "a preview changes nothing");
  assert.deepEqual(plain(size.get()), { ...DEFAULTS, text: 1.3, detail: "all" }, "it can still be read, without asking the host");
  await env.tick();
  assert.deepEqual([env.calls, env.writes, env.added], [[], [], []]);
});

test("while the page still loads the only thing it does is wait to be told the layout", async () => {
  const env = await loadSize({ layout: null, ready: "loading" });
  assert.deepEqual(env.added, []);
  assert.equal(typeof env.listeners.get("document:DOMContentLoaded"), "function", "one wait for the page to load");
  env.listeners.get("document:DOMContentLoaded")();
  assert.deepEqual([env.added, env.registry, env.calls, env.writes], [[], [], [], []], "and when the layout is v1 that was all");
  const v2 = await loadSize({ layout: "v2", ready: "loading" });
  assert.deepEqual(v2.registry, [], "v2 waits for nav.js to have decided, too");
  v2.listeners.get("document:DOMContentLoaded")();
  assert.deepEqual(v2.registry.map((record) => record.id), ["size", "settings:size"]);
});

test("in v2 it registers its page and its row in Configuration, and listens only for what keeps the settings true", async () => {
  const env = await loadSize();
  const [page, row] = env.registry;
  assert.deepEqual({ id: page.id, kind: page.kind, layer: page.layer, section: page.section, key: page.key, element: page.element, palette: page.showIn.palette, tools: page.showIn.tools, dock: page.showIn.dock, label: page.label }, { id: "size", kind: "overlay", layer: "sheet", section: "settings", key: null, element: "size-overlay", palette: true, tools: false, dock: false, label: "Size and density" });
  assert.deepEqual({ id: row.id, kind: row.kind, label: row.label, palette: row.showIn.palette }, { id: "settings:size", kind: "action", label: "Settings › Appearance › Size and density", palette: false }, "one row in Configuration, none doubled in Search");
  assert.deepEqual([...new Set(env.added)].sort(), ["mefi:appearance", "mefi:layout"], "nothing listens for the page until it is open");
  assert.deepEqual(env.calls, [["onUiZoom"]], "the keys that move the scale are heard; the scale itself is read when something asks");
});

// ---- reading the window ----------------------------------------------------------------------
test("the window's scale is read from the host once, when something first asks, and then followed", async () => {
  const env = await loadSize({ zoom: 1.25 });
  const size = env.window.MefiSize;
  const heard = [];
  size.onChange((detail) => heard.push(plain(detail)));
  assert.equal(size.get().zoom, 100, "until the host has answered it is 100%");
  await env.tick();
  assert.equal(size.get().zoom, 125);
  size.get(); size.get();
  await env.tick();
  assert.equal(env.calls.filter(([name]) => name === "uiZoomGet").length, 1, "asked once");
  assert.deepEqual(heard.map((detail) => [detail.source, detail.changed, detail.applied.zoom]), [["host", ["zoom"], 125]]);
});

test("Ctrl + and Ctrl - move the scale the page shows and leave an untouched draft alone, and a touched one where it is", async () => {
  const env = await loadSize();
  const size = env.window.MefiSize;
  const heard = [];
  size.onChange((detail) => heard.push(plain(detail)));
  env.pushZoom(1.2);
  assert.equal(size.get().zoom, 120);
  assert.deepEqual(plain(size.draft()), { ...DEFAULTS, zoom: 120 }, "the draft had not been touched: it follows");
  assert.equal(size.dirty(), false, "so a press of Ctrl + never leaves a draft that looks edited");
  size.preview({ density: "compact", zoom: 90 });
  env.pushZoom(1.3);
  assert.deepEqual(plain(size.draft()), { ...DEFAULTS, zoom: 90, density: "compact" }, "what the person changed stays changed");
  assert.equal(size.dirty(), true);
  env.pushZoom(1.3);
  env.pushZoom("x");
  env.pushZoom(undefined);
  assert.deepEqual(heard.map((detail) => [detail.source, detail.changed, detail.applied.zoom]), [["keys", ["zoom"], 120], ["keys", ["zoom"], 130]], "a repeat or an unreadable push says nothing");
});

test("a style preset that changes the density changes what the window has, and an untouched draft follows it", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  const heard = [];
  size.onChange((detail) => heard.push(plain(detail)));
  env.window.MefiAppearance.apply({ preset: "focus" });
  assert.equal(size.get().density, "compact");
  assert.equal(size.draft().density, "compact");
  assert.equal(env.root.dataset.density, "compact");
  assert.deepEqual(heard.map((detail) => [detail.source, detail.changed]), [["appearance", ["density"]]]);
  env.window.MefiAppearance.apply({ glass: 10 });
  assert.equal(heard.length, 1, "a change that is not one of the four says nothing");
});

// ---- the draft ---------------------------------------------------------------------------------
test("a preview changes the draft and nothing else: not the window, not the store, not the host", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  await env.tick();
  const before = { root: { ...env.root.dataset }, vars: env.rootVars(), events: env.events.length, calls: env.calls.length, writes: env.writes.length };
  const draft = plain(size.preview({ zoom: 133, text: 1.36, density: "spacious", detail: "all" }));
  assert.deepEqual(draft, { zoom: 135, text: 1.4, density: "spacious", detail: "all" }, "cut to the steps");
  assert.deepEqual(plain(size.preview({ text: 0.8 })), { zoom: 135, text: 0.8, density: "spacious", detail: "all" }, "a part merges into the draft");
  assert.deepEqual(plain(size.preview("nonsense")), plain(size.draft()));
  assert.deepEqual(plain(size.get()), DEFAULTS, "what the window has did not change");
  assert.deepEqual({ root: { ...env.root.dataset }, vars: env.rootVars(), events: env.events.length, calls: env.calls.length, writes: env.writes.length }, before);
  assert.equal(size.dirty(), true);
  assert.deepEqual(plain(size.discard()), DEFAULTS);
  assert.equal(size.dirty(), false);
});

test("a window with no zoom of its own cannot be asked for one: the draft's scale stays where it is", async () => {
  const env = await loadSize({ zoom: null });
  const size = env.window.MefiSize;
  assert.equal(size.preview({ zoom: 130 }).zoom, 100);
  const result = await size.apply({ zoom: 130, text: 1.2 });
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.applied), { ...DEFAULTS, text: 1.2 }, "the rest applies");
  assert.deepEqual(env.calls, [], "and the host was not asked");
});

// ---- Apply, Undo and Reset ----------------------------------------------------------------------------
test("Apply puts the whole draft on the window: the scale on the host, the rest in the store, the root and the event", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  const heard = [];
  size.onChange((detail) => heard.push(plain(detail)));
  await env.tick();
  size.preview({ zoom: 130, text: 1.2, density: "spacious", detail: "all" });
  const events = appearanceEvents(env).length;
  const result = plain(await size.apply());
  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, { zoom: 130, text: 1.2, density: "spacious", detail: "all" });
  assert.deepEqual(result.previous, DEFAULTS);
  assert.deepEqual(result.changed, ["zoom", "text", "density", "detail"]);
  assert.deepEqual(env.callsOf("uiZoom"), [[{ factor: 1.3 }]], "the window's own zoom, through the host");
  assert.deepEqual(stored(env), { ...OLD_STORE, density: "spacious", v: 2, text: 1.2, detail: "all" }, "every older key kept, three new ones added");
  assert.equal(env.root.dataset.density, "spacious");
  assert.equal(env.root.dataset.detail, "all");
  assert.equal(env.rootVars()["--text-scale"], "1.2");
  const fresh = appearanceEvents(env).slice(events);
  assert.equal(fresh.length, 1, "announced once, as every appearance change is");
  assert.deepEqual([fresh[0].detail.v, fresh[0].detail.text, fresh[0].detail.detail, fresh[0].detail.density], [2, 1.2, "all", "spacious"]);
  assert.deepEqual(heard.filter((detail) => detail.source !== "host").map((detail) => [detail.source, detail.changed]), [["apply", ["zoom", "text", "density", "detail"]]], "one change, told once");
  assert.equal(size.dirty(), false);
  assert.deepEqual(plain(size.draft()), result.applied, "the draft is what the window has");
});

test("Apply says what it did and offers Undo, which puts every one of the four back", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  await env.tick();
  await size.apply({ zoom: 125, text: 1.4, density: "compact", detail: "titles" });
  assert.equal(env.toasts.length, 1);
  const toast = env.toasts[0];
  assert.deepEqual([toast.message, toast.kind, toast.options.action.label, toast.options.duration], ["Applied to the whole window: 125% · largest text · compact · titles.", "good", "Undo", 6000]);
  toast.options.action.run();
  await env.tick();
  assert.deepEqual(plain(size.get()), DEFAULTS);
  assert.equal(env.root.dataset.density, "comfortable");
  assert.equal(env.root.dataset.detail, "status");
  assert.equal(env.rootVars()["--text-scale"], "1");
  assert.deepEqual(env.callsOf("uiZoom").map(([payload]) => payload.factor), [1.25, 1], "the host zoom goes back too");
  assert.equal(env.toasts.length, 1, "an Undo does not toast again");
  assert.equal(size.dirty(), false);
  assert.deepEqual(plain(await size.undo()), { ok: false, error: "There is nothing to undo." }, "and it can only be done once");
});

test("a second Apply takes the first one's Undo away, so no stale button lingers", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  await env.tick();
  await size.apply({ text: 1.2 });
  await size.apply({ text: 1.3 });
  assert.equal(env.toasts.length, 2);
  assert.equal(env.toasts[0].dismissed, true);
  assert.equal(env.toasts[1].dismissed, false);
  env.toasts[1].options.action.run();
  await env.tick();
  assert.equal(size.get().text, 1.2, "Undo goes back one step, to where the second Apply started");
});

test("Apply with nothing to change does nothing: no host call, no toast, no write", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  await env.tick();
  const result = plain(await size.apply());
  assert.deepEqual([result.ok, result.changed], [true, []]);
  assert.deepEqual([env.toasts.length, env.writes.length, env.calls.filter(([name]) => name === "uiZoom").length], [0, 0, 0]);
});

test("Reset is Apply of the defaults, with its own words, and Undo for it", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, v: 2, density: "compact", text: 1.3, detail: "all" }, zoom: 1.4 });
  const size = env.window.MefiSize;
  size.get();
  await env.tick();
  assert.equal(size.get().zoom, 140);
  const result = plain(await size.reset());
  assert.deepEqual(result.applied, DEFAULTS);
  assert.equal(env.toasts.at(-1).message, "Back to the defaults: 100%, default text, comfortable, titles and status.");
  assert.equal(env.toasts.at(-1).options.action.label, "Undo");
  assert.deepEqual(env.callsOf("uiZoom"), [[{ factor: 1 }]]);
  env.toasts.at(-1).options.action.run();
  await env.tick();
  assert.deepEqual(plain(size.get()), { zoom: 140, text: 1.3, density: "compact", detail: "all" });
  assert.deepEqual(plain(await size.reset()).changed.length, 4);
  assert.equal(plain(await size.reset()).changed.length, 0, "already at the defaults: nothing to do");
});

test("a scale the host refuses stops the whole Apply: nothing else changes, the draft is kept and the person is told", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  await env.tick();
  env.host.failNext = "refuse";
  const asked = { zoom: 150, text: 1.3, density: "spacious", detail: "all" };
  const result = plain(await size.apply(asked));
  assert.deepEqual(result, { ok: false, error: "The window would not zoom." });
  assert.deepEqual(plain(size.get()), DEFAULTS, "not the text either");
  assert.deepEqual(env.writes, [], "nothing stored");
  assert.equal(env.root.dataset.density, "comfortable");
  assert.deepEqual(plain(size.draft()), asked, "the draft keeps what was asked for");
  assert.deepEqual([env.toasts.at(-1).message, env.toasts.at(-1).kind], ["The window would not zoom.", "bad"]);
  env.host.failNext = "the host went away";
  assert.equal((await size.apply()).ok, false, "a host that throws is a refusal too");
  assert.equal(env.toasts.at(-1).message, "The host went away");
  const again = await size.apply();
  assert.equal(again.ok, true, "and the same draft goes through once the host answers");
  assert.deepEqual(plain(again.applied), asked);
});

test("the scale the host kept is the scale the window has, when it is not the one asked for", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  env.window.mefiStudio.uiZoom = async (payload) => { env.calls.push(["uiZoom", payload]); return { ok: true, factor: 1.3 }; };
  const result = plain(await env.window.MefiSize.apply({ zoom: 150 }));
  assert.equal(result.ok, true);
  assert.equal(result.applied.zoom, 130);
  assert.equal(env.window.MefiSize.get().zoom, 130);
  assert.match(env.toasts.at(-1).message, /^Applied to the whole window: 130% /, "the toast says what the window got");
  assert.equal(env.window.MefiSize.draft().zoom, 150, "and what was asked for is still in the draft, to be tried again");
  assert.equal(env.window.MefiSize.dirty(), true);
});

test("a second press while one Apply is still working is the same Apply", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  await env.tick();
  const first = size.apply({ zoom: 120 });
  const second = size.apply({ zoom: 130 });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(plain(a).applied.zoom, 120);
  assert.deepEqual(plain(b), plain(a));
  assert.equal(env.calls.filter(([name]) => name === "uiZoom").length, 1);
  assert.equal(env.toasts.length, 1);
});

// ---- the store -----------------------------------------------------------------------------------------------
test("the first write to an older store keeps its text under a backup key, once, and a store already at this version needs none", async () => {
  const raw = JSON.stringify({ preset: "focus", density: "compact", glass: 0, glow: 0 });
  const env = await loadSize({ stored: raw });
  const size = env.window.MefiSize;
  await env.tick();
  assert.equal(env.storage.has("mefiStudio.appearance.backup.v1"), false, "reading it kept nothing");
  await size.apply({ text: 1.2 });
  assert.equal(env.storage.get("mefiStudio.appearance.backup.v1"), raw);
  assert.equal(stored(env).v, 2);
  await size.apply({ text: 1.3 });
  assert.equal(env.storage.get("mefiStudio.appearance.backup.v1"), raw, "the backup is the old text, not the last one");
  const current = await loadSize({ stored: { ...OLD_STORE, v: 2, text: 1.1 } });
  await current.window.MefiSize.apply({ text: 1.2 });
  assert.equal(current.storage.has("mefiStudio.appearance.backup.v1"), false);
  const fresh = await loadSize({ stored: null });
  await fresh.window.MefiSize.apply({ text: 1.2 });
  assert.equal(fresh.storage.has("mefiStudio.appearance.backup.v1"), false, "a window that had nothing saved has nothing to keep");
});

test("a store nobody can read is kept as it is and replaced by a good one", async () => {
  const env = await loadSize({ stored: "{not json" });
  const size = env.window.MefiSize;
  assert.deepEqual(plain(size.get()), DEFAULTS);
  await size.apply({ text: 1.2 });
  assert.equal(env.storage.get("mefiStudio.appearance.backup.v1"), "{not json");
  assert.equal(stored(env).text, 1.2);
});

test("with storage blocked everything still applies to the window; it is only not remembered", async () => {
  const env = await loadSize({ brokenStorage: true });
  const size = env.window.MefiSize;
  assert.deepEqual(plain(size.get()), DEFAULTS, "reading a blocked store is the defaults");
  const result = plain(await size.apply({ text: 1.2, density: "compact", detail: "all" }));
  assert.equal(result.ok, true);
  assert.equal(env.root.dataset.density, "compact");
  assert.equal(env.root.dataset.detail, "all");
  assert.equal(env.rootVars()["--text-scale"], "1.2");
  assert.deepEqual(plain(size.get()), { ...DEFAULTS, text: 1.2, density: "compact", detail: "all" }, "the store keeps it for as long as the window lives");
  assert.deepEqual(env.writes, [], "and no storage call got through");
  assert.equal((await size.apply({ text: 1 })).ok, true);
});

test("without the appearance store (an older studio-ui.js) an Apply says so instead of pretending", async () => {
  const env = await loadSize({ studioUi: false });
  const result = plain(await env.window.MefiSize.apply({ text: 1.2 }));
  assert.equal(result.ok, false);
  assert.equal(env.toasts.at(-1).kind, "bad");
  assert.deepEqual(plain(env.window.MefiSize.get()), DEFAULTS);
});

test("turning the layout off takes the text size and the detail off the window", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, v: 2, text: 1.2, detail: "all" } });
  assert.equal(env.root.dataset.detail, "all");
  env.root.dataset.layout = "";
  delete env.root.dataset.layout;
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: false } });
  assert.equal(env.root.dataset.detail, undefined);
  assert.equal(env.rootVars()["--text-scale"], undefined);
  // A window that has left the layout is not painted again by a later appearance change.
  env.window.MefiAppearance.apply({ v: 2, density: "compact", text: 1.3, detail: "titles" });
  assert.equal(env.root.dataset.detail, undefined, "the detail stays off");
  assert.equal(env.rootVars()["--text-scale"], undefined, "and so does the text size");
});

test("turning the layout off and on again in an open window puts the saved text size, detail and density back", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, v: 2, density: "spacious", text: 1.2, detail: "all" } });
  assert.equal(env.root.dataset.density, "spacious");
  delete env.root.dataset.layout;
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: false } });
  assert.equal(env.root.dataset.detail, undefined);
  assert.equal(env.root.dataset.density, "comfortable", "a window without the layout has the two older densities");
  env.root.dataset.layout = "v2";
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: true, list: 280 } });
  assert.deepEqual([env.root.dataset.detail, env.rootVars()["--text-scale"], env.root.dataset.density], ["all", "1.2", "spacious"]);
  // A region that only changed its size says on: true too, and costs the window nothing.
  env.root.dataset.detail = "titles";
  const told = appearanceEvents(env).length;
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: true, list: 300 } });
  assert.equal(env.root.dataset.detail, "titles", "only a return to the layout repaints");
  assert.equal(appearanceEvents(env).length, told, "and tells nobody anything");
});

test("the appearance listeners are told once when the layout goes off and once when it comes back, so what they show matches the density the window has", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, v: 2, density: "spacious" } });
  const at = appearanceEvents(env).length;
  delete env.root.dataset.layout;
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: false } });
  assert.equal(appearanceEvents(env).length, at + 1);
  env.root.dataset.layout = "v2";
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: true } });
  assert.equal(appearanceEvents(env).length, at + 2);
});

test("without the appearance store the layout going off and coming back still takes the text size and detail off the window and puts them back", async () => {
  const env = await loadSize({ studioUi: false });
  assert.deepEqual([env.root.dataset.detail, env.rootVars()["--text-scale"]], ["status", "1"]);
  delete env.root.dataset.layout;
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: false } });
  assert.deepEqual([env.root.dataset.detail, env.rootVars()["--text-scale"]], [undefined, undefined]);
  env.root.dataset.layout = "v2";
  env.window.dispatchEvent({ type: "mefi:layout", detail: { on: true } });
  assert.deepEqual([env.root.dataset.detail, env.rootVars()["--text-scale"]], ["status", "1"]);
});

test("an appearance change that changes nothing the window has still puts the text size and detail back if something else took them off", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, v: 2, text: 1.2, detail: "all" } });
  delete env.root.dataset.detail;
  env.root.style.removeProperty("--text-scale");
  env.window.dispatchEvent({ type: "mefi:appearance", detail: {} });
  assert.equal(env.root.dataset.detail, "all");
  assert.equal(env.rootVars()["--text-scale"], "1.2");
});

test("an appearance store that cannot be read is the defaults, not an error in the page", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, v: 2, text: 1.2 } });
  const size = env.window.MefiSize;
  env.window.MefiAppearance.get = () => { throw new Error("the store is broken"); };
  assert.doesNotThrow(() => size.get());
  assert.deepEqual(plain(size.get()), DEFAULTS);
});

// ---- listening and measuring -------------------------------------------------------------------------------------
test("onChange gives back the way to stop, and one listener that throws never stops the others", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const size = env.window.MefiSize;
  await env.tick();
  const heard = [];
  size.onChange(() => { throw new Error("a listener that breaks"); });
  const stop = size.onChange((detail) => heard.push(detail.applied.text));
  assert.equal(typeof size.onChange("not a function"), "function", "a bad callback is ignored");
  await size.apply({ text: 1.2 });
  stop();
  await size.apply({ text: 1.3 });
  assert.deepEqual(heard, [1.2]);
});

test("a region can ask for a density token in pixels, to be told its size in numbers", async () => {
  const env = await loadSize();
  env.computed.set("--d-tab", "38px");
  env.computed.set("--d-top", " 44px");
  assert.equal(env.window.MefiSize.metric("tab"), 38);
  assert.equal(env.window.MefiSize.metric("top"), 44);
  assert.equal(env.window.MefiSize.metric("nothing"), null);
});

test("the model's own constants are frozen, so another module cannot move a limit", async () => {
  const { window } = await loadSize();
  const { model } = window.MefiSize;
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.ZOOM) && Object.isFrozen(model.TEXT) && Object.isFrozen(model.DEFAULTS) && Object.isFrozen(window.MefiSize), true);
  assert.deepEqual([model.ZOOM.min, model.ZOOM.max, model.ZOOM.step, model.TEXT.min, model.TEXT.max, model.VERSION], [70, 150, 5, 0.8, 1.4, 2]);
  assert.deepEqual(plain(model.DEFAULTS), DEFAULTS);
});
