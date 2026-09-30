import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createDom, Element } from "./fixtures/renderer-dom.mjs";

// The @ # / suggestions in a message box (renderer/composer-picker.js) in a bare context with the shared
// fake DOM: where a trigger starts, how matches are ranked, what a pick inserts, the keys, the popup and
// its ARIA, the chips, the switch, and that the page reads a message the same way the host does
// (scripts/mentions.cjs). Real geometry, focus and the key order against Home's own Enter handler are
// checked in a real window by tests/composer_render.test.mjs.
const require = createRequire(import.meta.url);
const mentions = require("../scripts/mentions.cjs");
const source = readFileSync(new URL("../renderer/composer-picker.js", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function load() {
  const dom = createDom();
  const timers = [];
  const window = { innerHeight: 800, addEventListener() {} };
  vm.runInNewContext(source, { window, document: dom.document, Array, JSON, Promise, String, Number, Math, Set, Map, WeakMap, Date, Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    setTimeout: (fn, ms) => { const timer = { fn, ms, live: true }; timers.push(timer); return timer; }, clearTimeout: (timer) => { if (timer) timer.live = false; } });
  return { api: window.MefiComposerPicker, window, dom, timers };
}

const FILES = [
  { path: "src/app.js", name: "app.js", dir: "src" }, { path: "src/ui/composer.js", name: "composer.js", dir: "src/ui" },
  { path: "docs/readme.md", name: "readme.md", dir: "docs" }, { path: "notes/meeting notes.md", name: "meeting notes.md", dir: "notes" }, { path: "Makefile", name: "Makefile", dir: "" },
];
const SKILLS = [{ name: "bug-triage", description: "Reproduce a bug" }, { name: "release-notes", description: "Write the notes" }, { name: "review", description: "" }];
const TASKS = [{ id: "t1", title: "Fix the sidebar scroll", status: "open" }, { id: "t2", title: 'Add a "quoted" title', status: "awaiting_verification" }, { id: "t3", title: "Write release notes", status: "done" }];

function box({ mode = () => "chat", scope = () => "project-a", blocked = () => false, files = async (query) => ({ ok: true, files: FILES.filter((file) => file.path.toLowerCase().includes(String(query.query).toLowerCase())) }), skills = async () => ({ ok: true, skills: SKILLS }), tasks = () => TASKS, on = true } = {}) {
  const env = load();
  const { dom } = env;
  const input = new Element("textarea");
  dom.body.append(input);
  const log = { files: [], skills: 0, inputs: 0, focus: 0 };
  Object.assign(input, { selectionStart: 0, selectionEnd: 0 });
  input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; };
  input.dispatchEvent = (event) => { if (event.type === "input") log.inputs += 1; return input.trigger(event.type, event); };
  input.focus = () => { log.focus += 1; };
  env.window.mefiStudio = { projectFiles: async (payload) => { log.files.push(plain(payload)); return files(payload); }, agentsSkills: async () => { log.skills += 1; return skills(); } };
  const picker = env.api.bind(input, { scope, blocked, tasks, on, mode });
  const $ = (selector) => dom.body.querySelector(selector);
  const $$ = (selector) => dom.body.querySelectorAll(selector);
  const fireTimers = async () => { for (let round = 0; round < 10; round += 1) { const due = env.timers.filter((timer) => timer.live); if (!due.length) break; for (const timer of due) { timer.live = false; timer.fn(); } await settle(); } };
  const type = async (text, { caret = text.length, flush = true } = {}) => {
    input.value = text; input.setSelectionRange(caret, caret);
    await input.trigger("input", {});
    await settle();
    if (flush) await fireTimers();
  };
  const press = async (key, extra = {}) => { const seen = { prevented: 0, stopped: 0, immediate: 0 }; await input.trigger("keydown", { key, preventDefault() { seen.prevented += 1; }, stopPropagation() { seen.stopped += 1; }, stopImmediatePropagation() { seen.immediate += 1; }, ...extra }); await settle(); return seen; };
  const items = () => $$(".composer-picker-item").map((node) => ({ label: node.querySelector("b").textContent, meta: node.querySelector("small")?.textContent ?? "", current: node.classList.contains("current") }));
  const open = () => { const popup = $(".composer-picker"); return Boolean(popup && !popup.hidden); };
  return { env, dom, input, picker, log, $, $$, type, press, items, open, fireTimers, chips: () => $$(".composer-mention").map((node) => node.textContent), chipsHidden: () => $(".composer-mentions").hidden };
}

test("a trigger is an @, # or / that starts a word, read at the caret", () => {
  const { api } = load();
  const table = [
    ["@", 1, { trigger: "@", query: "", start: 0, end: 1 }],
    ["look at @sr", 11, { trigger: "@", query: "sr", start: 8, end: 11 }],
    ["look at @sr", 9, { trigger: "@", query: "", start: 8, end: 9 }, "the caret in the middle reads only what is before it"],
    ["#fix", 4, { trigger: "#", query: "fix", start: 0, end: 4 }],
    ["do /bug", 7, { trigger: "/", query: "bug", start: 3, end: 7 }],
    ["do\n/bug", 7, { trigger: "/", query: "bug", start: 3, end: 7 }, "after a line break"],
    ["me@example.com", 14, null, "an email address"],
    ["word#", 5, null], ["a/b", 3, null, "a / inside a word"], ["/usr/bin", 8, null, "a path"], ["https://x.y/z", 13, null],
    ["/bug-triage", 11, { trigger: "/", query: "bug-triage", start: 0, end: 11 }],
    ["/Bug", 4, { trigger: "/", query: "Bug", start: 0, end: 4 }, "the skill picker matches any case; only lowercase names exist"],
    ["/bug_x", 6, null, "an underscore is not in a skill's name"], ["/a.b", 4, null], ["/a/", 3, null, "a path"], ["/a/", 2, { trigger: "/", query: "a", start: 0, end: 2 }, "the caret before the second / reads /a"],
    ["@a b", 4, null, "a space ends the word"], ["@x".repeat(2), 4, { trigger: "@", query: "x@x", start: 0, end: 4 }, "an @ inside the query is part of the query, not a second trigger"],
    ["@" + "q".repeat(81), 82, null, "a query past 80 characters is not a search"],
    ["", 0, null], [null, 0, null], ["plain words", 5, null],
  ];
  for (const [text, caret, expected, why] of table) assert.deepEqual(plain(api.detectTrigger(text, caret)), expected, `${JSON.stringify(text)} at ${caret}${why ? ` (${why})` : ""}`);
  assert.deepEqual(plain(api.detectTrigger("look @a")), { trigger: "@", query: "a", start: 5, end: 7 }, "no caret means the end");
  assert.deepEqual(plain(api.detectTrigger("ab", 99)), null, "a caret past the end is clamped");
});

test("the page reads a message's mentions exactly as the host does", () => {
  const { api } = load();
  const skills = ["bug-triage", "release-notes", "review"];
  const table = [
    "look at @src/app.js please", "@README.md first", 'see @"notes/meeting notes.md" too', 'read @"Makefile"', "thanks @sam", "mail me@example.com", "x@src/app.js", "trailing @src/app.js.",
    "(see @src/app.js), then @docs/a.md; and @b.txt!", 'fix #"Fix the sidebar" now', "issue #12 and #nope", 'a#"glued" title', "use /bug-triage here", "/review", "use /bug-triage, then /release-notes.",
    "/unknown is not one", "see /usr/bin and https://example.com/bug-triage", "half/bug-triage", "/bug-triage/extra", "/Bug-Triage", '@src/app.js @src/app.js #"T" #"T" /bug-triage /bug-triage',
    '/bug-triage on @src/a.js for #"Task one"', "", "@", "#", "/", '@""', '@"a" @"b c" @d.e', "@a.b, @c.d. @e.f:", "@'quoted.js'", "\n@a.b\n#\"x\"\n/review\n",
  ];
  for (const text of table) assert.deepEqual(plain(api.parseMentions(text, { skills })), plain(mentions.parse(text, { skills })), JSON.stringify(text));
  // And on a few thousand messages built from the pieces that matter: the two can not drift apart.
  const pieces = ["@", "#", "/", '"', " ", "\n", ".", "-", ",", "a", "b1", "src/app.js", "bug-triage", "review", "x y", "me@e.com", ")", "'", "\\", "é"];
  let seed = 12345;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let round = 0; round < 3000; round += 1) {
    let text = "";
    for (let part = next() % 12; part >= 0; part -= 1) text += pieces[next() % pieces.length];
    assert.deepEqual(plain(api.parseMentions(text, { skills })), plain(mentions.parse(text, { skills })), JSON.stringify(text));
  }
});

