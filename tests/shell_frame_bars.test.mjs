// The frame's two bars (renderer/shell.js): the top bar's list toggle, Vibe | Build
// radiogroup, trail, Search pill, "N need you" and "N working" pills and inspector
// toggle; the status bar's Layout menu, what is running, what waits and the real
// data on its right; and the feed that paints them without a timer of its own.
// The modules the bars ask are stand-ins (tests/fixtures/shell-vm.mjs); an item
// nobody has data for must not be there.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadShell, plain } from "./fixtures/shell-vm.mjs";

// The script is too long to print when a pattern it must not hold is found: say where.
const absent = (text, pattern, message) => { const found = pattern.exec(text); assert.ok(!found, `${message}: found ${JSON.stringify(found?.[0])} at ${found?.index}`); };
const snap = (extra = {}) => ({ projectId: "p1", project: { name: "Fixture" }, status: { running: [] }, assistant: {}, ...extra });
const say = (node) => node.textContent;
// What changed is painted at once by sync(), or by the feed's coalescing timer when an event says so.
const refresh = (page) => { page.window.dispatchEvent({ type: "mefi:workspace-state" }); page.flush(); };
const item = (page, key) => page.$("shell-status").querySelector(`[data-item="${key}"]`);

test("the top bar: the list toggle, the mode switch, the trail, Search, the two pills and the inspector toggle, in that order", () => {
  const page = loadShell({});
  const top = page.region("top");
  const [left, trail, extra, right] = top.children;
  assert.deepEqual(left.children.map((node) => node.id || node.getAttribute("role")), ["shell-list-toggle", "radiogroup"]);
  assert.deepEqual(right.children.map((node) => node.id), ["shell-search", "shell-need", "shell-svc", "shell-inspector-toggle"]);
  assert.equal(trail.getAttribute("aria-label"), "Where you are");
  assert.equal(extra.children.length, 0, "a place for other modules' controls, empty until they come");
  assert.equal(top.getAttribute("role"), "group");
  assert.equal(page.$("shell-list-toggle").getAttribute("aria-label"), "List");
  assert.equal(page.$("shell-inspector-toggle").getAttribute("aria-label"), "Inspector");
  const search = page.$("shell-search");
  assert.equal(search.getAttribute("aria-label"), "Search or run a command (Ctrl K)");
  assert.ok(say(search).includes("Search or run a command") && say(search).includes("Ctrl K"), "the pill says what it does and which key does it");
});

test("the list and inspector toggles open and close their columns and say so", async () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const list = page.$("shell-list-toggle"), inspector = page.$("shell-inspector-toggle");
  assert.equal(list.getAttribute("aria-pressed"), "true");
  assert.match(list.getAttribute("title"), /^Hide the list \(Ctrl B\)/);
  await list.click();
  assert.equal(shell.isOpen("list"), false);
  assert.equal(list.getAttribute("aria-pressed"), "false");
  assert.match(list.getAttribute("title"), /^Show the list/);
  assert.equal(list.dataset.on, "false");
  await inspector.click();
  assert.equal(shell.isOpen("inspector"), false);
  assert.match(inspector.getAttribute("title"), /^Show the inspector \(\[\)/);
  await inspector.click();
  assert.equal(inspector.getAttribute("aria-pressed"), "true");
  assert.equal(list.getAttribute("aria-controls"), "shell-list");
  assert.equal(inspector.getAttribute("aria-controls"), "shell-inspector");
  // In a small window the title says the column opens over the page.
  const small = loadShell({ width: 500, height: 400 });
  assert.match(small.$("shell-list-toggle").getAttribute("title"), /It opens over the page in a window this small/);
});

test("the Vibe | Build switch is a radiogroup that calls MefiVibe's own setter, from Home to Home and never from another page", async () => {
  const page = loadShell({});
  const group = page.region("top").querySelector(".mode-switch");
  assert.equal(group.getAttribute("role"), "radiogroup");
  assert.equal(group.getAttribute("aria-label"), "Studio mode");
  const [vibe, build] = group.querySelectorAll("button");
  assert.deepEqual([vibe.getAttribute("role"), build.getAttribute("role")], ["radio", "radio"]);
  assert.deepEqual([vibe.dataset.uiMode, build.dataset.uiMode], ["vibe", "build"], "the two values MefiVibe already has; no new uiMode");
  assert.deepEqual([vibe.getAttribute("aria-checked"), build.getAttribute("aria-checked"), group.dataset.mode], ["false", "true", "build"]);
  assert.deepEqual([vibe.getAttribute("aria-label"), build.getAttribute("aria-label")], ["Vibe", "Build"], "named without their words, which a small bar hides");
  assert.deepEqual([vibe.tabIndex, build.tabIndex], [-1, 0], "one tab stop, on the mode that is on");
  let stopped = 0, prevented = 0;
  await vibe.click({ stopPropagation: () => { stopped += 1; }, preventDefault: () => { prevented += 1; } });
  assert.deepEqual(page.calls.vibe, [["vibe", { go: true }]], "Home goes to Vibe's Home");
  assert.equal(stopped, 1, "MefiVibe's delegated click handler must not see the same click");
  assert.equal(prevented, 1);
  assert.deepEqual([vibe.getAttribute("aria-checked"), build.getAttribute("aria-checked"), group.dataset.mode], ["true", "false", "vibe"]);
  await vibe.click();
  assert.equal(page.calls.vibe.length, 1, "pressing the mode that is on does nothing");
  page.current = "tasks";
  await build.click();
  assert.deepEqual(page.calls.vibe.at(-1), ["build", { go: false }], "on any other page the page stays");
  assert.equal(page.root.dataset.uiMode, "build");
});

