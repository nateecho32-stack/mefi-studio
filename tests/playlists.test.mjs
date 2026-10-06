import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// renderer/playlists.js in a vm, against the hands music.js gives it
// (MefiMusic.playlists). Links are read with music.js's own mediaLink, so a
// list here holds exactly what the player would take.
const source = await readFile(new URL("../renderer/playlists.js", import.meta.url), "utf8");
const musicSource = await readFile(new URL("../renderer/music.js", import.meta.url), "utf8");
const pure = vm.createContext({ URL });
vm.runInContext(`${musicSource.slice(musicSource.indexOf("  const THEMES"), musicSource.indexOf("  let stored;"))}\nthis.api = { mediaLink, playableLink };`, pure);
const { mediaLink, playableLink } = pure.api;
const youtubeId = (url) => { const link = mediaLink(url); if (link?.provider !== "youtube") return null; const id = new URL(link.url).searchParams.get("v"); return /^[\w-]{11}$/.test(id || "") ? id : null; };
const info = (raw) => { const link = mediaLink(raw); return link ? { provider: link.provider, providerName: link.providerName, kind: link.kind, label: link.label, url: link.url, playable: Boolean(playableLink(link)), youtube: youtubeId(link.url) } : null; };
const STORE = "mefiStudio.playlists.v1";
const ROW_DRAG = "application/x-mefi-playlist-row", MEDIA_DRAG = "application/x-mefi-media";
const yt = (id) => `https://www.youtube.com/watch?v=${id}`;
// Values made inside the vm carry its prototypes; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness({ saved = null, queued = [], playing = null, showLinks = true, shown = true, hub = null } = {}) {
  const storage = new Map(saved ? [[STORE, JSON.stringify(saved)]] : []);
  const documentListeners = new Map();
  let document;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.value = ""; this.className = ""; this.text = ""; this.style = { setProperty: (key, value) => { this.style[key] = value; } }; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = String(value); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; } }
    get isConnected() { let node = this; while (node.parentElement) node = node.parentElement; return node === document.body; }
    contains(node) { for (let at = node; at; at = at.parentElement) if (at === this) return true; return false; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, extra = {}) { const event = { type, target: this, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra }; for (const fn of this.listeners[type] || []) fn(event); return event; }
    click() { if (!this.disabled) this.dispatch("click"); }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return this.rect || { top: 0, left: 0, right: 300, bottom: 40, width: 300, height: 40 }; }
  }
  document = {
    readyState: "complete", activeElement: null, body: new Element("body"),
    createElement: (tag) => new Element(tag),
    addEventListener: (type, fn) => documentListeners.set(type, fn),
    removeEventListener: (type, fn) => { if (documentListeners.get(type) === fn) documentListeners.delete(type); },
  };
  const menu = new Element("section"); document.body.append(menu);
  menu.rect = { top: 100, left: 100, right: 1000, bottom: 900, width: 900, height: 800 };
  const deck = new Element("section"); menu.append(deck);
  const host = new Element("section"); host.hidden = true; deck.append(host);
  const calls = { play: [], queue: [], browse: [], notes: [], copied: [], open: 0, nav: [] };
  const listeners = new Map();
  let hook = null;
  const hands = {
    host, menu, relayout() {}, info,
    glyph: (name, parent) => { const node = new Element("span"); node.dataset.glyph = name; parent.append(node); return node; },
    note: (text, error = false) => calls.notes.push([text, error]),
    thumbnail: (url) => youtubeId(url) ? `https://i.ytimg.com/vi/${youtubeId(url)}/mqdefault.jpg` : null,
    play: (items, name) => { calls.play.push([items.map((item) => item.url), name]); return true; },
    queue: (items, name) => { calls.queue.push([items.map((item) => item.url), name]); return items.length; },
    playing: () => playing, queued: () => queued.map((item) => ({ ...item })),
    browse: (query) => calls.browse.push(query),
    // Like music.js: openSection shows the section, and renderDeck says so.
    open: () => { calls.open++; host.hidden = false; hook.shown(); },
    drag: (node, item) => { node.dragged = item; },
    showLinks: () => showLinks,
  };
  const context = vm.createContext({
    URL, document,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    window: {
      MefiMusic: { playlists: (given) => { hook = given; return hands; } },
      MefiNav: { go: (...args) => calls.nav.push(args) },
      ...(hub ? { mefiStudio: hub } : {}),
      addEventListener: (type, fn) => listeners.set(type, fn),
      navigator: { clipboard: { writeText: async (text) => { calls.copied.push(text); } } },
    },
  });
  vm.runInContext(source, context);
  const all = (root, test) => { const out = []; const walk = (node) => { for (const child of node.children) { if (test(child)) out.push(child); walk(child); } }; walk(root); return out; };
  const named = (root, words) => all(root, (node) => node.tagName === "BUTTON" && (node.textContent === words || node.getAttribute("aria-label") === words))[0] || null;
  const env = {
    playlists: context.window.MefiPlaylists, hook, host, menu, deck, document, storage, calls,
    saved: () => JSON.parse(storage.get(STORE) || "null"),
    all: (test, root = host) => all(root, test),
    classed: (name, root = host) => all(root, (node) => node.className.split(" ").includes(name)),
    button: (words, root = host) => { const found = named(root, words); assert.ok(found, `a button "${words}"`); return found; },
    has: (words, root = host) => Boolean(named(root, words)),
    show: () => { host.hidden = false; hook.shown(); },
    music: (detail) => listeners.get("mefi-music-change")?.({ detail }),
    pointer: (target) => documentListeners.get("pointerdown")?.({ target }),
  };
  if (shown) env.show();
  return env;
}