test("a pick is put where the word was, with a space after it unless one is there", () => {
  const { api } = load();
  assert.equal(api.fileText("src/app.js"), "@src/app.js");
  assert.equal(api.fileText("notes/meeting notes.md"), '@"notes/meeting notes.md"', "a space: quoted");
  assert.equal(api.fileText("Makefile"), '@"Makefile"', "a bare name with no . or /: quoted, so it is read as a file");
  assert.equal(api.fileText("a.b"), "@a.b");
  assert.equal(api.taskText('Add a "quoted" title'), "#\"Add a 'quoted' title\"");
  assert.equal(api.taskText("  spaced  "), '#"spaced"');
  assert.equal(api.taskText("x".repeat(200)).length, 123, "a title is cut at 120 characters (and the #\"\" around it)");
  assert.equal(api.skillText("bug-triage"), "/bug-triage");
  assert.deepEqual(plain(api.insertMention("look at @sr", { start: 8, end: 11 }, "@src/app.js")), { value: "look at @src/app.js ", caret: 20 });
  assert.deepEqual(plain(api.insertMention("look at @sr and more", { start: 8, end: 11 }, "@src/app.js")), { value: "look at @src/app.js and more", caret: 20 }, "an existing space is used");
  assert.deepEqual(plain(api.insertMention("/bu", { start: 0, end: 3 }, "/bug-triage")), { value: "/bug-triage ", caret: 12 });
  // What a pick inserts is read back as a mention by the same grammar.
  for (const [pick, kind, text] of [["@src/app.js", "file", "src/app.js"], ['@"notes/meeting notes.md"', "file", "notes/meeting notes.md"], ['@"Makefile"', "file", "Makefile"], ['#"A title"', "task", "A title"], ["/bug-triage", "skill", "bug-triage"]]) {
    assert.deepEqual(plain(api.parseMentions(`look ${pick} now`, { skills: ["bug-triage"] })), [{ kind, text }], pick);
  }
});