test("arrow keys, Home and End move between the two modes and focus follows", () => {
  const page = loadShell({});
  const group = page.region("top").querySelector(".mode-switch");
  const [vibe, build] = group.querySelectorAll("button");
  const press = (node, key) => { const event = { key, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; node.listeners.keydown[0](event); return event; };
  let event = press(build, "ArrowLeft");
  assert.equal(page.document.activeElement, vibe);
  assert.equal(page.window.MefiShell.mode(), "vibe");
  assert.ok(event.prevented && event.stopped, "the keys are taken, and not passed to vibe.js's own arrow handler");
  press(vibe, "ArrowDown");
  assert.equal(page.window.MefiShell.mode(), "build");
  press(build, "Home");
  assert.equal(page.window.MefiShell.mode(), "vibe");
  press(vibe, "End");
  assert.equal(page.window.MefiShell.mode(), "build");
  const count = page.calls.vibe.length;
  event = press(build, "a");
  assert.equal(event.prevented, undefined, "any other key is left alone");
  press(build, "End");
  assert.equal(page.calls.vibe.length, count, "End on Build stays on Build");
});

test("the frame never writes a mode of its own: uiMode is MefiVibe's", async () => {
  const source = await readFile(new URL("../renderer/shell.js", import.meta.url), "utf8");
  absent(source, /dataset\.uiMode\s*=(?!=)|setAttribute\(["']data-ui-mode["']/, "no write of html[data-ui-mode]");
  absent(source, /localStorage\.setItem\(["']mefiStudio\.uiMode/, "and no write of the saved mode");
  assert.match(source, /MefiVibe\?\.setMode\?\.\(next, \{ go: isHome\(\) \}\)/, "the existing setter is what is called");
  const page = loadShell({});
  page.window.MefiShell.setMode("vibe");
  page.window.MefiShell.setMode("nonsense");
  assert.equal(page.window.MefiShell.mode(), "vibe", "a value that is not a mode is refused");
  assert.deepEqual(page.calls.vibe, [["vibe", { go: true }]]);
});

test("the trail is project / page / item, from what MefiNav and Home already know", () => {
  const page = loadShell({ current: "tasks", registry: { tasks: { id: "tasks", label: "Work" } } });
  page.taskContext = { title: "Add the session list" };
  refresh(page);
  const trail = page.region("top").children[1];
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Fixture", "Work", "Add the session list"]);
  assert.equal(trail.children.at(-1).getAttribute("aria-current"), "page", "the last crumb is where you are");
  assert.equal(trail.children.filter((node) => node.className === "shell-sep").length, 2);
  page.current = "agents";
  page.nav.get = (id) => ({ agents: { id: "agents", short: "Agents" } })[id] ?? null;
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Fixture", "Agents"], "only Work's task page has an item");
  page.snapshot = null;
  refresh(page);
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Agents"], "no project read yet: no project crumb");
  page.window.MefiBuilder = { view: () => ({ view: "task" }) };
  page.current = "workspace";
  page.nav.get = (id) => ({ workspace: { id: "workspace", label: "Home" } })[id] ?? null;
  page.snapshot = snap();
  page.taskContext = { title: "Open in Build" };
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Fixture", "Open in Build"], "the prototype's breadcrumb: project / session");
});

test("the breadcrumb is project / session on Home, Today when none is open, and project / section / page elsewhere, the board's task one press from open", async () => {
  const crumbs = (page) => page.region("top").children[1].children.filter((node) => node.className.includes("shell-crumb"));
  const page = loadShell({ current: "workspace", registry: { workspace: { id: "workspace", label: "Home" } } });
  refresh(page);
  assert.deepEqual(crumbs(page).map(say), ["Fixture", "Home"], "no session open: Home");
  page.window.MefiToday = { count: () => 0 };
  refresh(page);
  assert.deepEqual(crumbs(page).map(say), ["Fixture", "Today"], "the shell's Home is called Today, as its tab is");
  // A session open in the thread is the item, by its full title.
  page.snapshot = snap({ tasks: [{ id: "t1", title: "Add an empty state to the notes list" }] });
  page.window.MefiSessions = { active: () => true, selected: () => "t1" };
  refresh(page);
  assert.deepEqual(crumbs(page).map(say), ["Fixture", "Add an empty state to the notes list"]);
  assert.equal(crumbs(page).at(-1).getAttribute("aria-current"), "page");
  page.window.MefiSessions = { active: () => false, selected: () => "t1" };
  refresh(page);
  assert.deepEqual(crumbs(page).map(say), ["Fixture", "Today"], "panels that are away name nothing");
  // Elsewhere: the section MefiNav names, then the page, and the Task board's task opens it.
  page.current = "worktrees";
  page.nav.sectionLabel = (dest) => (dest?.id === "worktrees" || dest?.id === "tasks" ? "Work" : "Agents");
  page.nav.get = (id) => ({ worktrees: { id: "worktrees", label: "Worktrees" }, tasks: { id: "tasks", label: "Task board" }, agents: { id: "agents", label: "Agents" } })[id] ?? null;
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(crumbs(page).map(say), ["Fixture", "Work", "Worktrees"]);
  page.current = "agents";
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(crumbs(page).map(say), ["Fixture", "Agents"], "a page named as its section is said once");
  page.current = "tasks";
  page.taskContext = { title: "Fix the login loop", taskId: "t9", projectId: "p1" };
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(crumbs(page).map(say), ["Fixture", "Work", "Task board", "Fix the login loop"]);
  const open = crumbs(page).at(-1);
  assert.equal(open.tagName.toLowerCase(), "button", "the classic bar's Current task, as the crumb itself");
  assert.match(open.getAttribute("title"), /open it/);
  await open.click();
  assert.deepEqual(page.calls.go.at(-1), ["tasks", { taskId: "t9", projectId: "p1" }]);
  assert.ok(crumbs(page).slice(0, -1).every((node) => node.tagName.toLowerCase() === "span"), "the other parts are words");
});

test("the Search pill opens the existing palette and closes it when it is open", async () => {
  const page = loadShell({});
  await page.$("shell-search").click();
  assert.deepEqual(page.calls.go.at(-1), ["palette"]);
  page.paletteOpen = true;
  await page.$("shell-search").click();
  assert.deepEqual(page.calls.toggle, ["palette"]);
});

test("the bar measures nothing for the classic local navigation: the frame does not draw it, so the breadcrumb has the middle at every width", () => {
  const page = loadShell({ localNav: true });
  const top = page.region("top");
  for (const width of [900, 560, 500]) {
    top.getBoundingClientRect = () => ({ width, height: 56 });
    page.window.MefiShell.sync();
    assert.equal(page.props["--frame-top-l"], undefined, `${width}: no room is kept for it`);
    assert.equal(page.root.getAttribute("data-frame-narrow"), null);
    assert.equal(top.dataset.local, undefined);
  }
  assert.equal(page.get("app-local-nav").hidden, false, "it stays the classic layout's: nav.js keeps it, the stylesheet leaves it out of the frame");
});

// A section with pages of its own, as nav.js keeps them (LOCAL_ROUTES), and the history within it.
const withPages = (options = {}) => {
  const page = loadShell({ current: "tasks", registry: { workspace: { id: "workspace", label: "Home" }, tasks: { id: "tasks", label: "Task board", short: "Tasks", glyph: "g-tasks", badge: "review" }, plans: { id: "plans", label: "Plans", glyph: "g-plans" }, worktrees: { id: "worktrees", label: "Worktrees" } }, ...options });
  page.calls.history = [];
  Object.assign(page.nav, {
    LOCAL_ROUTES: { home: ["workspace"], work: ["tasks", "plans", "worktrees"], agents: ["agents", "command"] },
    sectionLabel: (dest) => (["tasks", "plans", "worktrees"].includes(dest?.id) ? "Work" : dest?.id === "agents" || dest?.id === "command" ? "Agents" : "Home"),
    historyState: () => page.history ?? { canBack: true, canForward: false },
    back: () => page.calls.history.push("back"), forward: () => page.calls.history.push("forward"),
    paintBadges: (root) => { page.calls.badges = (page.calls.badges ?? 0) + 1; for (const node of root.querySelectorAll("[data-badge]")) node.hidden = false; },
  });
  page.window.MefiGitSync = { mount: (host, options) => { (page.calls.git ??= []).push([host.className, options.variant]); const chip = page.document.createElement("span"); chip.className = "gs-slot"; if (!host.children.length) host.append(chip); return chip; } };
  page.window.dispatchEvent({ type: "mefi:nav" });
  return page;
};

test("the page list: on a page of a section with pages, the list column lists them, with Back and Forward within the section and the Git chip", async () => {
  const page = withPages();
  const shell = page.window.MefiShell;
  const list = page.region("list");
  const pages = page.$("shell-pages");
  assert.equal(pages.parentNode, list, "in the list column");
  assert.ok(list.children.indexOf(pages) < list.children.indexOf(list.children.find((child) => child.className === "shell-stack")), "before the panels it makes way for");
  assert.equal(pages.hidden, false);
  assert.equal(list.dataset.pages, "on", "the column's panels make way (the stylesheet hides them)");
  assert.deepEqual(plain(shell.pages()), { shown: true, section: "work" });
  assert.equal(pages.querySelector(".shell-pages-title").textContent, "Work");
  assert.equal(pages.getAttribute("aria-label"), "Work pages");
  const rows = pages.querySelectorAll(".shell-page");
  assert.deepEqual(rows.map((node) => node.querySelector(".shell-page-label").textContent), ["Tasks", "Plans", "Worktrees"], "the short names the classic bar showed");
  assert.deepEqual(rows.map((node) => node.getAttribute("aria-current")), ["page", null, null], "the page you are on is marked");
  assert.equal(rows[0].querySelector("[data-badge]").dataset.badge, "review", "a page's count rides with it, painted by MefiNav's own badges");
  assert.ok(page.calls.badges >= 1);
  await rows[1].click();
  assert.deepEqual(page.calls.go.at(-1), ["plans"]);
  const [back, forward] = pages.querySelectorAll(".shell-history");
  assert.deepEqual([back.disabled, forward.disabled], [false, true], "as far as the section's history goes");
  assert.equal(back.getAttribute("aria-label"), "Back within this section");
  await back.click();
  assert.deepEqual(page.calls.history, ["back"]);
  assert.deepEqual(page.calls.git.at(-1), ["shell-pages-git", "list"], "the Git chip, in its list-column look; git-sync.js keeps its one popover");
  assert.ok(page.events.some((event) => event.type === "mefi:shell-layout" && event.detail.what === "pages" && event.detail.shown === true), "the column's panels hear that the page list came");
  // The arrows walk the pages.
  rows[0].focus();
  const keyed = { key: "ArrowDown", preventDefault() { this.prevented = true; } };
  page.$("shell-pages-list").listeners.keydown[0](keyed);
  assert.equal(page.document.activeElement, rows[1]);
  assert.equal(keyed.prevented, true);
  // Home has no page list: its list is the session list.
  page.current = "workspace";
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(pages.hidden, true);
  assert.equal(list.dataset.pages, "off");
  assert.deepEqual(plain(shell.pages()), { shown: false, section: null });
  assert.equal(page.events.filter((event) => event.type === "mefi:shell-layout" && event.detail.what === "pages").at(-1).detail.shown, false);
  // A page no section lists (Help, Friends) has none either.
  page.current = "help";
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(pages.hidden, true);
});

test("the page list draws Agents' sections and views, from agents.js, so every pane and tab is still a press away", async () => {
  const page = withPages({ current: "command" });
  const ran = [];
  page.window.MefiAgents = { navModel: (id) => [
    { id: "overview", label: "Overview", current: false, run: () => ran.push("overview"), views: [] },
    { id: "live", label: "Live", current: id === "command", run: () => ran.push("live"), views: [{ label: "Command", current: id === "command", run: () => ran.push("command") }, { label: "Fleet", current: false, run: () => ran.push("fleet") }] },
  ] };
  page.window.dispatchEvent({ type: "mefi:nav" });
  const pages = page.$("shell-pages");
  assert.equal(pages.querySelector(".shell-pages-title").textContent, "Agents");
  assert.deepEqual(pages.querySelector(".shell-pages-list").children.map((node) => [node.tagName.toLowerCase(), node.textContent]), [["button", "Overview"], ["h3", "Live"], ["button", "Command"], ["button", "Fleet"]], "a section with views is a heading over them");
  const rows = pages.querySelectorAll(".shell-page");
  assert.deepEqual(rows.map((node) => node.getAttribute("aria-current")), [null, "page", null]);
  assert.ok(rows.slice(1).every((node) => node.className.includes("is-sub")));
  await rows[2].click();
  assert.deepEqual(ran, ["fleet"], "each goes where the classic bar's menu went");
  // Without agents.js's model the section's own routes stand in.
  delete page.window.MefiAgents;
  page.history = { canBack: false, canForward: true };
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(pages.querySelectorAll(".shell-page").length, 0, "agents and command are not in this registry: nothing to list");
  assert.equal(pages.hidden, true);
});

test("with v2 off there is no page list and no breadcrumb: nothing is drawn, and MefiShell.pages() says so", () => {
  const page = loadShell({ layout: false, current: "tasks" });
  assert.equal(page.$("shell-pages"), null);
  assert.deepEqual(plain(page.window.MefiShell.pages()), { shown: false, section: null });
});

// ---- the 0.5 layout's places in the list column (settingsModel, teamModel, mapModel) and the breadcrumb ----------------
const PLACE_OF = { studio: "settings", size: "settings", config: "settings", agents: "team", skills: "team", usage: "team", booklet: "team", graph: "team", command: "map", fleet: "map", "agent-brain": "map" };
const withPlaces = (current, options = {}) => {
  const page = withPages({ current, registry: {
    workspace: { id: "workspace", label: "Home" }, tasks: { id: "tasks", label: "Task board" }, studio: { id: "studio", label: "Settings" }, size: { id: "size", label: "Size and density" },
    config: { id: "config", label: "Configuration" }, agents: { id: "agents", label: "Agents" }, booklet: { id: "booklet", label: "Model catalog" }, graph: { id: "graph", label: "Performance" },
    command: { id: "command", label: "Map" }, fleet: { id: "fleet", label: "Fleet" }, "agent-brain": { id: "agent-brain", label: "Agent brain" },
  }, ...options });
  page.nav.placeOf = (id) => PLACE_OF[id] ?? "work";
  return page;
};
const listed = (page) => page.$("shell-pages-list").children.map((node) => (node.tagName.toLowerCase() === "h3" ? `# ${node.textContent}` : `${node.textContent}${node.getAttribute("aria-current") ? " *" : ""}${node.className.includes("is-sub") ? " (sub)" : ""}${node.className.includes("is-open") ? " (open)" : ""}`));
const crumbsOf = (page) => page.region("top").children[1].children.filter((node) => node.className.includes("shell-crumb")).map(say);
const SETTINGS_PLACES = [
  ["general", "General", "g-studio", null], ["notifications", "Notifications", "g-bell", null], ["appearance", "Appearance", "g-style", null],
  ["size", "Size and density", "g-textsize", null, "size"], ["looks", "Map look", "g-target", null], ["audio", "Sound and music", "g-audio", null],
  ["updates", "Updates", "g-update", "Updates and help"], ["problem", "Report a problem", "g-flag", "Updates and help"], ["system", "System", "g-gauge", "Advanced"],
];

test("Settings in the list column: the prototype's places under its headings, each jumping where Settings' own list jumps, and the breadcrumb reads Settings / <place>", async () => {
  const page = withPlaces("studio");
  const where = { place: "notifications", search: false };
  const jumps = [];
  page.window.MefiBooklet = {
    showTab() {},
    settingsPlaces: () => SETTINGS_PLACES.map(([id, label, glyph, group, route]) => ({ id, label, glyph, group, sub: id === "size", route: route ?? null, current: !route && id === where.place })),
    settingsLocation: () => ({ id: where.place, label: SETTINGS_PLACES.find(([id]) => id === where.place)[1], search: where.search }),
    jumpToSettings: (id, options) => { jumps.push([id, plain(options)]); where.place = id; },
  };
  page.window.dispatchEvent({ type: "mefi:nav" });
  const pages = page.$("shell-pages");
  assert.equal(pages.hidden, false);
  assert.equal(pages.querySelector(".shell-pages-title").textContent, "Settings");
  assert.deepEqual(listed(page), ["General", "Notifications *", "Appearance", "Size and density (sub)", "Map look", "Sound and music", "# Updates and help", "Updates", "Report a problem", "# Advanced", "System", "All settings in one place"], "the places in the prototype's order, Size and density under Appearance, the two headings, and the way to every setting in one tree");
  assert.deepEqual(pages.querySelectorAll(".shell-page use").map((use) => use.getAttribute("href")).slice(0, 3), ["#g-studio", "#g-bell", "#g-style"], "each row keeps its place's glyph");
  assert.deepEqual(plain(page.window.MefiShell.pages()), { shown: true, section: "settings" });
  assert.deepEqual(crumbsOf(page), ["Fixture", "Settings", "Notifications"]);
  // A row jumps where Settings' own list jumps; the keyboard's press takes focus into the page, the pointer's leaves it.
  const row = (key) => pages.querySelector(`[data-page="settings:${key}"]`);
  await row("system").click({ detail: 1 });
  await row("updates").click({ detail: 0 });
  assert.deepEqual(jumps, [["system", { focus: false }], ["updates", { focus: true }]]);
  // booklet.js says the place changed (no route did): the list and the breadcrumb follow at once.
  page.window.dispatchEvent({ type: "mefi:settings-place", detail: { place: "updates", search: false } });
  assert.equal(row("updates").getAttribute("aria-current"), "page");
  assert.deepEqual(crumbsOf(page), ["Fixture", "Settings", "Updates"]);
  where.search = true;
  page.window.dispatchEvent({ type: "mefi:settings-place", detail: { place: "updates", search: true } });
  assert.deepEqual(crumbsOf(page), ["Fixture", "Settings", "Search"], "Find a setting showing results: the prototype's Settings / Search");
  where.search = false;
  // Size and density is a page of its own: its row opens it, and on it the breadcrumb is the prototype's.
  await row("size").click();
  assert.deepEqual(page.calls.go.at(-1), ["size"]);
  page.current = "size";
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(row("size").getAttribute("aria-current"), "page");
  assert.equal(row("updates").getAttribute("aria-current"), null, "one current row");
  assert.deepEqual(crumbsOf(page), ["Fixture", "Settings", "Appearance", "Size and density"]);
  await row("general").click();
  assert.deepEqual(page.calls.go.at(-1), ["studio", { section: "general" }], "from Size and density a place is a deep link into Settings");
  await row("config").click();
  assert.deepEqual(page.calls.go.at(-1), ["config"], "All settings in one place, which Settings' own list held");
});

test("while the column lists Settings' places as a column, html[data-frame-pages] says so (Settings' own list steps aside); closed or a drawer, it does not", async () => {
  const page = withPlaces("studio");
  page.window.MefiBooklet = { showTab() {}, settingsPlaces: () => SETTINGS_PLACES.map(([id, label, glyph, group]) => ({ id, label, glyph, group, current: id === "general" })), settingsLocation: () => ({ id: "general", label: "General", search: false }), jumpToSettings() {} };
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(page.root.dataset.framePages, "settings");
  page.window.MefiShell.close("list");
  assert.equal(page.root.dataset.framePages, undefined, "the column is closed: Settings' own list is back");
  page.window.MefiShell.open("list");
  assert.equal(page.root.dataset.framePages, "settings");
  page.resize({ innerWidth: 800 });
  assert.equal(page.root.dataset.framePages, undefined, "a small window's drawer is closed: Settings' own list is back");
  page.resize({ innerWidth: 1440 });
  page.current = "tasks";
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(page.root.dataset.framePages, "work", "a section's pages say their section");
  page.window.MefiShell.disable();
  assert.equal(page.root.dataset.framePages, undefined);
  // Without the places (the classic filing, or Settings not filed), the one Settings row stands in.
  const bare = withPlaces("studio");
  bare.window.MefiBooklet = { showTab() {}, settingsPlaces: () => null };
  bare.nav.LOCAL_ROUTES = { ...bare.nav.LOCAL_ROUTES, settings: ["studio"] };
  bare.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(listed(bare), ["Settings *"]);
});

test("Team in the list column: agents.js's places under the prototype's headings, a place's pages under it while you are in it, and Team / <place> in the breadcrumb", async () => {
  const page = withPlaces("booklet");
  const ran = [];
  const view = (label, current = false) => ({ label, current, run: () => ran.push(label) });
  const place = (id, label, group = null, views = [], current = false) => ({ id, label, glyph: "g-agents", group, current, views, run: () => ran.push(id) });
  page.window.MefiAgents = {
    teamPlaces: () => [place("overview", "Overview"), place("providers", "Providers"), place("rules", "Rules", "Context for agents"), place("skills", "Skills", "Context for agents", [view("Skills")]),
      place("flows", "Workflows", "Context for agents", [view("Brain maps"), view("Context")]), place("models", "Models", "Monitor", [view("Catalog", true), view("Performance")], true), place("inspect", "Inspect", "Monitor", [view("Sessions"), view("Trace")])],
    teamPlace: () => ({ id: "models", label: "Models" }),
    navModel: () => { throw new Error("the classic sections are not asked for"); },
  };
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(page.$("shell-pages").querySelector(".shell-pages-title").textContent, "Team");
  assert.deepEqual(listed(page), ["Overview", "Providers", "# Context for agents", "Rules", "Skills", "Workflows", "# Monitor", "Models (open)", "Catalog * (sub)", "Performance (sub)", "Inspect"], "only the place you are in shows its pages; a place of one page has none under it");
  assert.deepEqual(crumbsOf(page), ["Fixture", "Team", "Models"]);
  const pages = page.$("shell-pages");
  await pages.querySelector('[data-page="team:models:1"]').click();
  await pages.querySelector('[data-page="team:inspect"]').click();
  assert.deepEqual(ran, ["Performance", "inspect"]);
  page.window.dispatchEvent({ type: "mefi:team-place", detail: { place: "models" } });
  assert.deepEqual(plain(page.window.MefiShell.pages()), { shown: true, section: "team" });
});

test("the Map in the list column: Map, Fleet and Pipelines, and the breadcrumb names them as the prototype does", async () => {
  const page = withPlaces("fleet");
  page.window.MefiAgentBrain = { tab: () => "live" };
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(page.$("shell-pages").querySelector(".shell-pages-title").textContent, "Map");
  assert.deepEqual(listed(page), ["Map", "Fleet *", "Pipelines"]);
  assert.deepEqual(crumbsOf(page), ["Fixture", "Map", "Fleet"]);
  await page.$("shell-pages").querySelector('[data-page="map:agent-brain"]').click();
  assert.deepEqual(page.calls.go.at(-1), ["agent-brain", { tab: "live" }], "Pipelines is the Agent brain's live tab");
  page.current = "agent-brain";
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(listed(page), ["Map", "Fleet", "Pipelines *"]);
  assert.deepEqual(crumbsOf(page), ["Fixture", "Map", "Pipelines"]);
  page.current = "command";
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(crumbsOf(page), ["Fixture", "Map"], "the Map itself is said once");
});

test("N need you: the digest's total, else the open questions, else MefiToday's count; one is a singular", () => {
  const page = loadShell({});
  const pill = page.$("shell-need");
  const tone = () => [say(pill), pill.dataset.tone, pill.hidden, pill.getAttribute("aria-label")];
  assert.deepEqual(tone(), ["All clear", "clear", false, "All clear. Open the inbox"]);
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 3 } }, questions: [{ status: "open" }] } });
  refresh(page);
  assert.deepEqual(tone(), ["3 need you", "need", false, "3 need you. Open the inbox"], "the digest the app already computes");
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 1 } } } });
  refresh(page);
  assert.deepEqual(tone(), ["1 needs you", "need", false, "1 needs you. Open the inbox"]);
  page.snapshot = snap({ assistant: { questions: [{ status: "open" }, { status: "answered" }, { status: "open" }, null] } });
  refresh(page);
  assert.equal(say(pill), "2 need you", "without a digest, the open questions");
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 4 } } } });
  page.window.MefiToday = { count: () => 7 };
  refresh(page);
  assert.equal(say(pill), "7 need you", "the inbox module's own count, when it is there, is the one (no second counter)");
  page.window.MefiToday = { count: () => { throw new Error("not ready"); } };
  refresh(page);
  assert.equal(say(pill), "4 need you", "a module that is not ready does not break the bar");
  page.window.MefiToday = { count: () => 0 };
  refresh(page);
  assert.equal(say(pill), "All clear");
  delete page.window.MefiToday;
  page.snapshot = null;
  refresh(page);
  assert.equal(pill.hidden, true, "before Home has read a project there is nothing to say");
  assert.equal(page.$("shell-svc").hidden, true);
  assert.equal(page.$("shell-status").querySelectorAll("[data-item]").filter((node) => !node.hidden).length, 1, "only the Layout button");
});