test("the starting points are real YouTube videos, and the first holds the four channels asked for", () => {
  const env = harness();
  const starters = env.playlists.starters();
  assert.deepEqual(plain(starters.map((list) => list.name)), ["Code & math explorers", "Visualizers", "Focus streams", "Shaders & graphics", "Simulated worlds"]);
  for (const list of starters) {
    assert.ok(list.items.length >= 7 && list.items.length <= 12, `${list.name} is a short starting point`);
    assert.equal(new Set(list.items.map((item) => item.url)).size, list.items.length, `${list.name} repeats no video`);
    for (const item of list.items) {
      assert.match(item.url, /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/, item.title);
      assert.equal(info(item.url)?.playable, true, `${item.title} plays in the Links player`);
      assert.ok(item.title && item.channel, `${item.url} is named`);
      assert.ok(!item.duration || /^\d{1,2}(?::\d{2}){1,2}$/.test(item.duration), item.title);
    }
  }
  const channels = new Set(starters[0].items.map((item) => item.channel));
  for (const name of ["Sebastian Lague", "2swap", "3Blue1Brown", "Emergent Garden"]) assert.ok(channels.has(name), name);
});

test("a list shares as text that reads well in Discord and comes back whole, even pasted into a one-line box", () => {
  const env = harness();
  const { shareText, parseShare, youtubeAll } = env.playlists.model;
  const list = { name: "Late night & code", items: [
    { url: yt("Qz0KTGYJtUk"), title: "Coding Adventure: Ray Tracing", channel: "Sebastian Lague", duration: "37:58" },
    { url: yt("aircAruvnKk"), title: "But what is a neural network? | Deep learning chapter 1", channel: "3Blue1Brown", duration: "18:40" },
    { url: yt("rFZHOHl-L8A"), title: "lofi hip hop radio", channel: "Lofi Girl", duration: "" },
  ] };
  const text = shareText(list, info);
  const lines = text.split("\n");
  assert.equal(lines[0], "Mefi Studio playlist: Late night & code");
  assert.equal(lines[1], "1. Coding Adventure: Ray Tracing · Sebastian Lague · 37:58 <https://youtu.be/Qz0KTGYJtUk>", "links sit in <…>, so Discord shows no previews");
  assert.equal(lines.at(-1), `Play all on YouTube: <https://www.youtube.com/watch_videos?video_ids=Qz0KTGYJtUk,aircAruvnKk,rFZHOHl-L8A&title=Late%20night%20%26%20code>`);
  for (const pasted of [text, text.replace(/\n/g, " "), text.replace(/\n/g, "\r\n")]) {
    const back = parseShare(pasted, info);
    assert.equal(back.name, list.name);
    assert.deepEqual(JSON.parse(JSON.stringify(back.items)), list.items);
  }
  // The YouTube link alone is enough: the videos and the name, titles later.
  const all = parseShare(youtubeAll(list, info), info);
  assert.equal(all.name, "Late night & code");
  assert.deepEqual(plain(all.items.map((item) => item.url)), list.items.map((item) => item.url));
  assert.equal(all.items[0].title, "");
  // Only an all-YouTube list of plain videos gets the play-them-all link.
  const mixed = { name: "Mixed", items: [...list.items, { url: "https://vimeo.com/76979871", title: "A Vimeo film", channel: "", duration: "" }] };
  assert.equal(youtubeAll(mixed, info), "");
  assert.match(shareText(mixed, info).split("\n").at(-1), /^4\. A Vimeo film <https:\/\/vimeo\.com\/76979871>$/);
  assert.equal(youtubeAll({ name: "One", items: list.items.slice(0, 1) }, info), "", "one video is not a list");
});

