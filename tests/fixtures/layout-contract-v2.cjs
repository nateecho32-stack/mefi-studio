"use strict";

// The v2 half of the layout contract fixture (tests/fixtures/layout-contract-electron.cjs
// runs it after v1 has matched its record). The regions are built by later work,
// so what stands where they will be is fixture-only: four translucent boxes placed
// the way docs/unified-studio.md says a region is placed, from the same
// variables the layers read. With them up (list 280, inspector 400, tab strip 36,
// status bar 28, the sample values the contract is tested with):
//
//   * every page, sheet and view is the v1 box moved in by exactly the regions'
//     sizes and never overlaps a region or leaves the window; a sheet's own
//     box stays between the list and the inspector;
//   * the free area (MefiNav.usable()) is clear of all four, and the toasts, the
//     media window, the companion's orb and panel, and a select's list stay inside it;
//   * a window under 900 CSS px (the smallest, 600x560 at 150%, is about 400)
//     folds the list and the inspector to nothing and tells html[data-layout-fold];
//   * nothing gets a page scrollbar or a native one;
//   * and turning v2 off gives the recorded v1 back.
const assert = require("node:assert/strict");

const SAMPLE = { list: 280, inspector: 400, tabs: 36, status: 28 };

const REGION_CSS = `
.fx-region { position: fixed; z-index: 300; box-sizing: border-box; overflow: hidden; pointer-events: none; display: none; align-items: center; justify-content: center; color: #fff; font: 700 12px/1 system-ui; letter-spacing: .06em; text-transform: uppercase; }
.fx-region[data-on] { display: flex; }
#fx-list { background: rgba(70, 140, 255, .34); border-right: 2px solid rgb(70, 140, 255); }
#fx-inspector { background: rgba(255, 170, 60, .34); border-left: 2px solid rgb(255, 170, 60); }
#fx-tabs { background: rgba(80, 220, 120, .34); border-bottom: 2px solid rgb(80, 220, 120); }
#fx-status { background: rgba(255, 80, 130, .34); border-top: 2px solid rgb(255, 80, 130); }
`;

// Runs in the page. Places the four boxes from the live variables: the list right of the
// rail that is on screen (Vibe's own home has none), the tab strip under the local
// navigation (there is none on Vibe's home either) and right of the list, the inspector
// under the strip, the status bar along the bottom. Returns each box as [left, top, width, height].
function placeRegions() {
  const root = document.documentElement, style = getComputedStyle(root);
  const length = (name, from = style) => parseFloat(from.getPropertyValue(name)) || 0;
  const on = (node) => { const box = node && node.getBoundingClientRect(); return Boolean(box && box.width > 0 && box.height > 0); };
  const round = (value) => Math.round(value * 100) / 100;
  const size = { list: length("--shell-list-w"), inspector: length("--shell-inspector-w"), tabs: length("--shell-tabs-h"), status: length("--shell-status-h") };
  const rest = on(document.getElementById("app-rail")) || on(document.getElementById("vibe-rail")) ? length("--shell-rail-w") : 0;
  const top = on(document.getElementById("app-local-nav")) ? length("--shell-local-h", getComputedStyle(document.body)) : 0;
  const put = (id, box, enough) => {
    const node = document.getElementById(id);
    Object.assign(node.style, { left: "auto", right: "auto", top: "auto", bottom: "auto", width: "auto", height: "auto", ...Object.fromEntries(Object.entries(box).map(([key, value]) => [key, `${value}px`])) });
    node.toggleAttribute("data-on", enough);
    const rect = node.getBoundingClientRect();
    return enough && rect.width > 0 && rect.height > 0 ? [round(rect.left), round(rect.top), round(rect.width), round(rect.height)] : null;
  };
  return {
    list: put("fx-list", { left: rest, top: 0, bottom: size.status, width: size.list }, size.list > 0),
    tabs: put("fx-tabs", { left: rest + size.list, right: 0, top, height: size.tabs }, size.tabs > 0),
    inspector: put("fx-inspector", { right: 0, top: top + size.tabs, bottom: size.status, width: size.inspector }, size.inspector > 0),
    status: put("fx-status", { left: 0, right: 0, bottom: 0, height: size.status }, size.status > 0),
  };
}