test("N working: the running jobs, and Paused, Agents off or Idle when that is the truth", () => {
  const page = loadShell({});
  const pill = page.$("shell-svc");
  const now = () => [say(pill), pill.dataset.tone, page.$("shell-pause").getAttribute("aria-label")];
  assert.deepEqual(now(), ["Idle", "idle", "Pause new work"]);
  page.snapshot = snap({ status: { running: [{ id: "a" }, { id: "b" }] } });
  refresh(page);
  assert.deepEqual(now(), ["2 working", "working", "Pause new work"]);
  const table = [
    [{ running: [{ id: "a" }], loop: { state: "running", on: false } }, "Paused", "paused", "Resume new work"],
    [{ running: [], loop: { state: "held" } }, "Agents off", "off", "Start agents"],
    [{ running: [], loop: { state: "running", launchHold: true } }, "Agents off", "off", "Start agents"],
    [{ running: [{ id: "a" }], loop: { state: "running", on: true } }, "1 working", "working", "Pause new work"],
    [{ running: [], held: true }, "Agents off", "off", "Start agents"],
    [{ running: [], execute: false }, "Paused", "paused", "Resume new work"],
    [{ running: [] }, "Idle", "idle", "Pause new work"],
  ];
  for (const [status, words, tone, label] of table) {
    page.snapshot = snap({ status });
    refresh(page);
    assert.deepEqual(now(), [words, tone, label], JSON.stringify(status));
  }
  page.snapshot = snap({ assistant: { status: "paused" } });
  refresh(page);
  assert.equal(pill.dataset.tone, "paused", "the assistant's own pause counts");
  page.snapshot = snap({ assistant: { prefs: { paused: true } } });
  refresh(page);
  assert.equal(pill.dataset.tone, "paused");
  assert.equal(page.$("shell-pause").getAttribute("title"), "Let new work start again.");
});