test("names are matched as substrings, best first; letters scattered in order count only when asked", () => {
  const { api } = load();
  assert.equal(api.fuzzy("", "anything"), 1);
  assert.ok(api.fuzzy("bug", "bug-triage") > api.fuzzy("bug", "debug-tool"), "a start beats a middle");
  assert.ok(api.fuzzy("tri", "bug-triage") > api.fuzzy("tri", "bug-something-triage"), "earlier beats later");
  assert.equal(api.fuzzy("btg", "bug-triage"), null, "scattered letters do not match by default");
  assert.ok(api.fuzzy("btg", "bug-triage", { scatter: true }) > 0);
  assert.equal(api.fuzzy("xyz", "bug-triage", { scatter: true }), null);
  assert.equal(api.fuzzy("BUG", "Bug-Triage"), api.fuzzy("bug", "bug-triage"), "case does not matter");
  const items = [{ label: "/release-notes" }, { label: "/bug-triage" }, { label: "/review" }, { label: "/debug" }];
  assert.deepEqual(plain(api.rank(items, "bug").map((item) => item.label)), ["/bug-triage", "/debug"]);
  assert.deepEqual(plain(api.rank(items, "re").map((item) => item.label)), ["/review", "/release-notes"], "the shorter of two starts wins");
  assert.deepEqual(plain(api.rank(items, "", 2).map((item) => item.label)), ["/release-notes", "/bug-triage"], "no query keeps the order given, up to the limit");
  assert.deepEqual(plain(api.rank(items, '"bug').map((item) => item.label)), ["/bug-triage", "/debug"], "a leading quote is not part of a name");
  assert.deepEqual(plain(api.rank(null, "x")), []);
});