const overlap = (a, b) => a[0] < b[0] + b[2] - 0.5 && a[0] + a[2] > b[0] + 0.5 && a[1] < b[1] + b[3] - 0.5 && a[1] + a[3] > b[1] + 0.5;
const near = (a, b) => Math.abs(a - b) <= 0.51;
const sizesOf = (regions) => ({ L: regions?.list?.[2] ?? 0, I: regions?.inspector?.[2] ?? 0, T: regions?.tabs?.[3] ?? 0, S: regions?.status?.[3] ?? 0 });
// Where a box of v1 is in v2: a page moves in on all four sides, a sheet over it everywhere but the top, where it still covers the strips.
const moved = (box, { L, I, T, S }, page) => (page ? [box[0] + L, box[1] + T, box[2] - L - I, box[3] - T - S] : [box[0] + L, box[1], box[2] - L - I, box[3] - S]);
const fmt = (value) => JSON.stringify(value);

module.exports = async function v2({ window, contents, run, until, capture, resize, setup, recorded, report, sleep, differences, configs }) {
  report.v2 = { checked: false, configs: {}, dynamic: {}, shots: [] };
  const inner = () => run("return [innerWidth, innerHeight];");
  // Which sheet is "over Home" depends on how the window came to be in its mode (Vibe's layer is entered by going Home, and
  // nothing that closes a sheet goes back), and the record was made by a walk that followed the walk of the other mode, at the
  // same size, on Build's Home. Every walk here starts from that state: Build on its Home, then the mode asked for.
  const arrive = async ({ mode, rail }) => {
    await setup({ mode: "build", rail: "closed" });
    await run("await window.MefiNav.go('workspace');");
    await until("document.body.classList.contains('workspace-active')", "Build's Home is up");
    await sleep(150);
    if (mode !== "build") await setup({ mode, rail });
  };
  const home = async () => { await run("await window.MefiNav.go('workspace');"); await until("document.body.classList.contains('vibe-active') || document.body.classList.contains('workspace-active')", "Home is up"); await sleep(150); };
  const layers = await run("return Object.fromEntries(window.MefiNav.list().filter((record) => record.layer && record.element).map((record) => [record.id, record.layer]));");

  // ---- the boxes that stand for the regions ---------------------------------
  await run(`
    const css = document.createElement("style"); css.id = "fx-style"; css.textContent = ${JSON.stringify(REGION_CSS)}; document.head.append(css);
    for (const [id, text] of [["fx-list", "session list"], ["fx-inspector", "inspector"], ["fx-tabs", "tab strip"], ["fx-status", "status bar"]]) {
      const node = document.createElement("div"); node.id = id; node.className = "fx-region"; node.textContent = text; document.body.append(node);
    }
    window.__placeRegions = ${placeRegions.toString()};
    window.__layoutRegions = window.__placeRegions;
    // A person scrolls the page only when the viewport's overflow allows it (the root's own value, or the body's when the root leaves it
    // visible) and there is more to see. Home, Command and Vibe hide the page's overflow and keep the menu and the tab pages laid out
    // but invisible behind them, so the document's scrollHeight there is an extent nobody can scroll to.
    window.__layoutProbe = () => {
      const de = document.documentElement, root = getComputedStyle(de), source = root.overflowY === "visible" ? getComputedStyle(document.body) : root;
      const body = getComputedStyle(document.body);
      return { scroll: [de.scrollWidth, de.scrollHeight], inner: [innerWidth, innerHeight], route: window.MefiNav.current(), uiMode: de.dataset.uiMode, userScrollsY: !["hidden", "clip"].includes(source.overflowY) && de.scrollHeight > innerHeight + 1,
        vars: { shell: de.dataset.shell, pinned: "railPinned" in de.dataset, drawer: "railDrawer" in de.dataset, rail: root.getPropertyValue("--shell-rail-w").trim(), bodyRail: body.getPropertyValue("--shell-rail-w").trim(), x0: root.getPropertyValue("--shell-x0").trim(), bodyX0: body.getPropertyValue("--shell-x0").trim(), list: root.getPropertyValue("--shell-list-w").trim(), bodyClass: document.body.className, page: [...document.querySelectorAll(".workspace-page:not([hidden])")].map((node) => node.id), overlays: [...document.querySelectorAll(".overlay:not([hidden]), .profiler-overlay:not([hidden])")].map((node) => node.id) } };
    };
  `);

  // ---- the writer, live: v1 -> v2, sample values ----------------------------
  await resize([1920, 1080, 1]); await setup({ mode: "build", rail: "closed" });
  assert.equal(await run("return window.MefiNav.layout.on();"), false, "the fixture starts in v1");
  assert.equal(await run("return window.MefiNav.layout.set('list', 280);"), 0, "the setter does nothing in v1");
  const inline = () => run("return ['--shell-list-w', '--shell-inspector-w', '--shell-tabs-h', '--shell-status-h'].map((name) => document.documentElement.style.getPropertyValue(name)).join('');");
  assert.equal(await inline(), "", "and writes none of the four variables");
  assert.equal(await run("return window.MefiNav.setLayout('v2');"), true);
  assert.equal(await run("return document.documentElement.dataset.layout + '/' + document.documentElement.dataset.shell;"), "v2/rail", "data-shell keeps its one value");
  assert.equal(await run("return localStorage.getItem('mefiStudio.layout');"), "v2", "the choice is saved");
  const setSample = () => run(`for (const [name, value] of Object.entries(${JSON.stringify(SAMPLE)})) window.MefiNav.layout.set(name, value); return window.MefiNav.layout.used();`);
  assert.deepEqual(await setSample(), SAMPLE, "a wide window takes the sample as asked");
  assert.equal(await run("return window.MefiNav.layout.set('list', 9999) + ',' + window.MefiNav.layout.set('inspector', 9999) + ',' + window.MefiNav.layout.set('tabs', 9999) + ',' + window.MefiNav.layout.set('status', 9999);"), "420,640,48,40", "the ranges hold in a real window");
  await setSample();

  // ---- what a window of each size and mode gives -------------------------------
  const restOf = (mode, rail, width) => (mode === "vibe" ? 72 : rail === "pinned" && width >= 1100 ? 256 : 64);
  const expectedSizes = (mode, rail, width) => {
    const folded = width < 900;
    const room = Math.max(0, width - restOf(mode, rail, width) - 320);
    const list = folded ? 0 : Math.min(SAMPLE.list, room);
    return { list, inspector: folded ? 0 : Math.min(SAMPLE.inspector, room - list), tabs: SAMPLE.tabs, status: SAMPLE.status, folded };
  };
  const scrollbars = () => run(`return [...document.querySelectorAll("body *")].filter((node) => node.getClientRects().length && !node.closest("[hidden]") && !node.closest("#fx-list, #fx-inspector, #fx-tabs, #fx-status") && /(auto|scroll)/.test(getComputedStyle(node).overflowY + " " + getComputedStyle(node).overflowX)).filter((node) => getComputedStyle(node).scrollbarWidth !== "none" || node.offsetWidth - node.clientWidth - parseFloat(getComputedStyle(node).borderLeftWidth) - parseFloat(getComputedStyle(node).borderRightWidth) > 1).map((node) => node.id || node.className);`);

  const LIGHT = { only: ["tasks", "agents", "palette", "appearancePreview"], tabs: ["studio", "booklet"] };
  const plan = [
    // [size, mode, full walk?]
    [[1440, 900, 1], "build", true], [[600, 560, 1.5], "vibe", true],
    [[1920, 1080, 1], "build", false], [[1920, 1080, 1], "vibe", false], [[1440, 900, 1], "vibe", false],
    [[1100, 720, 1], "build", false], [[1100, 720, 1], "vibe", false], [[600, 560, 1.5], "build", false],
  ];
  const label = ([width, height, zoom]) => `${width}x${height}@${zoom}`;
  // MEFI_LAYOUT_V2_ONLY=1920x1080@1/build,600x560@1.5/vibe narrows the walk while debugging (never for the gate).
  const narrowed = (process.env.MEFI_LAYOUT_V2_ONLY || "").split(",").filter(Boolean);

  for (const [size, mode, full] of plan) {
    if (narrowed.length && !narrowed.includes(`${label(size)}/${mode}`)) continue;
    await resize(size);
    await arrive({ mode, rail: "closed" });
    await setSample();
    const width = (await inner())[0];
    const tag = `${label(size)}/${mode}`;
    const walked = await run(`return await window.__layoutWalk(${JSON.stringify({ rails: ["closed", "pinned"], ...(full ? {} : LIGHT) })});`);
    report.v2.configs[tag] = { timing: walked.timing.total };
    assert.deepEqual(report.errors, [], `${tag}: ${JSON.stringify(report.errors)}`);
    for (const rail of ["closed", "pinned"]) {
      const at = `${tag}/${rail}`, now = walked.out[rail], was = recorded[at];
      assert.ok(was, `${at} was recorded in v1`);
      const { folded, ...wanted } = expectedSizes(mode, rail, width);
      const got = sizesOf(now.regions);
      assert.deepEqual({ L: got.L, I: got.I, T: got.T, S: got.S }, { L: wanted.list, I: wanted.inspector, T: wanted.tabs, S: wanted.status }, `${at}: the regions' boxes are the variables' (folded: ${folded})`);
      assert.equal(!now.overflow.x, true, `${at}: no sideways page scroll`);
      // Home (and Vibe's, and Command) keep the page from scrolling; what is laid out invisibly behind them may be taller than the window.
      assert.equal(now.probe.userScrollsY, false, `${at}: a vertical page scroll a person could use (v1 had ${was.overflow.y ? "one" : "none"}): ${fmt(now.probe)}`);
      const W = now.viewport[0], H = now.viewport[1];
      const regions = now.regions;
      const fits = (box, what) => assert.ok(box[0] >= -0.51 && box[1] >= -0.51 && box[0] + box[2] <= W + 0.51 && box[1] + box[3] <= H + 0.51, `${at}: ${what} leaves the window: ${fmt(box)} in ${W}x${H}`);
      const clear = (box, what, regionsAt = regions, strips = true) => {
        // A box with no room left (the Appearance stage, squeezed to nothing between its editor and the inspector) is not on screen.
        if (box[2] <= 0.5 || box[3] <= 0.5) return;
        for (const [name, region] of Object.entries(regionsAt || {})) {
          if (!region || (!strips && name === "tabs")) continue;
          assert.ok(!overlap(box, region), `${at}: ${what} ${fmt(box)} overlaps the ${name} ${fmt(region)}`);
        }
      };
      const between = (kid, regionsAt, what) => {
        const list = regionsAt?.list, inspector = regionsAt?.inspector;
        assert.ok(!list || kid[0] >= list[0] + list[2] - 0.51, `${at}: ${what} starts inside the list`);
        assert.ok(!inspector || kid[0] + kid[1] <= inspector[0] + 0.51, `${at}: ${what} runs under the inspector`);
      };
      // pages and sheets: the v1 box moved in by the regions, nothing more
      for (const [key, page] of Object.entries(now.pages)) {
        const base = key.split("@")[0], before = was.pages[key];
        assert.ok(page && before, `${at}: ${key} opened in v2 as it did in v1`);
        const isPage = before.box[1] > 0;
        const sheet = layers[base] === "transient" || base === "setup-helper";
        const want = moved(before.box, sizesOf(page.regions), isPage);
        assert.deepEqual(page.box.map((value) => Math.round(value)), want.map((value) => Math.round(value)), `${at}: ${key} is the v1 box ${fmt(before.box)} moved in by ${fmt(sizesOf(page.regions))} (${fmt(page.probe?.vars)})`);
        fits(page.box, key);
        clear(page.box, key, page.regions, !sheet || isPage);
        for (const kid of page.kids) between(kid, page.regions, `${key}'s sheet`);
        assert.equal(fmt(page.kids.length), fmt(before.kids.length), `${at}: ${key} has the sheets it had`);
      }
      // Home, Vibe's own home and Command
      for (const [name, key, regionsAt] of [["home", "home", now.views.home?.regions], ["home", "vibe", now.views.home?.regions], ["command", "hud", now.views.command?.regions]]) {
        const box = now.views[name]?.[key], before = was.views[name]?.[key];
        assert.equal(Boolean(box), Boolean(before), `${at}: ${name}.${key} is there in v2 as in v1`);
        if (!box) continue;
        assert.deepEqual(box.map(Math.round), moved(before, sizesOf(regionsAt), true).map(Math.round), `${at}: ${name}.${key} is the v1 box moved in`);
        fits(box, `${name}.${key}`); clear(box, `${name}.${key}`, regionsAt);
      }
      assert.deepEqual(now.views.command.canvas, was.views.command.canvas, `${at}: the Command canvas stays full-bleed under everything`);
      // tab pages flow between the regions: v1's padding plus their sizes
      for (const [id, tab] of Object.entries(now.tabs)) {
        const before = was.tabs[id];
        assert.ok(tab && before, `${at}: the ${id} tab is there`);
        const s = sizesOf(tab.regions);
        assert.deepEqual(tab.body.map(Math.round), [before.body[0] + s.L, before.body[1] + s.I, before.body[2] + s.T, before.body[3] + s.S].map(Math.round), `${at}: the ${id} tab's padding is v1's plus the regions'`);
        between([tab.x[0], tab.x[1]], tab.regions, `the ${id} tab`);
      }
      // the free area: clear of all four, and as roomy as the chrome allows: right of the rail that is on screen and the list,
      // under the local navigation that is on screen and the strip, left of the inspector, above the status bar
      for (const [name, chrome] of [["page", now], ["home", now.views.home], ["command", now.views.command]]) {
        const free = chrome.usable, regionsAt = chrome.regions, s = sizesOf(regionsAt);
        const rest = chrome.rail ? chrome.rail[0] + chrome.rail[2] : chrome.vibeRail ? chrome.vibeRail[0] + chrome.vibeRail[2] : 0;
        const bar = chrome.localNav ? chrome.localNav[1] + chrome.localNav[3] : 0;
        assert.ok(near(free[0], rest + s.L), `${at}: usable().left on ${name} is the rail on screen (${rest}) and the list (${s.L}): ${fmt(free)}`);
        assert.ok(near(free[1], bar + s.T), `${at}: usable().top on ${name} is the local navigation on screen (${bar}) and the strip (${s.T}): ${fmt(free)}`);
        assert.ok(near(free[2], W - s.I), `${at}: usable().right on ${name} is the window minus the inspector: ${fmt(free)}`);
        assert.ok(near(free[3], H - s.S), `${at}: usable().bottom on ${name} is the window minus the status bar: ${fmt(free)}`);
        clear([free[0], free[1], free[2] - free[0], free[3] - free[1]], `usable() on ${name}`, regionsAt);
      }
      // toasts, the coach and the Appearance editor sit in the free area too
      const s = sizesOf(now.regions);
      for (const [name, toasts, regionsAt] of [["home", now.views.home.toasts, now.views.home.regions], ["command", now.views.command.toasts, now.views.command.regions], ["appearance", now.computed.appearance?.toasts, now.regions], ["music", now.computed.musicToasts, now.regions]]) {
        if (!toasts) continue;
        const r = sizesOf(regionsAt);
        assert.ok(toasts[0] >= r.L + (name === "home" && mode === "vibe" ? 0 : 0) - 0.51, `${at}: the toast stack on ${name} starts right of the list: ${fmt(toasts)}`);
        assert.ok(toasts[1] >= r.S - 0.51, `${at}: the toast stack on ${name} rises above the status bar: ${fmt(toasts)}`);
      }
      assert.ok(parseFloat(now.computed.coach.right) >= s.I + 12 - 0.51 && parseFloat(now.computed.coach.bottom) >= s.S + 12 - 0.51, `${at}: the coach keeps to the free area's corner: ${fmt(now.computed.coach)}`);
      assert.ok(parseFloat(now.computed.profilerHud.right) >= s.I + 20 - 0.51 && parseFloat(now.computed.profilerHud.bottom) >= s.S + 18 - 0.51, `${at}: the profiler's pill too`);
      if (now.computed.appearance) {
        const editor = now.computed.appearance;
        fits(editor.studio, "the Appearance editor"); clear(editor.studio, "the Appearance editor", now.regions);
        fits(editor.stage, "the Appearance stage"); clear(editor.stage, "the Appearance stage", now.regions);
      }
      if (now.computed.probes) {
        for (const name of ["agentStep1", "agentStep2"]) between(now.computed.probes[name], now.regions, `the ${name} sheet`);
        if (now.computed.probes.gitSheet) between([now.computed.probes.gitSheet[0], now.computed.probes.gitSheet[2]], now.regions, "the Git sheet");
      }
    }
    // The fold: what the stylesheet and the script say agree, at the window's real size.
    const state = await run("return { fold: document.documentElement.dataset.layoutFold ?? null, folds: window.MefiNav.layout.fold(), list: getComputedStyle(document.documentElement).getPropertyValue('--shell-list-w').trim(), inspector: getComputedStyle(document.documentElement).getPropertyValue('--shell-inspector-w').trim(), used: window.MefiNav.layout.used(), asked: window.MefiNav.layout.get() };");
    assert.deepEqual(state.asked, SAMPLE, `${tag}: what was asked for is kept`);
    if (width < 900) {
      assert.equal(state.fold, "list inspector", `${tag}: html carries data-layout-fold`);
      assert.deepEqual(state.folds, ["list", "inspector"]);
      assert.equal(state.list, "0px", `${tag}: the list computes to 0`); assert.equal(state.inspector, "0px", `${tag}: and the inspector`);
      assert.deepEqual(state.used, { list: 0, inspector: 0, tabs: SAMPLE.tabs, status: SAMPLE.status }, `${tag}: the strips keep their height`);
      // The stylesheet's fold is the geometry, not the script's answer to it: a width written inline (as set() writes them) counts for nothing below 900.
      const stray = await run("const root = document.documentElement, read = (name) => getComputedStyle(root).getPropertyValue(name).trim(); root.style.setProperty('--shell-list-w', '280px'); root.style.setProperty('--shell-inspector-w', '400px'); const seen = [read('--shell-list-w'), read('--shell-inspector-w')]; root.style.removeProperty('--shell-list-w'); root.style.removeProperty('--shell-inspector-w'); return seen;");
      assert.deepEqual(stray, ["0px", "0px"], `${tag}: the fold in styles.css zeroes the two columns whatever is written inline`);
    } else {
      assert.equal(state.fold, null, `${tag}: a window of ${width} folds nothing`);
      assert.deepEqual(state.folds, []);
    }
    // Every page of this window, without a scrollbar of its own or the page's.
    await run("await window.MefiNav.go('tasks');"); await sleep(250);
    assert.deepEqual(await scrollbars(), [], `${tag}: no native scrollbar on Tasks`);
    await run("await window.MefiNav.go('studio'); await new Promise((resolve) => setTimeout(resolve, 200));");
    assert.deepEqual(await scrollbars(), [], `${tag}: none on Settings`);
    assert.equal(await run("return document.documentElement.scrollWidth <= innerWidth + 1;"), true, `${tag}: no sideways scroll on the page`);
    await run("await window.MefiNav.go('workspace');");
    report.v2.configs[tag].checked = true;
  }
  report.v2.widths = plan.map(([size, mode]) => `${label(size)}/${mode}`);

  // ---- floating things stay inside the free area ---------------------------------
  report.v2.dynamic.done = await require("./layout-contract-floats.cjs")({ window, contents, run, until, capture, resize, setup, home, report, sleep, SAMPLE, overlap, near, fmt, restOf, expectedSizes, label });

  // ---- pictures of the contract, for a person to look at -------------------------
  const shots = [
    [[1440, 900, 1], "build", "closed", "tasks", "v2-build-1440-tasks.png"],
    [[1440, 900, 1], "build", "pinned", "workspace", "v2-build-1440-home-pinned.png"],
    [[1440, 900, 1], "vibe", "closed", "workspace", "v2-vibe-1440-home.png"],
    [[1440, 900, 1], "vibe", "closed", "agents", "v2-vibe-1440-agents.png"],
    [[1100, 720, 1], "build", "pinned", "command", "v2-build-1100-command-pinned.png"],
    [[1920, 1080, 1], "build", "closed", "studio", "v2-build-1920-settings.png"],
    [[600, 560, 1.5], "build", "closed", "tasks", "v2-build-600-fold.png"],
    [[600, 560, 1.5], "vibe", "closed", "workspace", "v2-vibe-600-home.png"],
  ];
  for (const [size, mode, rail, route, name] of shots) {
    await resize(size); await setup({ mode, rail }); await home(); await setSample();
    await run(`await window.MefiNav.go(${JSON.stringify(route)}); window.__placeRegions(); await new Promise((resolve) => setTimeout(resolve, 500));`);
    await run("window.__placeRegions();");
    await capture(name);
    report.v2.shots.push(name);
  }

  // ---- turning v2 off puts v1 back, to the hundredth of a pixel ----------------------
  await resize([1440, 900, 1]); await arrive({ mode: "build", rail: "closed" });
  assert.equal(await run("return window.MefiNav.setLayout('v1');"), false);
  assert.equal(await run("return document.documentElement.dataset.layout ?? null;"), null);
  assert.equal(await run("return document.documentElement.dataset.layoutFold ?? null;"), null);
  assert.equal(await inline(), "", "the inline variables are gone");
  assert.equal(await run("return localStorage.getItem('mefiStudio.layout');"), "v1");
  await run("for (const id of ['fx-list', 'fx-inspector', 'fx-tabs', 'fx-status']) document.getElementById(id).remove(); document.getElementById('fx-style')?.remove(); delete window.__layoutRegions; delete window.__layoutProbe; delete window.__placeRegions;");
  const again = await run("return await window.__layoutWalk({ rails: ['closed', 'pinned'] });");
  for (const rail of ["closed", "pinned"]) {
    const gone = differences(again.out[rail], recorded[`1440x900@1/build/${rail}`]);
    assert.deepEqual(gone, [], `v1 after v2 differs from the record (${rail}):\n${gone.join("\n")}`);
  }
  report.v2.backToV1 = true;
  report.v2.checked = true;
};