test("the pause button is Home's own: it clicks #workspace-pause, and goes to Home when that is not there", async () => {
  const page = loadShell({ ids: ["workspace-pause"] });
  const control = page.$("workspace-pause");
  let clicks = 0;
  control.click = () => { clicks += 1; };
  await page.$("shell-pause").click();
  assert.equal(clicks, 1, "one control keeps the rules for a launch hold, a pause and a resume");
  assert.deepEqual(page.calls.go, []);
  control.disabled = true;
  await page.$("shell-pause").click();
  assert.equal(clicks, 1, "a disabled control is not clicked");
  assert.deepEqual(page.calls.go.at(-1), ["workspace"]);
  const bare = loadShell({});
  await bare.$("shell-pause").click();
  assert.deepEqual(bare.calls.go.at(-1), ["workspace"], "without Home's control it takes you there");
});

test("Search lists what the frame can do, worded for what a press does now, and only while the frame is there", async () => {
  const page = loadShell({ ids: ["workspace-pause"], snapshot: snap({ status: { running: [{ id: "a" }] } }) });
  const rows = Object.fromEntries(page.calls.registered.filter((row) => row.id.startsWith("shell-do-")).map((row) => [row.id, row]));
  assert.deepEqual(Object.keys(rows), ["shell-do-mode", "shell-do-pause", "shell-do-list", "shell-do-inspector", "shell-do-reset"]);
  for (const row of Object.values(rows)) {
    assert.equal(row.kind, "action");
    assert.deepEqual(plain(row.showIn), { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false }, `${row.id}: Search only; the shortcut sheet has the key rows`);
    assert.equal(row.keyMatch(), false, `${row.id}: the key is shown here and bound by the frame's own listener`);
    assert.equal(row.hidden(), false);
  }
  assert.deepEqual(Object.values(rows).map((row) => [row.label, row.chord ?? null, row.paletteGroup, row.paletteBrowse ?? null]), [
    ["Switch to Vibe", "Ctrl M", "Actions", 4], ["Pause new work", null, "Actions", 2], ["Hide the list", "Ctrl B", "Layout", null], ["Hide the inspector", "[", "Layout", null], ["Reset layout", null, "Layout", null],
  ]);
  // Each runs what the bar's own control runs, and the words follow.
  rows["shell-do-list"].run();
  assert.equal(page.window.MefiShell.isOpen("list"), false);
  assert.equal(rows["shell-do-list"].label, "Show the list");
  rows["shell-do-reset"].run();
  assert.equal(page.window.MefiShell.isOpen("list"), true, "Reset layout puts this mode's list back");
  assert.equal(rows["shell-do-list"].label, "Hide the list");
  rows["shell-do-mode"].run();
  assert.deepEqual(page.calls.vibe.at(-1), ["vibe", { go: true }], "from Home to Home, as the switch does");
  assert.equal(rows["shell-do-mode"].label, "Switch to Build");
  assert.equal(rows["shell-do-mode"].glyph, "g-wrench");
  let clicks = 0;
  page.$("workspace-pause").click = () => { clicks += 1; };
  rows["shell-do-pause"].run();
  assert.equal(clicks, 1, "Home's own pause control keeps the rules");
  page.snapshot = snap({ status: { running: [], execute: false } });
  refresh(page);
  assert.equal(rows["shell-do-pause"].label, "Resume new work");
  page.window.MefiShell.disable();
  assert.ok(Object.values(rows).every((row) => row.hidden()), "gone with the frame");
  const v1 = loadShell({ layout: false });
  assert.deepEqual(v1.calls.registered.filter((row) => row.id.startsWith("shell-do-")), [], "nothing is listed in v1");
});