test("typing @ asks the host for file names a few keys at a time and shows them, the name first and its folder beside it", async () => {
  const b = box();
  await b.type("look at @c", { flush: false });
  await b.type("look at @co", { flush: false });
  await b.type("look at @com", { flush: false });
  assert.equal(b.log.files.length, 0, "nothing is asked while keys are still coming");
  await b.fireTimers();
  assert.deepEqual(b.log.files, [{ query: "com", limit: 8 }], "asked once, for what was typed last");
  assert.equal(b.open(), true);
  assert.deepEqual(b.items(), [{ label: "composer.js", meta: "src/ui", current: true }]);
  assert.equal(b.$(".composer-picker").getAttribute("aria-label"), "Project files");
  assert.equal(b.$(".composer-picker").getAttribute("role"), "listbox");
  assert.equal(b.$(".composer-picker-head").textContent, "Project files — keep typing to filter");
  assert.deepEqual(b.$$(".composer-picker-foot span").map((node) => node.textContent), ["↑ ↓ move", "Enter or Tab insert", "Esc close"]);
  assert.equal(b.$(".composer-picker-item").getAttribute("role"), "option");
  assert.equal(b.$(".composer-picker-item").getAttribute("aria-selected"), "true");
  assert.equal(b.input.getAttribute("aria-activedescendant"), "composer-pick-0");
  assert.equal(b.input.getAttribute("aria-controls"), "composer-picker-files");
  assert.equal(b.input.getAttribute("aria-autocomplete"), "list");
  assert.equal(b.$(".composer-picker").parentNode, b.dom.body, "the popup is on the page, not inside the composer that clips");
  assert.equal(b.$(".composer-picker").style.left, "8px");
  assert.equal(b.$(".composer-picker").style.width, "400px");
  assert.equal(b.$(".composer-picker").style.bottom, "806px");
});

test("arrow keys move the choice and wrap, Enter or Tab insert it, and the popup takes the key only while it is open", async () => {
  const b = box();
  await b.type("see @");
  assert.equal(b.items().length, 5);
  assert.equal(b.items().findIndex((item) => item.current), 0);
  let seen = await b.press("ArrowDown");
  assert.deepEqual([seen.prevented, seen.immediate], [1, 1], "the arrow is the popup's, and nothing else hears it");
  assert.equal(b.items().findIndex((item) => item.current), 1);
  await b.press("ArrowUp"); await b.press("ArrowUp");
  assert.equal(b.items().findIndex((item) => item.current), 4, "up from the first wraps to the last");
  await b.press("ArrowDown");
  assert.equal(b.items().findIndex((item) => item.current), 0, "down from the last wraps to the first");
  await b.press("ArrowDown"); await b.press("ArrowDown");
  assert.equal(b.input.getAttribute("aria-activedescendant"), "composer-pick-2");
  seen = await b.press("Enter");
  assert.deepEqual([seen.prevented, seen.immediate], [1, 1], "Enter is taken, so Home does not send the message");
  assert.equal(b.input.value, "see @docs/readme.md ");
  assert.deepEqual([b.input.selectionStart, b.input.selectionEnd], [20, 20], "the caret is after the space");
  assert.equal(b.open(), false);
  assert.equal(b.log.inputs, 1, "an input event tells Home the draft changed");
  assert.deepEqual(b.chips(), ["@docs/readme.md"]);
  assert.equal(b.log.focus >= 1, true);
  // Tab does the same; shift+Enter is left to the box (a new line); with nothing open, keys are nobody's but the box's.
  await b.type("and @mak");
  seen = await b.press("Tab");
  assert.equal(b.input.value, 'and @"Makefile" ');
  assert.equal(seen.prevented, 1);
  await b.type("another @app");
  seen = await b.press("Enter", { shiftKey: true });
  assert.equal(seen.prevented + seen.immediate, 0, "shift+Enter is not a pick");
  assert.equal(b.input.value, "another @app");
  assert.equal(b.open(), true);
  seen = await b.press("Escape");
  assert.deepEqual([seen.prevented, seen.stopped, seen.immediate], [1, 1, 1]);
  assert.equal(b.open(), false);
  assert.equal(b.input.value, "another @app", "Esc leaves the text alone");
  for (const key of ["Enter", "Tab", "ArrowDown", "Escape"]) { seen = await b.press(key); assert.equal(seen.prevented + seen.stopped + seen.immediate, 0, `${key} with nothing open is not taken`); }
  seen = await b.press("Enter", { isComposing: true });
  assert.equal(seen.prevented, 0);
});

