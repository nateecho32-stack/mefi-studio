import { parseBookletInputs } from "../scripts/build-booklet.mjs";
// Size and density, the page and its miniature (renderer/size.js, size.css), over the
// fake DOM. Every state of the four controls, what the miniature shows of the draft and
// what the window does not until Apply, the buttons, the keys, leaving and coming back,
// the panels summary, the way in (Search, Configuration, Settings, the status bar's
// menu) and the small edits in nav.js and the template that carry it. The model is
// tests/size_model.test.mjs; a real window is tests/size_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";
import { loadSize, plain } from "./fixtures/size-env.mjs";

const read = async (name) => (await readFile(new URL(`../${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const DEFAULTS = { zoom: 100, text: 1, density: "comfortable", detail: "status" };
const OLD_STORE = { preset: "studio", density: "comfortable", glass: 45, glow: 35 };
const TEXTS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];

async function opened(options = {}) {
  const env = await loadSize({ stored: OLD_STORE, ...options });
  env.size = env.window.MefiSize;
  env.size.get();
  await env.tick();
  assert.equal(env.size.open({ focus: false }), true);
  env.flushFrames();
  const at = (id) => env.get(`size-${id}`);
  env.at = at;
  env.slide = (id, value) => { const input = at(id); input.value = String(value); return input.trigger("input"); };
  env.choose = (group, value) => at(group).querySelectorAll("button").find((button) => button.dataset.value === value).click();
  env.mini = () => ({ density: at("mini").dataset.miniDensity, detail: at("mini").dataset.miniDetail, text: at("mini").style.getPropertyValue("--mini-text-scale"), zoom: at("mini").style.getPropertyValue("--mini-zoom") });
  env.rootNow = () => ({ dataset: { ...env.root.dataset }, vars: env.rootVars() });
  return env;
}

// ---- opening and closing -------------------------------------------------------------------
test("the page is drawn once, on the first open, and opening claims the layer the way every sheet does", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  assert.equal(env.elements.get("size-body").children.length, 0, "nothing is drawn until someone looks");
  assert.equal(env.size ?? env.window.MefiSize.isOpen(), false);
  assert.equal(env.window.MefiSize.open({ focus: false }), true);
  const body = env.elements.get("size-body");
  const nodes = body.children.length;
  assert.ok(nodes > 0);
  assert.equal(env.get("size-overlay").hidden, false);
  assert.deepEqual(env.claims, [["claim", "size"]]);
  assert.equal(env.window.MefiSize.isOpen(), true);
  const first = env.get("size-zoom");
  env.window.MefiSize.open({ focus: false });
  assert.equal(env.get("size-zoom"), first, "a second open keeps the same controls");
  env.window.MefiSize.close();
  assert.equal(env.get("size-overlay").hidden, true);
  assert.deepEqual(env.claims.at(-1), ["release", "size"]);
  env.window.MefiSize.close();
  assert.equal(env.claims.filter(([kind]) => kind === "release").length, 1, "closing what is closed does nothing");
});

test("what only matters while the page is in view is listened to only then", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const before = env.added.length;
  env.window.MefiSize.open({ focus: false });
  assert.deepEqual(env.added.slice(before).sort(), ["mefi:layout", "mefi:shell-layout", "resize"]);
  env.window.MefiSize.close();
  assert.deepEqual([...env.removed].sort(), ["mefi:layout", "mefi:shell-layout", "resize"], "and stopped when it is closed");
  env.window.MefiSize.open({ focus: false });
  env.window.MefiSize.open({ focus: false });
  assert.equal(env.added.length, before + 6, "opening it again listens once, not twice");
});

test("the registry record opens and closes it, and the Close button leaves the way Back and Esc do", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const [page, row] = env.registry;
  assert.deepEqual(plain({ ...page, open: undefined, close: undefined, isOpen: undefined }), { id: "size", label: "Size and density", short: "Size", kind: "overlay", layer: "sheet", section: "settings", group: "tools", key: null, glyph: "g-textsize", badge: null, desc: page.desc, searchTerms: page.searchTerms, showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false }, element: "size-overlay", focus: "#size-zoom" });
  assert.match(page.searchTerms, /\bfont\b.*\bzoom\b.*\bdensity\b/, "Search finds it by the words people use for it");
  assert.equal(page.isOpen(), false);
  page.open({ focus: false });
  assert.equal(page.isOpen(), true);
  env.get("size-close").click();
  assert.deepEqual(env.calls.at(-1), ["close", "size"], "through MefiNav.close, which is history for a page");
  page.close();
  assert.equal(page.isOpen(), false);
  row.run();
  assert.deepEqual(env.calls.filter(([name]) => name === "go").at(-1), ["go", "size", undefined], "Configuration's row opens the page");
  assert.equal(env.get("size-overlay").hidden, false);
});

test("opening the page is the first thing to ask the host for its scale, and the keyboard lands on the first control", async () => {
  const env = await loadSize({ stored: OLD_STORE, zoom: 1.3 });
  assert.deepEqual(env.callsOf("uiZoomGet"), [], "nobody has asked yet");
  env.window.MefiSize.open();
  await env.tick();
  env.flushFrames();
  assert.equal(env.callsOf("uiZoomGet").length, 1);
  assert.equal(env.get("size-zoom").value, "130", "the slider starts where the window is");
  assert.equal(env.get("size-zoom").focused, true);
  env.window.MefiSize.close();
  env.window.MefiSize.open({ focus: false });
  env.document.activeElement = null; env.get("size-zoom").focused = false;
  env.flushFrames();
  assert.equal(env.get("size-zoom").focused, false, "a caller that has somewhere else for the keyboard keeps it");
});

test("opening reads what the window has right now, not what it had when the page was last open", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  env.window.MefiSize.open({ focus: false });
  env.window.MefiSize.close();
  env.window.MefiAppearance.get = () => ({ ...OLD_STORE, v: 2, density: "compact", text: 1.3, detail: "all" });
  env.window.MefiSize.open({ focus: false });
  assert.equal(env.get("size-text").value, "130");
  assert.deepEqual(env.get("size-density").querySelectorAll("button").filter((button) => button.getAttribute("aria-checked") === "true").map((button) => button.dataset.value), ["compact"]);
  assert.equal(env.get("size-apply").disabled, true, "it is the window's, so there is nothing to apply");
});

test("another module opens the page through the navigation, so it has a place in the history, and a page that is open is not entered twice", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  assert.equal(env.window.MefiSize.open({ focus: false }), true);
  assert.deepEqual(env.calls.filter(([name]) => name === "go"), [["go", "size", { focus: false }]], "the status bar's Layout menu gets Back and Alt+Left like every page");
  assert.equal(env.window.MefiSize.isOpen(), true);
  assert.equal(env.window.MefiSize.open({ focus: false }), true);
  assert.equal(env.calls.filter(([name]) => name === "go").length, 1, "an open page is not entered again");
  const bare = await loadSize({ stored: OLD_STORE, nav: false });
  assert.equal(bare.window.MefiSize.open({ focus: false }), true, "without a navigation it still opens");
  const v1 = await loadSize({ layout: null, stored: OLD_STORE });
  assert.equal(v1.window.MefiSize.open(), false, "and with the layout off there is nothing to open");
  assert.deepEqual(v1.calls, [], "and nothing asked");
});

// ---- the controls show the draft -------------------------------------------------------------------
test("the controls open on what the window has: sliders, their words, the choices and the state", async () => {
  const env = await opened({ stored: { ...OLD_STORE, v: 2, density: "spacious", text: 1.2, detail: "all" }, zoom: 1.25 });
  assert.equal(env.at("zoom").value, "125");
  assert.equal(env.at("text").value, "120");
  assert.deepEqual([env.at("zoom").getAttribute("min"), env.at("zoom").getAttribute("max"), env.at("zoom").getAttribute("step")], ["70", "150", "5"]);
  assert.deepEqual([env.at("text").getAttribute("min"), env.at("text").getAttribute("max"), env.at("text").getAttribute("step")], ["80", "140", "10"]);
  assert.equal(env.at("zoom-out").textContent, "125%");
  assert.equal(env.at("text-out").textContent, "120% · Larger");
  assert.equal(env.at("zoom").getAttribute("aria-valuetext"), "125 percent");
  assert.equal(env.at("text").getAttribute("aria-valuetext"), "Larger, 120 percent");
  assert.equal(env.at("zoom").style.getPropertyValue("--fill"), "68.75%", "the track fills up to the thumb");
  assert.equal(env.at("text").style.getPropertyValue("--fill"), "66.67%");
  const checked = (group) => env.at(group).querySelectorAll("button").filter((button) => button.getAttribute("aria-checked") === "true").map((button) => button.dataset.value);
  assert.deepEqual([checked("density"), checked("detail")], [["spacious"], ["all"]]);
  assert.deepEqual(env.at("density").querySelectorAll("button").map((button) => button.textContent), ["Compact", "Comfortable", "Spacious"]);
  assert.deepEqual(env.at("detail").querySelectorAll("button").map((button) => button.textContent), ["Titles", "Titles and status", "Everything"]);
  assert.equal(env.at("zoom").disabled, false);
});

test("each tick under a slider sits at its own share of the range, so 100% is not drawn in the middle of 70 to 150", async () => {
  const env = await opened();
  const ticks = (id) => env.at(id).parentNode.querySelector(".size-ticks").querySelectorAll("span").map((node) => [node.textContent, parseFloat(node.style.getPropertyValue("--at"))]);
  assert.deepEqual(ticks("zoom"), [["70%", 0], ["100%", 37.5], ["150%", 100]]);
  const text = ticks("text");
  assert.deepEqual(text.map(([label]) => label), ["80%", "100%", "140%"]);
  assert.ok(Math.abs(text[1][1] - 100 / 3) < 0.001 && text[0][1] === 0 && text[2][1] === 100);
});

test("without a window zoom of its own the scale slider is there but cannot be moved", async () => {
  const env = await opened({ zoom: null });
  assert.equal(env.at("zoom").disabled, true);
  await env.slide("zoom", 130);
  assert.equal(env.size.draft().zoom, 100);
});

test("each control changes the draft and the miniature, and the window stays as it was", async () => {
  const env = await opened();
  const root = env.rootNow();
  await env.slide("zoom", 130);
  assert.deepEqual(env.mini(), { density: "comfortable", detail: "status", text: "1", zoom: "1.3" });
  assert.equal(env.at("zoom-out").textContent, "130%");
  await env.slide("text", 120);
  assert.equal(env.mini().text, "1.2");
  assert.equal(env.at("text-out").textContent, "120% · Larger");
  await env.choose("density", "compact");
  assert.equal(env.mini().density, "compact");
  assert.equal(env.at("density").querySelectorAll("button").find((button) => button.dataset.value === "compact").getAttribute("aria-checked"), "true");
  await env.choose("detail", "all");
  assert.equal(env.mini().detail, "all");
  assert.deepEqual(plain(env.size.draft()), { zoom: 130, text: 1.2, density: "compact", detail: "all" });
  assert.deepEqual(env.rootNow(), root, "the root has none of it");
  assert.deepEqual(plain(env.size.get()), DEFAULTS);
  assert.deepEqual([env.writes.length, env.callsOf("uiZoom").length], [0, 0], "nothing stored, the host not asked");
});

test("every combination of the four controls gives the miniature its own tokens and the root none until Apply", async () => {
  for (const applied of [1, 1.25]) {
    const env = await opened({ zoom: applied });
    const root = env.rootNow();
    let seen = 0;
    for (const zoom of [70, 100, 125, 150]) for (const text of TEXTS) for (const density of ["compact", "comfortable", "spacious"]) for (const detail of ["titles", "status", "all"]) {
      env.size.preview({ zoom, text, density, detail });
      assert.deepEqual(env.mini(), { density, detail, text: String(text), zoom: String(Math.round((zoom / (applied * 100)) * 10000) / 10000) }, `${zoom}% ${text} ${density} ${detail}`);
      assert.equal(env.at("zoom").value, String(zoom));
      assert.equal(env.at("text").value, String(Math.round(text * 100)));
      assert.ok(env.at("mini").getAttribute("aria-label").startsWith("Preview of the window on sample data: "));
      assert.ok(env.at("mini").getAttribute("aria-label").includes(`${density} · ${detail === "status" ? "titles and status" : detail === "all" ? "everything" : "titles"}`));
      seen += 1;
    }
    assert.equal(seen, 4 * 7 * 3 * 3);
    assert.deepEqual(env.rootNow(), root, "after every one of them the root is as it was");
    assert.equal(env.writes.length + env.callsOf("uiZoom").length, 0);
    await env.size.apply();
    assert.equal(env.root.dataset.density, "spacious", "and Apply is when it reaches the root");
    assert.equal(env.root.dataset.detail, "all");
    assert.equal(env.rootVars()["--text-scale"], "1.4");
  }
});

test("the miniature is a picture of every region, on sample data it says it is, and nothing in it can be used", async () => {
  const env = await opened();
  const mini = env.at("mini");
  assert.equal(mini.getAttribute("role"), "img");
  assert.equal(mini.getAttribute("inert"), "");
  assert.equal(mini.inert, true);
  for (const part of ["sm-rail", "sm-list", "sm-main", "sm-top", "sm-tabs", "sm-thread", "sm-insp", "sm-status"]) assert.equal(mini.querySelectorAll(`.${part}`).length, 1, `the ${part} region is drawn`);
  assert.equal(mini.querySelectorAll(".sm-row").length, 5, "one row of each group, two running");
  assert.deepEqual(mini.querySelectorAll(".sm-gh").map((node) => node.textContent.replace(/\d+$/, "")), ["Needs you", "Running", "Review", "Done"]);
  assert.equal(mini.querySelectorAll("button, input, a, select, textarea").length, 0, "no control inside a picture");
  assert.equal(env.at("preview").querySelector(".size-sample").textContent, "Sample data");
  assert.ok(env.at("preview").querySelector(".size-cap").textContent.includes("Preview"));
  assert.deepEqual(env.calls.filter(([name]) => !["onUiZoom", "uiZoomGet", "go"].includes(name)), [], "it draws invented rows and reads nothing of the person's");
});

// ---- the state --------------------------------------------------------------------------------------
test("Apply is enabled only when the draft differs, and the page says plainly what is applied now", async () => {
  const env = await opened();
  const state = () => ({ apply: env.at("apply").disabled, discard: env.at("discard").hidden, label: env.at("state").textContent, dirty: env.at("state").getAttribute("data-dirty"), note: env.at("applied").textContent });
  assert.deepEqual(state(), { apply: true, discard: true, label: "This is what the window looks like now", dirty: null, note: "The window now: 100% · default text · comfortable · titles and status." });
  await env.choose("density", "spacious");
  assert.deepEqual(state(), { apply: false, discard: false, label: "Not applied yet", dirty: "", note: "Not applied yet. The window is still 100% · default text · comfortable · titles and status and this preview shows 100% · default text · spacious · titles and status." });
  await env.choose("density", "comfortable");
  assert.equal(state().apply, true, "put back by hand, it is the same as the window again");
  assert.equal(state().label, "This is what the window looks like now");
});

test("Apply puts the draft on the window, the page says so, and Undo puts it back", async () => {
  const env = await opened();
  await env.slide("text", 130);
  await env.choose("density", "compact");
  await env.choose("detail", "titles");
  await env.at("apply").click();
  await env.tick();
  assert.deepEqual(env.rootNow().dataset, { ...env.rootNow().dataset, density: "compact", detail: "titles", layout: "v2", shell: "rail", studioStyle: "studio", studioMaterial: "glass" });
  assert.equal(env.rootVars()["--text-scale"], "1.3");
  assert.equal(env.at("apply").disabled, true);
  assert.equal(env.at("discard").hidden, true);
  assert.equal(env.at("applied").textContent, "The window now: 100% · very large text · compact · titles.");
  assert.equal(env.toasts.at(-1).message, "Applied to the whole window: 100% · very large text · compact · titles.");
  assert.equal(env.mini().text, "1.3", "the miniature shows what the window has now, as it did a moment ago");
  env.toasts.at(-1).options.action.run();
  await env.tick();
  assert.deepEqual([env.root.dataset.density, env.root.dataset.detail, env.rootVars()["--text-scale"]], ["comfortable", "status", "1"]);
  assert.equal(env.at("text").value, "100", "and the controls follow the Undo");
  assert.equal(env.at("density").querySelectorAll("button")[1].getAttribute("aria-checked"), "true");
});

test("Reset puts the defaults on the window and Discard puts the window's own values back in the controls", async () => {
  const env = await opened({ stored: { ...OLD_STORE, v: 2, density: "compact", text: 1.3, detail: "all" }, zoom: 1.2 });
  assert.equal(env.at("zoom").value, "120");
  await env.slide("zoom", 90);
  await env.at("discard").click();
  assert.deepEqual([env.at("zoom").value, env.at("text").value], ["120", "130"], "Discard drops the draft");
  assert.equal(env.at("discard").hidden, true);
  assert.deepEqual(env.writes.length, 0);
  await env.at("reset").click();
  await env.tick();
  assert.deepEqual(plain(env.size.get()), DEFAULTS);
  assert.deepEqual([env.at("zoom").value, env.at("text").value, env.root.dataset.density, env.root.dataset.detail], ["100", "100", "comfortable", "status"]);
  assert.equal(env.toasts.at(-1).message, "Back to the defaults: 100%, default text, comfortable, titles and status.");
});

test("a scale the host refuses keeps the draft on the page, says why, and leaves Apply ready for another try", async () => {
  const env = await opened();
  await env.slide("zoom", 150);
  await env.choose("density", "spacious");
  env.host.failNext = "refuse";
  await env.at("apply").click();
  await env.tick();
  assert.equal(env.toasts.at(-1).message, "The window would not zoom.");
  assert.equal(env.at("apply").disabled, false);
  assert.equal(env.at("zoom").value, "150");
  assert.equal(env.root.dataset.density, "comfortable");
  await env.at("apply").click();
  await env.tick();
  assert.deepEqual([env.root.dataset.density, env.at("apply").disabled], ["spacious", true]);
});

test("leaving the page keeps an unapplied draft until you come back or discard it, and stores nothing", async () => {
  const env = await opened();
  await env.slide("text", 140);
  await env.choose("detail", "all");
  env.size.close();
  assert.deepEqual(plain(env.size.draft()), { ...DEFAULTS, text: 1.4, detail: "all" }, "closing is not applying and not discarding");
  assert.deepEqual([env.writes.length, env.root.dataset.detail], [0, "status"]);
  env.size.open({ focus: false });
  assert.deepEqual([env.at("text").value, env.at("apply").disabled, env.at("state").textContent], ["140", false, "Not applied yet"], "back on the page it is where it was left");
  assert.equal(env.mini().text, "1.4");
  const fresh = await loadSize({ stored: OLD_STORE });
  fresh.window.MefiSize.open({ focus: false });
  assert.equal(fresh.get("size-apply").disabled, true, "a new window starts without one: a draft is never stored");
  assert.equal([...env.storage.keys()].some((key) => /draft/i.test(key)), false);
});

test("a draft changed while the page is shut is shown when it opens, and one changed while it is open repaints at once", async () => {
  const env = await opened();
  env.size.close();
  env.size.preview({ density: "compact" });
  env.size.open({ focus: false });
  assert.equal(env.mini().density, "compact");
  env.size.preview({ density: "spacious" });
  assert.equal(env.mini().density, "spacious", "no repaint to ask for while it is open");
  env.size.close();
  const before = env.at("mini").dataset.miniDensity;
  env.size.preview({ density: "compact" });
  assert.equal(env.at("mini").dataset.miniDensity, before, "and nothing is drawn for a page nobody can see");
});

// ---- the keys ---------------------------------------------------------------------------------------------
test("the choices are a radio group: one stop for Tab, arrows and Home/End move the choice and the focus together", async () => {
  const env = await opened();
  const group = env.at("density");
  const buttons = () => group.querySelectorAll("button");
  assert.equal(group.getAttribute("role"), "radiogroup");
  assert.equal(group.getAttribute("aria-label"), "Density");
  assert.deepEqual(buttons().map((button) => [button.getAttribute("role"), button.getAttribute("tabindex")]), [["radio", "-1"], ["radio", "0"], ["radio", "-1"]], "the checked one is the tab stop");
  const press = async (key, target, extra = {}) => { const seen = { prevented: false }; await group.trigger("keydown", { key, target, preventDefault: () => { seen.prevented = true; }, ...extra }); return seen; };
  let event = await press("ArrowRight", buttons()[1]);
  assert.deepEqual([env.size.draft().density, event.prevented, buttons()[2].focused], ["spacious", true, true]);
  assert.deepEqual(buttons().map((button) => button.getAttribute("tabindex")), ["-1", "-1", "0"]);
  await press("ArrowRight", buttons()[2]);
  assert.equal(env.size.draft().density, "compact", "it wraps");
  await press("ArrowLeft", buttons()[0]);
  assert.equal(env.size.draft().density, "spacious");
  await press("Home", buttons()[2]);
  assert.equal(env.size.draft().density, "compact");
  await press("End", buttons()[0]);
  assert.equal(env.size.draft().density, "spacious");
  await press("ArrowUp", buttons()[2]);
  assert.equal(env.size.draft().density, "comfortable");
  await press("ArrowDown", buttons()[1]);
  assert.equal(env.size.draft().density, "spacious");
  event = await press("ArrowLeft", buttons()[2], { ctrlKey: true });
  assert.deepEqual([env.size.draft().density, event.prevented], ["spacious", false], "a chord is not ours");
  event = await press("a", buttons()[2]);
  assert.equal(event.prevented, false);
  const detail = env.at("detail");
  await detail.trigger("keydown", { key: "ArrowRight", target: detail.querySelectorAll("button")[1], preventDefault() {} });
  assert.equal(env.size.draft().detail, "all");
});

test("Ctrl+Enter applies from anywhere on the page, and only when there is something to apply", async () => {
  const env = await opened();
  const overlay = env.get("size-overlay");
  const press = async (extra) => { const seen = { prevented: false }; await overlay.trigger("keydown", { key: "Enter", preventDefault: () => { seen.prevented = true; }, ...extra }); await env.tick(); return seen; };
  assert.equal((await press({ ctrlKey: true })).prevented, false, "nothing to apply");
  assert.equal(env.writes.length, 0);
  await env.choose("density", "compact");
  assert.equal((await press({})).prevented, false, "Enter alone is the button's own");
  assert.equal((await press({ ctrlKey: true, shiftKey: true })).prevented, false);
  assert.equal((await press({ ctrlKey: true, altKey: true })).prevented, false);
  assert.equal(env.root.dataset.density, "comfortable");
  assert.equal((await press({ ctrlKey: true })).prevented, true);
  assert.equal(env.root.dataset.density, "compact");
  await env.choose("detail", "all");
  await press({ metaKey: true });
  assert.equal(env.root.dataset.detail, "all", "Cmd+Enter on a Mac");
});

test("the button that has just applied hands the keyboard to the first control instead of vanishing under it", async () => {
  const env = await opened();
  await env.choose("density", "compact");
  env.document.activeElement = env.at("apply");
  await env.size.apply();
  assert.equal(env.at("zoom").focused, true);
});

// ---- following the window ------------------------------------------------------------------------------------
test("Ctrl + and Ctrl - move the scale slider, the words and the picture's ratio while the page is open", async () => {
  const env = await opened();
  env.pushZoom(1.2);
  assert.equal(env.at("zoom").value, "120");
  assert.equal(env.at("zoom-out").textContent, "120%");
  assert.equal(env.at("applied").textContent, "The window now: 120% · default text · comfortable · titles and status.");
  assert.equal(env.at("apply").disabled, true, "it is the window's own change, not a draft");
  assert.equal(env.mini().zoom, "1", "and the picture is still what the window is");
  await env.slide("zoom", 150);
  assert.equal(env.mini().zoom, "1.25", "150% against the 120% the window has");
  env.pushZoom(1.4);
  assert.equal(env.at("zoom").value, "150", "a scale the person chose is not taken from them");
  assert.equal(env.mini().zoom, "1.0714");
});

test("a style preset chosen elsewhere moves the density the page shows", async () => {
  const env = await opened();
  env.window.MefiAppearance.apply({ preset: "focus" });
  assert.equal(env.at("density").querySelectorAll("button")[0].getAttribute("aria-checked"), "true");
  assert.equal(env.mini().density, "compact");
  assert.equal(env.at("apply").disabled, true);
});

// ---- the panels -------------------------------------------------------------------------------------------------------
test("the panels table is read-only and comes from MefiShell when it is there, and from the layout when it is not", async () => {
  const sizes = { list: 300, inspector: 420, tabs: 38, status: 28 };
  const shell = { mode: () => "vibe", size: (name) => sizes[name] };
  const env = await opened({ shell });
  env.computed.set("--shell-rail-w", "256px");
  env.size.close(); env.size.open({ focus: false });
  const table = () => env.at("panels").querySelectorAll("dt, dd").map((node) => node.textContent);
  assert.deepEqual(table(), ["List", "300 px", "Inspector", "420 px", "Tab strip", "38 px", "Status bar", "28 px", "Rail", "256 px"]);
  assert.equal(env.at("panels").parentNode.querySelector("small").textContent, "in Social");
  sizes.list = 0; sizes.tabs = 0;
  env.window.dispatchEvent({ type: "mefi:shell-layout" });
  assert.deepEqual(table().slice(0, 6), ["List", "closed", "Inspector", "420 px", "Tab strip", "off"], "it follows the shell while the page is open");
  assert.equal(env.at("panels").querySelectorAll("button, input").length, 0, "read-only: no control in the table");
  const bare = await opened();
  assert.deepEqual(bare.at("panels").querySelectorAll("dd").map((node) => node.textContent).slice(0, 4), ["280 px", "388 px", "38 px", "28 px"], "without MefiShell, what MefiNav.layout says");
  assert.equal(bare.at("panels").parentNode.querySelector("small").textContent, "");
});

test("a window too narrow for columns says the list and the inspector are drawers", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  env.window.MefiNav.layout.fold = () => ["list", "inspector"];
  env.window.MefiSize.open({ focus: false });
  const dd = env.get("size-panels").querySelectorAll("dd").map((node) => node.textContent);
  assert.deepEqual(dd.slice(0, 4), ["a drawer in this window", "a drawer in this window", "38 px", "28 px"]);
});

// ---- fitting the picture --------------------------------------------------------------------------------------------------
test("the picture is shrunk to fit its column, never taller than a share of the pane, and never outside 0.2 to 1.25", async () => {
  const env = await opened();
  const fit = () => { env.flushFrames(); return env.at("mini").style.getPropertyValue("--mini-fit"); };
  const body = env.at("body"), side = env.at("preview");
  // A wide page: the picture's column is 500 px and the pane 700 px tall.
  Object.assign(body, { clientWidth: 1300, clientHeight: 700 }); side.clientWidth = 500;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), String(Math.round((500 / 760) * 10000) / 10000), "width is the limit");
  side.clientWidth = 900; body.clientHeight = 500;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), String(Math.round(((500 * 0.62) / 440) * 10000) / 10000), "height is the limit");
  side.clientWidth = 5000; body.clientHeight = 5000;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), "1.25");
  side.clientWidth = 40;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), "0.2");
  // A one-column page keeps the picture in view, so it is smaller.
  Object.assign(body, { clientWidth: 400, clientHeight: 440 }); side.clientWidth = 380;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), String(Math.round(((440 * 0.36) / 440) * 10000) / 10000));
  // A short window does not keep it, so it may take more of the pane.
  env.window.innerHeight = 373; body.clientHeight = 200;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), String(Math.round(((200 * 0.6 > 96 ? 200 * 0.6 : 96) / 440) * 10000) / 10000));
  // Short is what the stylesheet says it is: max-height: 520px includes 520.
  env.window.innerHeight = 520;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), "0.2727", "520 px is short, as the media query has it");
  env.window.innerHeight = 521;
  env.window.dispatchEvent({ type: "resize" });
  assert.equal(fit(), "0.2182", "521 px is not");
});

test("the picture is fitted again when its own column changes size, not only when the window does", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const made = [];
  env.context.ResizeObserver = class { constructor(callback) { this.callback = callback; this.seen = []; this.gone = false; made.push(this); } observe(node) { this.seen.push(node); } disconnect() { this.gone = true; } };
  env.window.MefiSize.open({ focus: false });
  env.flushFrames();
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].seen, [env.get("size-preview")], "it watches the picture's column");
  env.frames.length = 0;
  made[0].callback();
  made[0].callback();
  assert.equal(env.frames.length, 1, "and one fit comes of however many changes");
  env.window.MefiSize.close();
  assert.equal(made[0].gone, true, "it stops watching when the page is shut");
  env.window.MefiSize.open({ focus: false });
  assert.equal(made.length, 2);
});

test("a resize is fitted once a frame, however many arrive", async () => {
  const env = await opened();
  env.flushFrames();
  for (let turn = 0; turn < 10; turn += 1) env.window.dispatchEvent({ type: "resize" });
  assert.equal(env.frames.length, 1);
});

// ---- the way in --------------------------------------------------------------------------------------------------------------
test("Configuration files the row under UI & Surfaces, and picking it opens the page", async () => {
  const env = await loadSize({ stored: OLD_STORE });
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("config-")) });
  get("config-overlay").hidden = true;
  const window = { mefiStudio: {}, MefiNav: env.window.MefiNav, MefiToast: () => {} };
  vm.runInContext(await read("renderer/config-dialog.js"), vm.createContext({ window, document, console, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {} }));
  const rows = window.MefiConfig.records().filter((row) => row.id === "settings:size");
  assert.deepEqual(plain(rows.map((row) => ({ title: row.title, where: row.where, category: row.category }))), [{ title: "Size and density", where: "Settings › Appearance", category: "ui" }]);
  await window.MefiConfig.open({ category: "ui" });
  const item = get("config-pane").querySelectorAll(".config-item").find((node) => node.querySelector(".config-item-title")?.textContent === "Size and density");
  assert.ok(item, "it is in the UI & Surfaces pane");
  item.click();
  assert.deepEqual(env.calls.filter(([name]) => name === "go").at(-1)?.slice(0, 2), ["go", "size"]);
  assert.equal(env.get("size-overlay").hidden, false);
});

test("Settings > Appearance points at the page instead of keeping a Density list of its own", async () => {
  const env = await loadSize({ stored: { ...OLD_STORE, density: "compact" }, densityRow: true });
  const field = env.densityField;
  assert.equal(field.hidden, true, "the old row is out of the way");
  const link = field.parentNode.children[1];
  assert.equal(link.getAttribute("data-size-link"), "row");
  assert.equal(link.querySelector("span").textContent, "Size and density");
  assert.equal(link.querySelector(".size-aside").textContent, "100% · default text · compact · titles and status");
  await env.window.MefiSize.apply({ text: 1.2, density: "spacious" });
  assert.equal(link.querySelector(".size-aside").textContent, "100% · large text · spacious · titles and status".replace("large", "larger"), "it says what it is now");
  link.querySelector("button").click();
  assert.deepEqual(env.calls.filter(([name]) => name === "go").at(-1)?.slice(0, 2), ["go", "size"]);
  assert.equal(field.parentNode.children.length, 2, "one link row, however many times it is asked for");
  const v1 = await loadSize({ layout: null, densityRow: true });
  assert.equal(v1.densityField.hidden, false, "where the layout is v1 the Density list is exactly what it was");
  assert.equal(v1.densityField.parentNode.children.length, 1);
});

// ---- the small edits that carry it ------------------------------------------------------------------------------------------------
test("Size and density is a page of Settings: Back with no history goes to Settings, and Settings stays lit", async () => {
  const source = await read("renderer/nav.js");
  const calls = [];
  const dests = new Map([["size", { id: "size", section: "settings" }], ["worktrees", { id: "worktrees", section: "work" }], ["skills", { id: "skills", section: "agents" }]]);
  const sections = { size: "settings", worktrees: "work", skills: "agents" };
  const document = { documentElement: { dataset: { shell: "rail" } } };
  const env = vm.createContext({ document, get: (id) => dests.get(id), current: () => "size", historyState: () => ({ canBack: false }), back: () => calls.push("back"), vibeMode: () => false, sectionOf: (dest) => sections[dest?.id], placeOf: (dest) => sections[dest?.id], go: (id) => calls.push(id) });
  vm.runInContext(source.slice(source.indexOf("  const WORKSPACE_PAGES"), source.indexOf("  function syncPageInert")), env);
  vm.runInContext(source.slice(source.indexOf("  function close(id)"), source.indexOf("  function closeAll()")), env);
  env.close("size");
  env.current = () => "worktrees"; env.close("worktrees");
  env.current = () => "skills"; env.close("skills");
  assert.deepEqual(calls, ["studio", "tasks", "agents"], "each section's own home");
  calls.length = 0;
  env.historyState = () => ({ canBack: true }); env.current = () => "size"; env.close("size");
  assert.deepEqual(calls, ["back"], "with history it is history, like the other pages");

  // the rail: Settings' own item is lit on it, as a section's head is lit on the section's pages
  const item = (nav, head = false) => { const node = { dataset: head ? { section: nav } : { nav }, attrs: {}, classList: { contains: () => head, toggle() {} }, setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; } }; return node; };
  const studio = item("studio"), tasks = item("palette");
  const rail = { hidden: false, querySelectorAll: (selector) => (selector.includes("app-rail-head") ? [studio, tasks] : []), contains: () => true };
  const railEnv = vm.createContext({ document: { getElementById: () => rail, activeElement: null }, current: () => "size", sectionOf: () => "settings", placeOf: () => "settings", get: () => ({}), paintLocalNav() {}, paintRecentTasks() {}, setRailStop() {}, restingStop() {} });
  vm.runInContext(source.slice(source.indexOf("  function paintRail() {"), source.indexOf("  // The rail is one tab stop")) + "\npaintRail();", railEnv);
  assert.equal(studio.attrs["aria-current"], "page");
  assert.equal(tasks.attrs["aria-current"], undefined);
});

test("the template carries the page's shell and its glyph, the way a page of Work or Agents does", async () => {
  const template = await read("renderer/booklet.template.html");
  assert.match(template, /<div class="overlay explorer" id="size-overlay" hidden>\s*<div class="explorer-sheet size-sheet" role="dialog" aria-modal="true" aria-labelledby="size-heading" tabindex="-1">/);
  for (const id of ["size-heading", "size-close", "size-body"]) assert.ok(template.includes(`id="${id}"`), id);
  assert.match(template, /data-nav-close="size"/, "Back goes through the navigation");
  assert.match(template, /<symbol id="g-textsize" viewBox="0 0 16 16">/);
  assert.match(template, /<div class="eyebrow">Settings<\/div>\s*<h2 id="size-heading">Size and density<\/h2>/);
});

test("the build inlines the script after the Configuration dialog and the stylesheet with the others, in the same places", async () => {
  const { scripts, styles } = parseBookletInputs(await read("scripts/build-booklet.mjs"));
  assert.ok(scripts.includes("size.js") && styles.includes("size.css"));
  assert.equal(scripts.indexOf("size.js"), scripts.indexOf("config-dialog.js") + 1);
  assert.ok(scripts.indexOf("size.js") > scripts.indexOf("idle.js"), "after idle, which the updater pins");
  assert.equal(styles.indexOf("size.css"), styles.indexOf("skills.css") + 1, "directly after the skills stylesheet");
});