test("the feed owns no timer and polls nothing: pushes and events are coalesced into one 60 ms paint", () => {
  const pushes = {};
  const api = {};
  for (const name of ["onTasks", "onAssistant", "onAssistantStatus", "onProjects", "onMachineStatus"]) api[name] = (callback) => { pushes[name] = callback; return () => {}; };
  const page = loadShell({ extra: { mefiStudio: api } });
  assert.deepEqual(Object.keys(pushes).sort(), ["onAssistant", "onAssistantStatus", "onMachineStatus", "onProjects", "onTasks"], "it listens to the pushes the page already gets, and to nothing else");
  assert.deepEqual(page.timers, [], "nothing is waiting");
  page.snapshot = snap({ status: { running: [{ id: "a" }] } });
  pushes.onTasks([]);
  pushes.onAssistant({});
  page.window.dispatchEvent({ type: "mefi:usage-report" });
  page.window.dispatchEvent({ type: "mefi:nav-badges" });
  assert.deepEqual(page.timers.map((timer) => timer.delay), [60], "four changes, one timer");
  assert.equal(say(page.$("shell-svc")), "Idle", "not painted yet");
  page.flush();
  assert.equal(say(page.$("shell-svc")), "1 working");
  assert.deepEqual(page.timers, []);
  // Everything the frame listens to while it is on.
  const heard = new Set(page.added);
  for (const type of ["resize", "keydown", "mefi:layout", "mefi:shell", "mefi:nav", "mefi:workspace-state", "mefi:usage-report", "mefi:nav-badges", "mefi:autonomy-changed", "mefi:project-changed", "mefi:task-context", "mefi-music-change", "mefi:companion-state"]) assert.ok(heard.has(type), type);
  // Off, the same events do nothing at all.
  page.window.MefiShell.disable();
  pushes.onTasks([]);
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  assert.deepEqual(page.timers, [], "a removed frame does not repaint");
});