test("reading shared text keeps only links the player takes, at most fifty, and needs our heading unless asked loosely", () => {
  const env = harness();
  const { parseShare, ITEM_LIMIT } = env.playlists.model;
  assert.equal(parseShare("lofi beats", info, { loose: true }), null);
  assert.equal(parseShare(yt("Qz0KTGYJtUk"), info), null, "one video link plays; it is not a shared list");
  const loose = parseShare(`check these: ${yt("Qz0KTGYJtUk")} and https://youtu.be/aircAruvnKk`, info, { loose: true });
  assert.deepEqual(plain(loose.items.map((item) => [item.url, item.title])), [[yt("Qz0KTGYJtUk"), ""], [yt("aircAruvnKk"), ""]], "chat words are not taken for titles");
  assert.equal(loose.name, "Shared playlist");
  const hostile = parseShare([
    "Mefi Studio playlist: Odd",
    "1. Script <javascript:alert(1)>",
    "2. A stream <https://www.twitch.tv/somebody>",
    "3. Plain web <http://example.com/song.mp3>",
    `4. Twice <${yt("Qz0KTGYJtUk")}>`,
    `5. Twice again <https://youtu.be/Qz0KTGYJtUk>`,
    "6. A file <https://cdn.discordapp.com/attachments/1/2/clip.mp4?ex=1&is=2&hm=3>",
  ].join("\n"), info);
  assert.deepEqual(plain(hostile.items.map((item) => item.title)), ["Twice", "A file"]);
  const many = ["Mefi Studio playlist: Many", ...Array.from({ length: 70 }, (_, i) => `${i + 1}. Clip ${i} <https://example.com/clip-${i}.mp4>`)].join("\n");
  assert.equal(parseShare(many, info).items.length, ITEM_LIMIT);
});

test("saved lists are read back cleaned: bad ids, names and links are dropped, never trusted", () => {
  const env = harness({ saved: { lists: [
    { id: "pl-good", name: "  Good   list ", items: [{ url: yt("Qz0KTGYJtUk"), title: "A\u0000title", duration: "99 hours" }, { url: "javascript:alert(1)" }, { url: "https://www.twitch.tv/x" }], from: "shared", made: 5 },
    { id: "pl-good", name: "Same id" },
    { id: "../escape", name: "Bad id" },
    { id: "pl-noname", name: "   " },
    { id: "pl-proto", name: "Proto", items: "not a list", from: "elsewhere", made: -1 },
    null, "text",
  ] } });
  assert.deepEqual(JSON.parse(JSON.stringify(env.playlists.lists())), [
    { id: "pl-good", name: "Good list", from: "shared", items: [{ url: yt("Qz0KTGYJtUk"), title: "A title", channel: "", duration: "" }] },
    { id: "pl-proto", name: "Proto", from: "", items: [] },
  ]);
});

test("the section draws only while it shows, so no YouTube picture is asked for in a closed menu", () => {
  const env = harness({ shown: false });
  assert.equal(env.host.children.length, 0);
  env.show();
  assert.equal(env.classed("music-pl-card").length, 5, "five starting points");
  assert.ok(env.all((node) => node.tagName === "IMG").every((img) => img.src.startsWith("https://i.ytimg.com/vi/") && img.loading === "lazy"));
  assert.ok(env.has("New playlist") && env.has("Add a shared playlist"));
});