test("plain typing opens nothing: an email address, a word with # or @ or / inside, a path, a URL", async () => {
  const b = box();
  for (const text of ["write to me@example.com", "see/usr/bin and https://example.com/a/b", "word# and word@ and a/b", "C:/Users/me/notes", "half/way", "a #hashtag-less", "100% sure", "thanks @nobody-here"]) {
    await b.type(text);
    assert.equal(b.open(), false, `nothing opens for ${JSON.stringify(text)}`);
  }
  assert.equal(b.log.files.length <= 1, true, "at most the one @ question about an unknown name was asked");
  await b.type("#zzz");
  assert.equal(b.open(), false, "a task search with no match shows nothing");
  await b.type("/zzz");
  assert.equal(b.open(), false);
  await b.type("hello @");
  assert.equal(b.open(), true, "a bare @ at a word start does");
  await b.type("hello @ there", { caret: 7 });
  assert.equal(b.open(), true, "the caret decides, not the end of the text");
  await b.type("hello @x there", { caret: 14 });
  assert.equal(b.open(), false, "a space ends the word, so nothing is open once the caret has left it");
});

test("a selection, a blocked box and a box the suggestions are off for open nothing, and close what was open", async () => {
  let blocked = false;
  const b = box({ blocked: () => blocked });
  await b.type("see @app");
  assert.equal(b.open(), true);
  b.input.selectionStart = 4; b.input.selectionEnd = 8;
  await b.input.trigger("click", {}); await settle(); await b.fireTimers();
  assert.equal(b.open(), false, "a selected word is not a word being typed");
  await b.type("see @app");
  assert.equal(b.open(), true);
  blocked = true;
  await b.type("see @app");
  assert.equal(b.open(), false, "a box that cannot take input offers nothing");
  blocked = false;
  await b.type("see @app");
  assert.equal(b.open(), true);
  b.picker.setPicker(false);
  assert.equal(b.open(), false);
  assert.equal(b.input.getAttribute("aria-autocomplete"), null);
  await b.type("see @app");
  assert.equal(b.open(), false, "switched off: nothing opens");
  const asked = b.log.files.length;
  await b.type("see @app and #\"Fix\" and /review");
  assert.equal(b.chipsHidden(), true, "and no chips");
  assert.equal(b.log.files.length, asked, "and the host is not asked");
  b.picker.setPicker(true);
  await b.type("see @app");
  assert.equal(b.open(), true, "and back on");
  assert.equal(b.input.getAttribute("aria-autocomplete"), "list");
  const off = box({ on: false });
  await off.type("see @app");
  assert.equal(off.open(), false, "a box bound with the suggestions off starts off");
  assert.equal(off.input.getAttribute("aria-autocomplete"), null);
});

test("an answer that arrives after the person kept typing is not shown", async () => {
  const first = deferred(), second = deferred();
  const answers = [first, second];
  const b = box({ files: () => answers.shift().promise });
  await b.type("@a");
  await b.type("@ap");
  first.resolve({ ok: true, files: [{ path: "a-old.js", name: "a-old.js", dir: "" }] });
  await settle();
  assert.equal(b.open(), false, "the answer for @a is out of date");
  second.resolve({ ok: true, files: [{ path: "app.js", name: "app.js", dir: "" }] });
  await settle();
  assert.deepEqual(b.items().map((item) => item.label), ["app.js"]);
  // A popup closed while a question is out stays closed.
  const late = deferred();
  const c = box({ files: () => late.promise });
  await c.type("@a");
  const gone = await c.press("Escape");
  assert.equal(gone.prevented + gone.immediate, 0, "nothing was showing, so the key is not taken");
  late.resolve({ ok: true, files: [{ path: "a.js", name: "a.js", dir: "" }] });
  await settle();
  assert.equal(c.open(), false);
  // A failed or malformed answer is no popup, never an error.
  const broken = box({ files: async () => { throw new Error("bridge gone"); } });
  await broken.type("@a");
  assert.equal(broken.open(), false);
  for (const odd of [null, {}, { ok: false }, { files: "no" }, { files: [null, { path: 4 }, { path: "" }] }]) { const one = box({ files: async () => odd }); await one.type("@a"); assert.equal(one.open(), false, JSON.stringify(odd)); }
});