test("a window nobody can see is not repainted, and is once when it is seen again", () => {
  const page = loadShell({});
  page.document.hidden = true;
  page.snapshot = snap({ status: { running: [{ id: "a" }] } });
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  page.window.dispatchEvent({ type: "mefi:usage-report" });
  assert.deepEqual(page.timers, [], "no timer for a hidden window");
  assert.equal(say(page.$("shell-svc")), "Idle", "and no paint");
  page.document.hidden = false;
  page.document.body.listeners.visibilitychange.forEach((listener) => listener({ type: "visibilitychange" }));
  assert.deepEqual(page.timers.map((timer) => timer.delay), [60], "seen again: one repaint is scheduled");
  page.flush();
  assert.equal(say(page.$("shell-svc")), "1 working");
  page.document.body.listeners.visibilitychange.forEach((listener) => listener({ type: "visibilitychange" }));
  assert.deepEqual(page.timers, [], "and nothing is repainted for a window that was never hidden");
});

test("the inbox module's own change notice repaints the pill, once it is there to ask", () => {
  const page = loadShell({});
  let notify = null, subscriptions = 0;
  page.window.MefiToday = { count: () => 0, onChange: (callback) => { subscriptions += 1; notify = callback; return () => {}; } };
  assert.equal(subscriptions, 0, "it loads after the frame: nothing yet");
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  page.flush();
  assert.equal(subscriptions, 1, "asked for at the next paint");
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  page.flush();
  assert.equal(subscriptions, 1, "and only once");
  page.window.MefiToday.count = () => 3;
  notify();
  assert.deepEqual(page.timers.map((timer) => timer.delay), [60]);
  page.flush();
  assert.equal(say(page.$("shell-need")), "3 need you", "its count is the pill's");
  page.window.MefiShell.disable();
  notify();
  assert.deepEqual(page.timers, [], "a removed frame ignores it");
  const bare = loadShell({ layout: false });
  bare.window.MefiToday = { count: () => 1, onChange: () => { throw new Error("v1 must not subscribe"); } };
  bare.window.dispatchEvent({ type: "mefi:workspace-state" });
  assert.deepEqual(bare.timers, []);
});

test("the frame never reaches for setInterval, and its only timer is the 60 ms coalescer", async () => {
  const source = await readFile(new URL("../renderer/shell.js", import.meta.url), "utf8");
  absent(source, /setInterval|requestIdleCallback|new Worker|fetch\(|XMLHttpRequest|window\.mefiStudio\??\.[a-z][A-Za-z]*\(/, "no poll, no network, no host call made by name");
  const timeouts = [...source.matchAll(/setTimeout\(/g)].length;
  // The third is the player's time left, once a second only while something plays and the window can be seen (the owner's
  // pick, 2026-10-05); the usage meters ride on the repaints the frame makes anyway.
  assert.equal(timeouts, 3, "the feed's coalescer, the layout switch's reload delay and the player's time left");
});

test("the need pill and the waiting item open the inbox through MefiShell.onInbox first, then MefiToday, then Work's own views", async () => {
  const page = loadShell({ current: "workspace", snapshot: snap({ assistant: { needsYou: { counts: { total: 2 } }, questions: [{ status: "open" }] } }) });
  const shell = page.window.MefiShell;
  const pill = page.$("shell-need");
  const seen = [];
  shell.onInbox = (anchor) => { seen.push(anchor); return true; };
  await pill.click();
  assert.deepEqual(seen, [pill], "the hook gets the pill it is anchored to");
  assert.deepEqual(page.calls.go, []);
  shell.onInbox = (anchor) => { seen.push(anchor); return false; };
  page.window.MefiToday = { openInbox: (anchor) => { seen.push(["today", anchor]); return true; } };
  await pill.click();
  assert.equal(seen.at(-1)[0], "today", "a hook that declines passes it on");
  shell.onInbox = () => { throw new Error("broken"); };
  page.window.MefiToday = { openInbox: () => false };
  await pill.click();
  assert.deepEqual(page.calls.go.at(-1), ["command", { rail: "ask" }], "a question is waiting: Command's Ask rail");
  shell.onInbox = null;
  delete page.window.MefiToday;
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 1 } } } });
  refresh(page);
  await pill.click();
  assert.deepEqual(page.calls.go.at(-1), ["tasks", { filter: "review" }], "finished work: the Task board's Review filter");
  page.snapshot = snap();
  refresh(page);
  page.toasts.length = 0;
  assert.equal(shell.openInbox(), false);
  assert.deepEqual(page.toasts, [["Nothing needs you right now.", "good"]], "nothing waits: it says so");
  // Vibe has its own drawer for a decision.
  const opened = [];
  page.window.MefiVibe = { ...page.window.MefiVibe, snapshot: () => ({ needs: [{ kind: "question", id: "q1" }] }), openNeed: (need) => opened.push(need) };
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 1 } } } });
  refresh(page);
  shell.setMode("vibe");
  await pill.click();
  assert.deepEqual(plain(opened), [{ kind: "question", id: "q1" }]);
  // The status bar's item is the same door, anchored to itself.
  shell.onInbox = (anchor) => { seen.push(anchor); return true; };
  await item(page, "waiting").click();
  assert.equal(seen.at(-1), item(page, "waiting"));
});

test("the status bar holds only real data: nothing is drawn for what no module has", () => {
  const page = loadShell({ snapshot: null });
  const bar = page.region("status");
  assert.deepEqual(bar.querySelectorAll("[data-item]").map((node) => [node.dataset.item, node.hidden]), [["layout", false], ["working", true], ["waiting", true], ["player", true], ["machine", true], ["cost", true], ["permission", true]]);
  assert.equal(bar.querySelector(".shell-usage").hidden, true);
  assert.equal(bar.querySelector(".shell-usage-sep").hidden, true, "the rule before the meters goes with them");
  assert.equal(page.window.MefiShell.status().run, null);
  assert.deepEqual(bar.querySelector(".shell-status-extra").children, [], "room for other modules' items");
  // Modules that throw or answer with nothing leave it as it was.
  const quiet = loadShell({ extra: { MefiUsageTracker: { brief: () => { throw new Error("no"); } }, MefiMusic: { status: () => ({}) }, MefiAutonomy: { state: () => null } } });
  assert.deepEqual(quiet.region("status").querySelectorAll("[data-item]").filter((node) => !node.hidden).map((node) => node.dataset.item), ["layout", "working"], "what is running is known; the rest is not");
});

test("the status bar: what is running, what waits on you, and the words for each state", () => {
  const page = loadShell({ snapshot: snap({ status: { running: [{ id: "a" }, { id: "b" }, { id: "c" }] }, assistant: { needsYou: { counts: { total: 2 } } } }) });
  assert.deepEqual([say(item(page, "working")), item(page, "working").dataset.tone, item(page, "working").getAttribute("aria-label")], ["3 working", "working", "3 working"]);
  assert.deepEqual([say(item(page, "waiting")), item(page, "waiting").hidden], ["2 waiting on you", false]);
  assert.equal(item(page, "waiting").getAttribute("aria-label"), "2 waiting on you. Open the inbox");
  page.snapshot = snap({ status: { running: [], loop: { state: "held" } } });
  refresh(page);
  assert.equal(say(item(page, "working")), "Agents off");
  assert.equal(item(page, "waiting").hidden, true, "nothing waits: no item");
  page.snapshot = snap({ status: { running: [{ id: "a" }], execute: false } });
  refresh(page);
  assert.equal(say(item(page, "working")), "Paused");
});