test("a starting point opens, plays, shuffles, lines up and finds more, and Make it yours keeps a copy to change", () => {
  const env = harness();
  env.button("Open Code & math explorers, 12 videos").click();
  assert.equal(env.classed("music-pl-kicker")[0].textContent, "Starting point");
  assert.equal(env.classed("music-pl-item").length, 12);
  assert.equal(env.has("Rename") || env.has("Delete"), false, "a starting point is not yours to change");
  env.button("Play").click();
  assert.equal(env.calls.play[0][0].length, 12); assert.equal(env.calls.play[0][1], "Code & math explorers");
  env.button("Shuffle").click();
  assert.deepEqual(plain([...env.calls.play[1][0]].sort()), plain([...env.calls.play[0][0]].sort()), "shuffle plays the same videos");
  env.button("Add to Up next").click();
  assert.equal(env.calls.queue[0][0].length, 12);
  // A row plays from itself on.
  env.classed("music-pl-row")[9].click();
  assert.deepEqual(plain(env.calls.play[2][0]), plain(env.calls.play[0][0].slice(9)));
  env.button("2swap").click();
  assert.deepEqual(plain(env.calls.browse), ["2swap"]);
  env.button("Make it yours").click();
  const saved = env.saved().lists;
  assert.equal(saved.length, 1); assert.equal(saved[0].name, "Code & math explorers"); assert.equal(saved[0].items.length, 12);
  assert.equal(env.classed("music-pl-kicker")[0].textContent, "Your playlist");
  assert.ok(env.has("Rename") && env.has("Delete"));
});

test("your list renames, takes links and the playing video, reorders by drag, and deletes only after asking", () => {
  const playing = { url: yt("PH9q0HNBjT4"), title: "How Games Fake Water", channel: "Acerola" };
  const env = harness({ playing, saved: { lists: [{ id: "pl-mine", name: "Mine", items: [{ url: yt("Qz0KTGYJtUk"), title: "One" }, { url: yt("aircAruvnKk"), title: "Two" }] }] } });
  env.button("Open Mine, 2 videos").click();
  env.button("Rename").click();
  const rename = env.classed("music-pl-rename")[0];
  rename.children[0].value = "Late night"; rename.dispatch("submit");
  assert.equal(env.saved().lists[0].name, "Late night");
  const add = env.classed("music-pl-add")[0];
  const input = add.children.find((node) => node.tagName === "INPUT");
  input.value = "https://www.twitch.tv/somebody"; add.dispatch("submit");
  assert.equal(env.saved().lists[0].items.length, 2, "a link the player can't take is refused");
  assert.equal(env.calls.notes.at(-1)[1], true);
  env.classed("music-pl-add")[0].children.find((node) => node.tagName === "INPUT").value = "https://youtu.be/KaljD3Q3ct0";
  env.classed("music-pl-add")[0].dispatch("submit");
  env.button("Add what's playing: How Games Fake Water").click();
  assert.deepEqual(env.saved().lists[0].items.map((item) => item.title), ["One", "Two", "", "How Games Fake Water"]);
  assert.equal(env.has("Add what's playing: How Games Fake Water"), false, "once it is in the list the offer goes");
  // Drag the last row to the top.
  const list = env.classed("music-pl-items")[0];
  list.children.forEach((row, index) => { row.rect = { top: index * 50, bottom: index * 50 + 50, height: 50, left: 0, right: 300, width: 300 }; });
  const transfer = (data) => ({ types: Object.keys(data), getData: (type) => data[type] ?? "", dropEffect: "" });
  list.dispatch("dragover", { clientY: 10, dataTransfer: transfer({ [ROW_DRAG]: "3" }) });
  assert.equal(list.children[0].dataset.drop, "before");
  list.dispatch("drop", { clientY: 10, dataTransfer: transfer({ [ROW_DRAG]: "3" }) });
  assert.deepEqual(env.saved().lists[0].items.map((item) => item.title), ["How Games Fake Water", "One", "Two", ""]);
  // A video dragged in from Up next joins where it is dropped.
  const again = env.classed("music-pl-items")[0];
  again.children.forEach((row, index) => { row.rect = { top: index * 50, bottom: index * 50 + 50, height: 50, left: 0, right: 300, width: 300 }; });
  again.dispatch("drop", { clientY: 60, dataTransfer: transfer({ [MEDIA_DRAG]: JSON.stringify({ url: yt("2g-CrQfYNtE"), title: "Artificial Life" }) }) });
  assert.deepEqual(env.saved().lists[0].items.map((item) => item.title), ["How Games Fake Water", "Artificial Life", "One", "Two", ""]);
  env.button("Delete").click();
  assert.equal(env.saved().lists.length, 1, "Delete asks first");
  env.button("Keep it").click();
  env.button("Delete").click();
  env.classed("music-pl-confirm")[0].children[1].children[0].click();
  assert.equal(env.saved().lists.length, 0);
  assert.equal(env.classed("music-pl-card").length, 5, "back on all playlists");
});