test("# offers the page's tasks by title and status, and inserts the title in quotes", async () => {
  const b = box();
  await b.type("see #");
  assert.deepEqual(b.items(), [{ label: "Fix the sidebar scroll", meta: "open", current: true }, { label: 'Add a "quoted" title', meta: "awaiting verification", current: false }, { label: "Write release notes", meta: "done", current: false }]);
  assert.equal(b.$(".composer-picker").getAttribute("aria-label"), "Tasks");
  assert.equal(b.log.files.length, 0, "tasks come from the page: the host is not asked");
  await b.type("see #notes");
  assert.deepEqual(b.items().map((item) => item.label), ["Write release notes"]);
  await b.press("Enter");
  assert.equal(b.input.value, 'see #"Write release notes" ');
  assert.deepEqual(b.chips(), ['#Write release notes']);
  await b.type("see #quoted");
  await b.press("Tab");
  assert.equal(b.input.value, "see #\"Add a 'quoted' title\" ", "a quote inside a title becomes an apostrophe so the mention stays one piece");
  const none = box({ tasks: () => [] });
  await none.type("see #"); assert.equal(none.open(), false);
  const odd = box({ tasks: () => [null, { title: "" }, { title: 5 }, { title: "Only real one" }] });
  await odd.type("see #"); assert.deepEqual(odd.items().map((item) => item.label), ["Only real one"]);
});

test("/ offers the project's skills with their descriptions, reads them once for a while, and again for another project", async () => {
  let project = "project-a";
  const b = box({ scope: () => project });
  await b.type("/");
  assert.deepEqual(b.items(), [{ label: "/bug-triage", meta: "Reproduce a bug", current: true }, { label: "/release-notes", meta: "Write the notes", current: false }, { label: "/review", meta: "", current: false }]);
  assert.equal(b.$(".composer-picker").getAttribute("aria-label"), "Skills");
  assert.equal(b.log.skills, 1, "the warm-up read and this popup share one read");
  await b.type("/re");
  assert.deepEqual(b.items().map((item) => item.label), ["/review", "/release-notes"]);
  assert.equal(b.log.skills, 1);
  await b.press("Enter");
  assert.equal(b.input.value, "/review ");
  assert.deepEqual(b.chips(), ["/review"], "a skill the project has shows as a chip");
  await b.type("/zzz-unknown and /bug-triage");
  assert.deepEqual(b.chips(), ["/bug-triage"], "only a skill the project has");
  project = "project-b";
  b.picker.refresh();
  await settle();
  assert.equal(b.log.skills, 2, "another project's skills are read again");
  const failing = box({ skills: async () => { throw new Error("no"); } });
  await failing.type("/"); assert.equal(failing.open(), false);
});

test("what a message points at shows as chips under the box, and only while the suggestions are on", async () => {
  const b = box();
  await settle();
  assert.equal(b.chipsHidden(), true);
  await b.type('look at @src/app.js and @"Makefile" for #"Fix the sidebar scroll" using /bug-triage');
  assert.deepEqual(b.chips(), ["@src/app.js", "@Makefile", "#Fix the sidebar scroll", "/bug-triage"]);
  assert.equal(b.$(".composer-mentions-label").textContent, "Sent with this message");
  assert.equal(b.$$(".composer-mention.file").length, 2);
  assert.equal(b.$$(".composer-mention.task").length, 1);
  assert.equal(b.$$(".composer-mention.skill").length, 1);
  assert.match(b.$(".composer-mention.file").title, /its contents are not sent unless the model may read files/);
  assert.match(b.$(".composer-mention.skill").title, /instructions are sent with your message/);
  const before = b.$(".composer-mention");
  await b.type('look at @src/app.js and @"Makefile" for #"Fix the sidebar scroll" using /bug-triage');
  assert.equal(b.$(".composer-mention"), before, "the same mentions draw nothing again");
  await b.type("nothing now");
  assert.equal(b.chipsHidden(), true);
  const many = Array.from({ length: 20 }, (_, index) => `@f/${index}.js`).join(" ");
  await b.type(many);
  assert.equal(b.chips().length, 12, "twelve chips at most");
  b.picker.setPicker(false);
  assert.equal(b.chipsHidden(), true);
});