test("the right of the status bar: usage meters, the player, the permission mode and today's cost, each only with data", async () => {
  const windows = [{ short: "5 h", label: "5-hour window", percent: 20 }, { short: "Week", label: "Weekly", percent: 50 }, { short: "Sonnet", label: "Weekly Sonnet", percent: 93 }];
  const extra = {
    MefiUsageTracker: { brief: () => ({ plan: { windows }, today: { costUsd: 1.923 } }) },
    MefiMusic: { status: () => ({ playing: true, title: "Deep Focus" }), toggleAudio() { this.toggled = (this.toggled || 0) + 1; } },
    MefiAutonomy: { state: () => ({ level: "auto" }), label: () => "Auto", openSettings() { this.opened = true; } },
  };
  const page = loadShell({ extra });
  const meters = page.region("status").querySelectorAll(".shell-meter-button");
  assert.equal(meters.length, 2, "two meters: the first window and the one closest to its limit");
  assert.deepEqual(meters.map((node) => node.getAttribute("aria-label")), ["5-hour window 20 percent used", "Weekly Sonnet 93 percent used"]);
  assert.equal(meters[0].dataset.tone, undefined);
  assert.equal(meters[1].dataset.tone, "warn", "90 percent and over is marked");
  assert.equal(meters[1].querySelector(".shell-meter i").style.width, "93%");
  assert.deepEqual(meters.map((node) => node.querySelector(".shell-meter-label").textContent), ["5 h", "Sonnet"], "the window's own short name, as the tracker gives it");
  extra.MefiUsageTracker.brief = () => ({ plan: { windows: [{ short: "5h", label: "5-hour window", percent: 20 }, { short: "Wk", label: "Weekly window", percent: 50 }] }, today: { costUsd: 1.923 } });
  refresh(page);
  assert.deepEqual(page.region("status").querySelectorAll(".shell-meter-label").map((node) => node.textContent), ["5 h", "Week"], "the tracker's 5h and Wk read as the prototype words them");
  extra.MefiUsageTracker.brief = () => ({ plan: { windows }, today: { costUsd: 1.923 } });
  refresh(page);
  await meters[0].click();
  assert.deepEqual(page.calls.go.at(-1), ["usage"], "a meter opens Usage, which has the detail");
  assert.deepEqual([say(item(page, "player")), item(page, "player").dataset.playing, item(page, "player").hidden], ["Deep Focus", "true", false]);
  await item(page, "player").click();
  assert.equal(page.window.MefiMusic.toggled, 1, "the player pill opens the existing media menu");
  assert.deepEqual([say(item(page, "permission")), item(page, "permission").hidden], ["Auto", false]);
  await item(page, "permission").click();
  assert.equal(page.window.MefiAutonomy.opened, true);
  assert.deepEqual([say(item(page, "cost")), item(page, "cost").hidden], ["$1.92 today", false]);
  await item(page, "cost").click();
  assert.deepEqual(page.calls.go.at(-1), ["usage"]);
  // One window is one meter; a large cost has no cents; no money is no item.
  extra.MefiUsageTracker.brief = () => ({ plan: { windows: [windows[0]] }, today: { costUsd: 240.4 } });
  refresh(page);
  assert.equal(page.region("status").querySelectorAll(".shell-meter-button").length, 1);
  assert.equal(say(item(page, "cost")), "$240 today");
  extra.MefiUsageTracker.brief = () => ({ plan: null, today: { costUsd: null } });
  refresh(page);
  assert.equal(page.region("status").querySelectorAll(".shell-meter-button").length, 0);
  assert.equal(item(page, "cost").hidden, true);
  extra.MefiMusic.status = () => ({ playing: false });
  extra.MefiAutonomy.state = () => ({});
  refresh(page);
  assert.equal(item(page, "player").hidden, true, "nothing loaded: no player");
  assert.equal(item(page, "permission").hidden, true);
  // Without a media menu or a settings opener the pills go where those live.
  const bare = loadShell({ extra: { MefiMusic: { status: () => ({ playing: false, stationName: "Lo-fi" }) }, MefiAutonomy: { state: () => ({ level: "ask" }) } } });
  await item(bare, "player").click();
  assert.deepEqual(bare.calls.go.at(-1), ["audio"]);
  await item(bare, "permission").click();
  assert.deepEqual(bare.calls.go.at(-1), ["agents", { section: "setup" }]);
  assert.equal(say(item(bare, "permission")), "ask", "with no label() the level is the words");
});

test("the machine's load comes from the resource watcher's push: CPU and memory in use, in the prototype's place, only when there is a reading", async () => {
  let push = null;
  const page = loadShell({ extra: { mefiStudio: { onMachineStatus: (callback) => { push = callback; return () => {}; } }, MefiMusic: { status: () => ({ playing: true, title: "Deep Focus" }) }, MefiUsageTracker: { brief: () => ({ plan: { windows: [{ short: "5 h", label: "5-hour window", percent: 20 }, { short: "Week", label: "Weekly", percent: 50 }] }, today: { costUsd: 1.92 } }) }, MefiAutonomy: { state: () => ({ level: "auto" }), label: () => "Auto" } } });
  assert.equal(typeof push, "function", "it listens to machine:status, the push Home's Machine tile and the rail's badge already get");
  assert.equal(item(page, "machine").hidden, true, "no reading yet: no item");
  // The right of the bar in the prototype's order, and the rule before the meters only with them.
  const bar = page.region("status");
  const right = bar.children.slice(bar.children.findIndex((node) => node.className === "shell-spacer") + 1).filter((node) => node.dataset?.item).map((node) => node.dataset.item);
  assert.deepEqual(right, ["player", "machine", "cost", "permission"]);
  const order = bar.children.map((node) => node.dataset?.item || node.className.split(" ").find((name) => ["shell-sep-v", "shell-usage", "shell-spacer"].includes(name)) || "");
  assert.deepEqual(order.slice(0, 7), ["layout", "shell-sep-v", "working", "waiting", "shell-sep-v", "shell-usage", "shell-spacer"]);
  assert.equal(bar.querySelector(".shell-usage-sep").hidden, false, "two meters, and the rule before them");
  // A pass of the watcher: the rounded load, and what is in use of the memory.
  push({ wait: false, capacity: { canStart: true, reason: null, resources: { cpuPercent: 34.4, availableMemoryMB: 6400, totalMemoryMB: 16384, lagMs: 12 } }, history: new Array(50).fill({}) });
  // (The player plays here, so its time left ticks once a second beside the repaint.)
  assert.deepEqual(page.timers.map((timer) => timer.delay).filter((delay) => delay !== 1000), [60], "one coalesced repaint");
  assert.equal(page.timers.filter((timer) => timer.delay === 1000).length, 1, "and one tick for the playing player's time left");
  page.flush();
  assert.deepEqual([say(item(page, "machine")), item(page, "machine").hidden], ["CPU 34% · Mem 61%", false]);
  assert.equal(item(page, "machine").getAttribute("aria-label"), "Machine load: CPU 34 percent, memory 61 percent in use. Open the machine status");
  assert.deepEqual(plain(page.window.MefiShell.status().machine), { cpu: 34, mem: 61, held: false, reason: "" }, "only these numbers are kept, never the pushed status");
  // The next pass with the same rounded load repaints nothing.
  push({ wait: false, capacity: { resources: { cpuPercent: 34.2, availableMemoryMB: 6390, totalMemoryMB: 16384 } } });
  assert.deepEqual(page.timers.filter((timer) => timer.delay !== 1000), [], "the same load: no repaint (the playing player's tick goes on)");
  // A machine that holds new workers says why on hover.
  push({ wait: true, capacity: { canStart: false, reason: "Free memory is under the floor.", resources: { cpuPercent: 91, availableMemoryMB: 900, totalMemoryMB: 16384 } } });
  page.flush();
  assert.equal(say(item(page, "machine")), "CPU 91% · Mem 95%");
  assert.match(item(page, "machine").getAttribute("title"), /New workers wait: Free memory is under the floor\./);
  // Only the half that was measured is said; a reading with neither number is no reading.
  push({ capacity: { resources: { cpuPercent: null, availableMemoryMB: 4000, totalMemoryMB: 8000 } } });
  page.flush();
  assert.equal(say(item(page, "machine")), "Mem 50%");
  push({ capacity: { resources: { cpuPercent: 12, availableMemoryMB: null } } });
  page.flush();
  assert.equal(say(item(page, "machine")), "CPU 12%");
  for (const nothing of [null, {}, { capacity: { resources: { cpuPercent: "high", availableMemoryMB: 9, totalMemoryMB: 0 } } }]) {
    push(nothing);
    page.flush();
    assert.equal(item(page, "machine").hidden, true, `no item for ${JSON.stringify(nothing)}`);
  }
  // It opens the machine status where the registry has it, else the Explorer's diagnostics.
  push({ capacity: { resources: { cpuPercent: 20 } } });
  page.flush();
  await item(page, "machine").click();
  assert.deepEqual(page.calls.go.at(-1), ["explorer", { panel: "diagnostics" }]);
  const listed = loadShell({ registry: { machine: { id: "machine", kind: "action" } }, extra: { mefiStudio: { onMachineStatus: (callback) => { callback({ capacity: { resources: { cpuPercent: 5 } } }); return () => {}; } } } });
  listed.flush();
  await item(listed, "machine").click();
  assert.deepEqual(listed.calls.go.at(-1), ["machine"]);
  // A removed frame repaints nothing for it.
  page.window.MefiShell.disable();
  push({ capacity: { resources: { cpuPercent: 77 } } });
  assert.deepEqual(page.timers, []);
});