test("New playlist can start with what waits in Up next", () => {
  const env = harness({ queued: [{ url: yt("Qz0KTGYJtUk"), title: "One" }, { url: "https://example.com/two.mp4", title: "Two" }] });
  env.button("New playlist").click();
  const form = env.classed("music-pl-form")[0];
  const [input] = env.all((node) => node.tagName === "INPUT" && node.type === "text", form);
  const [box] = env.all((node) => node.tagName === "INPUT" && node.type === "checkbox", form);
  assert.match(box.parentElement.textContent, /Start with the 2 videos in Up next/);
  input.value = "From the queue"; box.checked = true; form.dispatch("submit");
  assert.deepEqual(env.saved().lists[0].items.map((item) => item.title), ["One", "Two"]);
  // A name already taken gets a number.
  env.button("Back to all playlists").click();
  env.button("New playlist").click();
  const next = env.classed("music-pl-form")[0];
  env.all((node) => node.tagName === "INPUT" && node.type === "text", next)[0].value = "from the QUEUE"; next.dispatch("submit");
  assert.deepEqual(env.saved().lists.map((list) => list.name), ["from the QUEUE 2", "From the queue"]);
});

test("Share copies the text and the YouTube link, and Show links off keeps addresses off the screen", async () => {
  const env = harness({ showLinks: false });
  env.button("Open Focus streams, 7 videos").click();
  env.button("Share").click();
  const box = env.classed("music-pl-share-text")[0];
  assert.doesNotMatch(box.value, /https?:/);
  env.button("Copy as text").click(); env.button("Copy the YouTube link").click();
  await Promise.resolve(); await Promise.resolve();
  assert.match(env.calls.copied[0], /^Mefi Studio playlist: Focus streams\n1\. lofi hip hop radio: beats to relax\/study to · Lofi Girl <https:\/\/youtu\.be\/rFZHOHl-L8A>/);
  assert.match(env.calls.copied[1], /^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=rFZHOHl-L8A,/);
});