test("a chip says what will happen to the mention: in chat it is sent to the model, in a task it is written into the brief", async () => {
  let mode = "chat";
  const b = box({ mode: () => mode });
  await b.type('@src/app.js #"Fix the sidebar scroll" /bug-triage');
  const titles = () => b.$$(".composer-mention").map((node) => node.title);
  assert.match(titles()[0], /its contents are not sent unless the model may read files/);
  assert.match(titles()[2], /instructions are sent with your message/);
  mode = "task";
  b.picker.refresh();
  assert.match(titles()[0], /^Written into the task as you typed it, so a builder can open it\.$/);
  assert.match(titles()[1], /^Written into the task as you typed it\.$/);
  assert.match(titles()[2], /A skill's instructions are added to chat messages only\./, "no claim that a skill is expanded where it is not");
  mode = "chat";
  b.picker.refresh();
  assert.match(titles()[2], /instructions are sent with your message/);
});

test("the popup closes when the box loses focus, unless focus went into the popup, and a pick by mouse keeps the box focused", async () => {
  const b = box();
  await b.type("see @app");
  assert.equal(b.open(), true);
  b.dom.document.activeElement = b.$(".composer-picker-item");
  await b.input.trigger("blur", {}); await b.fireTimers();
  assert.equal(b.open(), true, "focus is in the popup");
  b.dom.document.activeElement = null;
  await b.input.trigger("blur", {}); await b.fireTimers();
  assert.equal(b.open(), false);
  await b.type("see @app");
  const seen = { prevented: 0 };
  await b.$(".composer-picker-item").trigger("mousedown", { preventDefault() { seen.prevented += 1; } });
  assert.equal(seen.prevented, 1, "pressing an option does not take focus from the box");
  await b.$(".composer-picker-item").trigger("click", {});
  await settle();
  assert.equal(b.input.value, "see @src/app.js ");
  assert.equal(b.open(), false);
});

test("a pick goes where the word is now, even when a key was typed since the list was drawn", async () => {
  const b = box();
  await b.type("see @app");
  assert.equal(b.open(), true);
  // A key arrives; the list has not been refreshed yet (the debounce has not fired).
  b.input.value = "see @appx"; b.input.setSelectionRange(9, 9);
  await b.press("Enter");
  assert.equal(b.input.value, "see @src/app.js ", "the word being typed is replaced, not the word that was offered for");
  // The word ended (a space was typed) and the popup has not closed yet: nothing is inserted into the wrong place.
  await b.type("see @app");
  b.input.value = "see @app "; b.input.setSelectionRange(9, 9);
  await b.press("Enter");
  assert.equal(b.input.value, "see @app ", "no word under the caret: no insertion");
  assert.equal(b.open(), false);
});

test("the popup is placed against the box and follows a resize; the box is bound once", async () => {
  const b = box();
  const resizes = [];
  b.env.window.addEventListener = (name, fn) => resizes.push([name, fn]);
  await b.type("see @app");
  assert.equal(b.env.api.get(b.input), b.picker);
  assert.equal(b.env.api.bind(b.input, {}), b.picker, "binding twice hands back the first");
  assert.equal(b.env.api.bind(null, {}), null);
  assert.equal(b.env.api.pickerPreference({ composerPicker: false }), false);
  assert.equal(b.env.api.pickerPreference({}), true);
  assert.equal(b.env.api.pickerPreference(undefined), true);
  assert.equal(b.env.api.PICK_MAX, 8);
  assert.equal(b.$$(".composer-picker").length, 1, "one popup for one box");
  assert.equal(b.$$(".composer-mentions").length, 1);
  assert.equal(b.picker.isOpen(), true);
  b.picker.close();
  assert.equal(b.picker.isOpen(), false);
});