test("the permission mode is read once when it is not there yet, and after that only pushes bring it", async () => {
  let refreshed = 0;
  const autonomy = { state: () => null, refresh: async () => { refreshed += 1; autonomy.state = () => ({ level: "auto" }); }, label: () => "Auto" };
  const page = loadShell({ extra: { MefiAutonomy: autonomy } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshed, 1, "one read");
  assert.equal(say(item(page, "permission")), "Auto");
  page.window.dispatchEvent({ type: "mefi:autonomy-changed" });
  page.flush();
  assert.equal(refreshed, 1, "not again");
  let asked = 0;
  const known = loadShell({ extra: { MefiAutonomy: { state: () => ({ level: "auto" }), refresh: async () => { asked += 1; } } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(say(item(known, "permission")), "auto");
  assert.equal(asked, 0, "a mode that is already there is not read again");
});

test("the Layout menu: switches for the list, the inspector and the tab strip, each mode's widths, Reset layout and the way to Size and density", async () => {
  const page = loadShell({ registry: { worktrees: { id: "worktrees", label: "Worktrees" } } });
  const shell = page.window.MefiShell;
  const button = item(page, "layout");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  button.focus();
  await button.click();
  const menu = page.$("shell-menu");
  assert.equal(menu.getAttribute("role"), "dialog");
  assert.equal(menu.getAttribute("aria-label"), "Layout");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.match(say(menu), /Build mode/);
  const switches = menu.querySelectorAll('[role="switch"]');
  assert.deepEqual(switches.map((node) => [node.dataset.key, node.getAttribute("aria-checked")]), [["list", "true"], ["inspector", "true"], ["tabs", "true"]]);
  await switches[0].click();
  assert.equal(shell.isOpen("list"), false);
  assert.equal(switches[0].getAttribute("aria-checked"), "false", "the switch follows what it did");
  await switches[2].click();
  assert.equal(shell.isOpen("tabs"), false);
  await switches[2].click();
  assert.equal(shell.isOpen("tabs"), true);
  const grid = menu.querySelector(".shell-menu-grid");
  assert.deepEqual(grid.children.map(say), ["", "Build", "Vibe", "List", "closed", "closed", "Inspector", "388 px", "closed"], "both modes' layouts side by side: Build's list was just closed");
  shell.resize("inspector", 500);
  assert.equal(say(menu.querySelector(".shell-menu-grid").children[7]), "500 px", "and it follows a resize");
  // The buttons at the foot.
  const labels = menu.querySelectorAll(".shell-action").map(say);
  assert.deepEqual(labels, ["Reset layout", "Size and density", "Worktrees"]);
  await menu.querySelectorAll(".shell-action")[1].click();
  assert.deepEqual(page.calls.go.at(-1), ["config", { category: "ui" }], "until the size page says how to open it, the scale lives in Configuration");
  assert.equal(page.$("shell-menu"), null, "a choice closes the menu");
  await button.click();
  await page.$("shell-menu").querySelectorAll(".shell-action")[2].click();
  assert.deepEqual(page.calls.go.at(-1), ["worktrees"]);
  await button.click();
  await page.$("shell-menu").querySelectorAll(".shell-action")[0].click();
  assert.equal(shell.isOpen("list"), true, "Reset layout put Build's preset back");
  assert.equal(page.toasts.at(-1)[0].startsWith("Layout reset for Build"), true);
  assert.equal(page.document.activeElement, button, "and focus is back on the Layout button");
});

test("the Layout menu opens the size page by whichever way it is reachable, and lists Worktrees only when there are some", async () => {
  const plainPage = loadShell({});
  await item(plainPage, "layout").click();
  assert.deepEqual(plainPage.$("shell-menu").querySelectorAll(".shell-action").map(say), ["Reset layout", "Size and density"], "no Worktrees destination: no button");
  const opened = [];
  const withModule = loadShell({ extra: { MefiSize: { open: () => opened.push("module") } }, registry: { size: { id: "size" } } });
  await item(withModule, "layout").click();
  await withModule.$("shell-menu").querySelectorAll(".shell-action")[1].click();
  assert.deepEqual(opened, ["module"], "MefiSize.open first");
  const registered = loadShell({ registry: { size: { id: "size" } } });
  await item(registered, "layout").click();
  await registered.$("shell-menu").querySelectorAll(".shell-action")[1].click();
  assert.deepEqual(registered.calls.go.at(-1), ["size"], "then the registered page");
});

test("the Layout menu closes on Escape, on a press outside, on the button again and on going somewhere; a press inside keeps it", async () => {
  const page = loadShell({ mode: "vibe" });
  const button = item(page, "layout");
  const open = async () => { button.focus(); if (!page.$("shell-menu")) await button.click(); return page.$("shell-menu"); };
  let menu = await open();
  assert.match(say(menu), /Vibe mode/, "the menu says which mode's layout it is changing");
  assert.deepEqual(menu.querySelector(".shell-menu-grid").children.map(say), ["", "Build", "Vibe", "List", "280 px", "closed", "Inspector", "388 px", "closed"]);
  await page.press(menu.querySelector(".shell-menu-head"));
  assert.ok(page.$("shell-menu"), "a press inside the menu keeps it");
  await page.press(button);
  assert.ok(page.$("shell-menu"), "the button's own press is its click's business");
  await page.press(page.region("main"));
  assert.equal(page.$("shell-menu"), null, "a press anywhere else closes it");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  menu = await open();
  page.key({ key: "Escape" });
  assert.equal(page.$("shell-menu"), null);
  assert.equal(page.document.activeElement, button);
  await open();
  await button.click();
  assert.equal(page.$("shell-menu"), null, "the button toggles");
  await open();
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(page.$("shell-menu"), null, "going somewhere closes it");
  await open();
  page.window.MefiShell.setMode("build");
  assert.equal(page.$("shell-menu"), null, "so does a change of mode");
  await open();
  page.window.MefiShell.disable();
  assert.equal(page.$("shell-menu"), null, "and taking the frame away");
});

test("the Layout menu keeps its own Escape: a key pressed inside it closes it and goes no further", async () => {
  const page = loadShell({});
  await item(page, "layout").click();
  const menu = page.$("shell-menu");
  const event = { key: "Escape", preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  menu.listeners.keydown[0](event);
  assert.ok(event.prevented && event.stopped);
  assert.equal(page.$("shell-menu"), null);
});