test("Save to a playlist toggles a video in and out of your lists, makes a new one, and closes on Escape or outside", () => {
  const env = harness({ saved: { lists: [{ id: "pl-a", name: "A", items: [] }, { id: "pl-b", name: "B", items: [{ url: yt("Qz0KTGYJtUk"), title: "Ray Tracing" }] }] } });
  const anchor = env.document.createElement("button"); env.menu.append(anchor);
  anchor.rect = { top: 300, bottom: 330, left: 600, right: 630, width: 30, height: 30 };
  env.hook.save(anchor, { url: "https://youtu.be/Qz0KTGYJtUk", title: "Ray Tracing", channel: "Sebastian Lague", duration: "37:58" });
  const pop = env.classed("music-pl-save", env.menu)[0];
  assert.ok(pop); assert.equal(pop.style.top, "236px", "just under the button, inside the menu");
  const rows = () => env.classed("music-pl-save-row", pop);
  assert.deepEqual(rows().map((row) => row.getAttribute("aria-pressed")), ["false", "true"]);
  assert.equal(env.document.activeElement, rows()[0]);
  rows()[0].click(); rows()[1].click();
  assert.deepEqual(env.saved().lists.map((list) => list.items.length), [1, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(env.saved().lists[0].items[0])), { url: yt("Qz0KTGYJtUk"), title: "Ray Tracing", channel: "Sebastian Lague", duration: "37:58" });
  const form = env.classed("music-pl-save-new", pop)[0];
  form.children[0].value = "Graphics"; form.dispatch("submit");
  assert.deepEqual(env.saved().lists.map((list) => [list.name, list.items.length]), [["Graphics", 1], ["A", 1], ["B", 0]]);
  env.pointer(pop.children[0]);
  assert.ok(pop.parentElement, "a click inside keeps it");
  assert.equal(env.hook.dismiss(), true); assert.equal(pop.parentElement, null);
  assert.equal(env.hook.dismiss(), false, "Escape then reaches the menu");
  env.hook.save(anchor, { url: yt("aircAruvnKk"), title: "Two" });
  env.pointer(env.host);
  assert.equal(env.classed("music-pl-save", env.menu).length, 0, "a click outside closes it");
  env.hook.save(anchor, { url: "javascript:alert(1)" });
  assert.equal(env.classed("music-pl-save", env.menu).length, 0); assert.equal(env.calls.notes.at(-1)[1], true);
});

test("a shared list pasted into Browse opens in Playlists ready to save; anything else is left to Browse", () => {
  const env = harness({ shown: false });
  assert.equal(env.hook.offer("lofi beats"), false);
  assert.equal(env.hook.offer(yt("Qz0KTGYJtUk")), false);
  const text = env.playlists.model.shareText({ name: "From a friend", items: [{ url: yt("Qz0KTGYJtUk"), title: "One", channel: "", duration: "" }, { url: yt("aircAruvnKk"), title: "Two", channel: "", duration: "" }] }, info);
  assert.equal(env.hook.offer(text.replace(/\n/g, " ")), true);
  assert.equal(env.calls.open, 1);
  assert.equal(env.classed("music-pl-preview")[0].textContent, "From a friend · 2 videos");
  env.classed("music-pl-form")[0].dispatch("submit");
  assert.deepEqual(plain(env.playlists.lists().map((list) => [list.name, list.from, list.items.length])), [["From a friend", "shared", 2]]);
  assert.equal(env.classed("music-pl-kicker")[0].textContent, "Shared with you");
});

test("a video saved before its title was known takes the title its player reports, and the playing row is marked", () => {
  const env = harness({ saved: { lists: [{ id: "pl-x", name: "X", items: [{ url: yt("Qz0KTGYJtUk") }, { url: yt("aircAruvnKk"), title: "Kept" }] }] } });
  env.button("Open X, 2 videos").click();
  env.music({ source: "link", link: yt("Qz0KTGYJtUk"), title: "YouTube video" });
  assert.equal(env.playlists.lists()[0].items[0].title, "", "the player's generic label is not a title");
  assert.equal(env.classed("music-pl-item")[0].dataset.state, "playing");
  env.music({ source: "link", link: yt("Qz0KTGYJtUk"), title: "Coding Adventure: Ray Tracing" });
  assert.equal(env.saved().lists[0].items[0].title, "Coding Adventure: Ray Tracing");
  env.music({ source: "link", link: yt("aircAruvnKk"), title: "Something else" });
  assert.equal(env.saved().lists[0].items[1].title, "Kept", "a title already there stays");
  const rows = env.classed("music-pl-item");
  assert.equal(rows[0].dataset.state, undefined); assert.equal(rows[1].dataset.state, "playing");
  env.music({ source: "radio", link: null, title: "Groove Salad" });
  assert.equal(env.classed("music-pl-item")[1].dataset.state, undefined);
});

const flushAll = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const readyHub = ({ linked = true, state = "ready", refuse = null } = {}) => {
  const sent = [];
  return {
    sent,
    hubStatus: async () => ({ ok: true, status: { configured: true, communityConfigured: true, linked, state } }),
    hubConnect: async () => { sent.push(["connect"]); return { ok: true }; },
    hubRooms: async () => ({ ok: true, rooms: [
      { id: "room_a", name: "Lo-fi corner", you: "member", status: "active" },
      { id: "lobby", name: "Lobby", you: "member", status: "active" },
      { id: "room_x", name: "Not mine", you: "none", status: "active" },
      { id: "room_c", name: "Closed", you: "owner", status: "closed" },
    ] }),
    hubRoom: async (method, ...args) => { sent.push([method, ...args]); return refuse?.room ?? { ok: true }; },
    hubProjects: async (method, fields) => { sent.push([method, { ...fields }]); return refuse?.hub ?? { ok: true }; },
  };
};

test("a long list posted in a room fits one message, and the YouTube link brings every video back", () => {
  const env = harness();
  const { shareText, parseShare } = env.playlists.model;
  const ids = Array.from({ length: 50 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
  const list = { name: "Fifty", items: ids.map((id, i) => ({ url: yt(id), title: `A rather long video title number ${i} about shaders and simulations`, channel: "Some Channel", duration: "12:34" })) };
  const text = shareText(list, info, { max: 2000 });
  assert.ok(text.length <= 2000, `${text.length} characters`);
  assert.match(text, /\n…and \d+ more videos in the YouTube link\nPlay all on YouTube: </);
  const back = parseShare(text, info);
  assert.equal(back.items.length, 50);
  assert.equal(back.items[0].title, list.items[0].title, "the lines that fit keep their titles");
  assert.equal(back.items[49].title, "", "the rest come from the link, titled when they play");
  assert.equal(shareText(list, info), shareText(list, info, { max: Infinity }), "no limit, no cut");
});

test("Share sends a list to friends: a room gets the text, the Project hub one YouTube link, and refusals say why", async () => {
  const hub = readyHub();
  const env = harness({ hub });
  env.button("Open Code & math explorers, 12 videos").click();
  env.button("Share").click();
  await flushAll();
  const box = env.classed("music-pl-friends")[0];
  const select = env.all((node) => node.tagName === "SELECT", box)[0];
  assert.deepEqual(plain(select.children.map((option) => option.textContent)), ["Lo-fi corner", "Lobby"], "only active rooms you're in");
  assert.equal(select.value, "lobby", "the Lobby first");
  env.button("Post", box).click();
  await flushAll();
  const [method, roomId, text] = hub.sent[0];
  assert.equal(method, "sendMessage"); assert.equal(roomId, "lobby");
  assert.ok(text.length <= 2000);
  assert.equal(env.playlists.model.parseShare(text, info).items.length, 12);
  assert.match(env.classed("music-pl-friends-note")[0].textContent, /^Posted in Lobby\./);
  env.button("Open Lobby").click();
  assert.deepEqual(plain(env.calls.nav.at(-1)), ["friends-page", { place: "rooms", room: "lobby" }]);
  env.button("Add to the Project hub").click();
  await flushAll();
  const [share, fields] = hub.sent[1];
  assert.equal(share, "shareProject");
  assert.equal(fields.kind, "other"); assert.equal(fields.title, "Code & math explorers");
  assert.ok(fields.url.length <= 512);
  assert.equal(fields.blurb, "A playlist of 12 videos: Sebastian Lague, 3Blue1Brown, 2swap, Emergent Garden.");
  const fromHub = env.playlists.fromLink(fields.url, fields.title);
  assert.equal(fromHub.name, "Code & math explorers"); assert.equal(fromHub.items.length, 12);
  assert.match(env.classed("music-pl-friends-note")[0].textContent, /you both earn credits/);
  env.button("Open the Project hub").click();
  assert.deepEqual(plain(env.calls.nav.at(-1)), ["friends-page", { place: "hub" }]);
  // Refusals in plain words.
  const refused = readyHub({ refuse: { hub: { ok: false, error: "conflict", reason: "owned-projects" }, room: { ok: false, error: "rate-limited" } } });
  const other = harness({ hub: refused });
  other.button("Open Visualizers, 8 videos").click(); other.button("Share").click(); await flushAll();
  other.button("Add to the Project hub").click(); await flushAll();
  assert.equal(other.classed("music-pl-friends-note")[0].textContent, "Not added: You have 5 things on the Project hub. Remove one there to add this.");
  other.button("Post").click(); await flushAll();
  assert.equal(other.classed("music-pl-friends-note")[0].textContent, "Not posted: Slow down a moment, then try again.");
});

test("Share says what is missing: a Discord sign-in, a connection, or YouTube-only for the hub", async () => {
  const out = harness({ hub: readyHub({ linked: false }) });
  out.button("Open Focus streams, 7 videos").click(); out.button("Share").click(); await flushAll();
  assert.match(out.classed("music-pl-friends")[0].textContent, /Sign in with Discord in Friends/);
  out.button("Open Friends").click();
  assert.deepEqual(plain(out.calls.nav.at(-1)), ["friends-page", { place: "lobby" }]);
  const hub = readyHub({ state: "closed" });
  const off = harness({ hub });
  off.button("Open Focus streams, 7 videos").click(); off.button("Share").click(); await flushAll();
  off.button("Connect").click(); await flushAll();
  assert.deepEqual(plain(hub.sent[0]), ["connect"]);
  const none = harness();
  none.button("Open Focus streams, 7 videos").click(); none.button("Share").click(); await flushAll();
  assert.match(none.classed("music-pl-friends")[0].textContent, /need the Studio desktop app/);
  const mixed = harness({ hub: readyHub(), saved: { lists: [{ id: "pl-mix", name: "Mixed", items: [{ url: yt("Qz0KTGYJtUk"), title: "One" }, { url: "https://vimeo.com/76979871", title: "Two" }] }] } });
  mixed.button("Open Mixed, 2 videos").click(); mixed.button("Share").click(); await flushAll();
  assert.equal(mixed.has("Add to the Project hub"), false);
  assert.match(mixed.classed("music-pl-friends")[0].textContent, /Only playlists of YouTube videos go on the Project hub/);
  assert.equal(mixed.has("Post"), true, "a room still takes it");
});

test("a shared playlist where friends talk is a card to play or save, saved once; a hub link is a playlist named after its card", () => {
  const env = harness();
  assert.equal(env.playlists.card("just chatting about https://youtu.be/Qz0KTGYJtUk"), null);
  const text = env.playlists.model.shareText({ name: "Mix", items: [{ url: yt("Qz0KTGYJtUk"), title: "One", channel: "Sebastian Lague", duration: "37:58" }, { url: yt("aircAruvnKk"), title: "Two", channel: "3Blue1Brown", duration: "18:40" }] }, info);
  const card = env.playlists.card(text);
  assert.ok(card);
  assert.match(card.textContent, /PlaylistMix2 videos · about 57 min/);
  env.button("Play Mix", card).click();
  assert.deepEqual(plain(env.calls.play.at(-1)), [[yt("Qz0KTGYJtUk"), yt("aircAruvnKk")], "Mix"]);
  env.button("Save Mix to your playlists", card).click();
  assert.deepEqual(plain(env.playlists.lists().map((list) => [list.name, list.from, list.items.length])), [["Mix", "shared", 2]]);
  const again = env.playlists.card(text);
  assert.equal(env.button("Mix is in your playlists", again).disabled, true, "the same list is saved once");
  assert.equal(env.playlists.keep(env.playlists.parse(text)).already, true);
  const hubLink = "https://www.youtube.com/watch_videos?video_ids=Qz0KTGYJtUk,aircAruvnKk&title=Old%20name";
  assert.equal(env.playlists.fromLink(hubLink, "Card title").name, "Card title");
  assert.equal(env.playlists.fromLink(hubLink).name, "Old name");
  for (const other of ["https://aksana.itch.io/void", yt("Qz0KTGYJtUk"), "http://www.youtube.com/watch_videos?video_ids=Qz0KTGYJtUk", "https://evil.test/watch_videos?video_ids=Qz0KTGYJtUk"]) assert.equal(env.playlists.fromLink(other), null, other);
  const shelf = env.playlists.cardFor(env.playlists.fromLink(hubLink, "Card title"), { play: false, title: false });
  assert.equal(env.has("Play Card title", shelf), false); assert.equal(env.has("Save Card title to your playlists", shelf), true);
});
