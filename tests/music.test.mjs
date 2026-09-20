import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/music.js", import.meta.url), "utf8");
const pure = vm.createContext({ URL });
vm.runInContext(`${source.slice(source.indexOf("  const THEMES"), source.indexOf("  let stored;"))}\nthis.api = {spotifyLink, safePreferences, audioFile, nextIndex, timeLabel, hexColor, resolvePalette, contrast};`, pure);
const helpers = pure.api;
const flush = async () => { for (let index = 0; index < 15; index += 1) await Promise.resolve(); };

function environment({ saved = null, recommend, preview = false, workspaceActive = false, audioLink = null } = {}) {
  const ids = new Map();
  const events = [];
  const revoked = [];
  const opened = [];
  const styles = new Map();
  const storage = new Map(saved ? [["mefiStudio.music.v1", JSON.stringify(saved)]] : []);
  const lifecycle = [];
  const frames = new Map();
  const listeners = new Map();
  let frameId = 0;
  let previewRect = { x: 400, y: 80, width: 600, height: 640 };
  let treeView = "3d";
  let audio;
  let blob = 0;
  let document;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.style = { setProperty: (key, value) => styles.set(key, value) }; this.classList = { add() {}, remove() {} }; this.hidden = false; this.disabled = false; this.value = ""; }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    set textContent(value) { this.textWrites = (this.textWrites || 0) + 1; this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    removeAttribute(key) { delete this.attrs[key]; if (key === "src") this.src = ""; }
    addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
    dispatch(key, payload = {}) { for (const fn of this.listeners[key] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...payload }); }
    click() { if (!this.disabled) this.dispatch("click"); }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return previewRect; }
  }
  class Audio extends Element {
    constructor() { super("audio"); this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 120; this.volume = 1; this.src = ""; }
    async play() { if (!this.src) throw new Error("No source"); this.paused = false; this.ended = false; this.dispatch("play"); }
    pause() { this.paused = true; this.dispatch("pause"); }
    load() { this.currentTime = 0; this.ended = false; this.dispatch("loadedmetadata"); }
  }
  class RuntimeURL extends URL {
    static createObjectURL() { return `blob:fixture-${++blob}`; }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  document = {
    readyState: "loading", activeElement: null, documentElement: new Element("html"), body: new Element("body"),
    addEventListener() {}, createElement: (tag) => tag === "audio" ? (audio = new Audio()) : new Element(tag),
  };
  const context = vm.createContext({
    URL: RuntimeURL, document,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: {
      dispatchEvent: (event) => events.push(event), addEventListener: (type, callback) => listeners.set(type, callback), open: (url) => opened.push(url),
      requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: (id) => frames.delete(id),
      MefiNav: { claim: (id) => lifecycle.push(`claim:${id}`), release: (id) => lifecycle.push(`release:${id}`) },
      ...(preview || audioLink ? {
        MefiIdle: {
          ...(preview ? { setSettingsPreview: (rect) => lifecycle.push(rect ? { ...rect } : "preview:close"), status: () => ({ view: treeView }), setView: (view) => { treeView = view; listeners.get("mefi-tree-view")?.({ detail: { view } }); } } : {}),
          ...audioLink,
        },
      } : {}),
      ...(preview ? {
        MefiWorkspace: { isActive: () => workspaceActive, exit: () => { workspaceActive = false; lifecycle.push("workspace:exit"); }, enter: () => { workspaceActive = true; lifecycle.push("workspace:enter"); } },
      } : {}),
      mefiStudio: { ...(recommend ? { musicRecommend: recommend } : {}), openExternal: (url) => { opened.push(url); return Promise.resolve(); } },
    },
  });
  vm.runInContext(source, context);
  const music = context.window.MefiMusic;
  music.init();
  return { music, ids, events, revoked, opened, styles, storage, document, audio, lifecycle,
    frames: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); },
    resize: (rect) => { previewRect = rect; listeners.get("resize")?.(); },
    view: (view) => { treeView = view; listeners.get("mefi-tree-view")?.({ detail: { view } }); },
    emit: (type, detail) => listeners.get(type)?.({ detail }),
  };
}
const file = (name, size = 12, type = "audio/mpeg") => ({ name, size, type, lastModified: 1 });

test("Spotify links are canonical and reject foreign, credentialed or malformed targets", () => {
  const id = "37i9dQZF1DX7zqr9q1MPG7";
  assert.equal(helpers.spotifyLink(`https://open.spotify.com/playlist/${id}?si=tracking#fragment`).embed, `https://open.spotify.com/embed/playlist/${id}`);
  assert.equal(helpers.spotifyLink(`spotify:track:${id}`).type, "track");
  assert.equal(helpers.spotifyLink(`https://open.spotify.com/intl-de/album/${id}`).type, "album");
  for (const bad of [`https://open.spotify.com.evil.test/track/${id}`, `https://user@open.spotify.com/track/${id}`, `http://open.spotify.com/track/${id}`, `https://open.spotify.com:444/track/${id}`, "javascript:alert(1)", "https://open.spotify.com/track/too-short", `https://open.spotify.com/track/${id}/extra`, `spotify:track:${id}:extra`, "<iframe src='https://open.spotify.com'>"]) assert.equal(helpers.spotifyLink(bad), null, bad);
});

test("Saved music preferences are bounded and never contain local files or transient Blob URLs", () => {
  const link = "https://open.spotify.com/playlist/37i9dQZF1DX7zqr9q1MPG7";
  const value = helpers.safePreferences({ theme: "untrusted", volume: 8, spotify: [link, link, "blob:private", "https://evil.test"], tracks: ["C:/private.mp3"], selected: "blob:private" });
  assert.equal(value.theme, "gold"); assert.equal(value.volume, 1);
  assert.deepEqual(Array.from(value.spotify), [link]);
  assert.deepEqual(Object.keys(value).sort(), ["customColors", "extraGlow", "nodeLayout", "nodeStyle", "orbitTrails", "spotify", "theme", "volume"]);
  assert.equal(helpers.safePreferences(null).volume, .7);
  assert.equal(helpers.audioFile(file("track.flac", 1, "")), true);
  assert.equal(helpers.audioFile(file("notes.html", 1, "text/html")), false);
});

test("Queue progression stops naturally after the last track and wraps only on explicit next", () => {
  assert.equal(helpers.nextIndex(2, 3, 1, false), -1);
  assert.equal(helpers.nextIndex(2, 3, 1, true), 0);
  assert.equal(helpers.nextIndex(0, 3, -1, true), 2);
  assert.equal(helpers.nextIndex(0, 0), -1);
  assert.equal(helpers.timeLabel(NaN), "0:00");
  assert.equal(helpers.timeLabel(192), "3:12");
});

test("Local music queues without autoplay, reports actual playback, seeks and releases removed files", async () => {
  const env = environment();
  assert.equal(env.ids.get("music-overlay").hidden, true, "initialization does not open a dialog");
  env.music.addFiles([file("One_track.mp3"), file("One_track.mp3"), file("Two.mp3")]);
  assert.equal(env.music.status().queueLength, 2);
  assert.equal(env.music.status().playing, false);
  assert.equal(env.music.status().title, "One track");
  assert.equal(env.music.getAudioElement(), env.audio, "one stable audio element feeds the graph analyser");
  env.ids.get("music-play").click(); await flush();
  assert.equal(env.music.status().playing, true);
  env.ids.get("music-seek").value = "42"; env.ids.get("music-seek").dispatch("input");
  assert.equal(env.audio.currentTime, 42);
  env.ids.get("music-next").click(); await flush();
  assert.equal(env.music.status().title, "Two");
  env.audio.paused = true; env.audio.ended = true; env.audio.dispatch("ended"); await flush();
  assert.equal(env.music.status().title, "Two");
  assert.equal(env.music.status().playing, false, "natural completion does not restart the queue");
  env.ids.get("music-queue").children[1].children[2].click();
  assert.equal(env.music.status().title, "One track");
  assert.deepEqual(env.revoked, ["blob:fixture-2"]);
  assert.ok(env.events.some((event) => event.type === "mefi-music-change" && event.detail.playing));
  assert.ok(![...env.storage.values()].some((value) => value.includes("One_track") || value.includes("blob:")));
});

test("Spotify source pauses local audio, does not invent playback state and unloads when switching back", async () => {
  const env = environment();
  env.music.addFiles([file("Focus.mp3")]); env.ids.get("music-play").click(); await flush();
  assert.equal(env.music.loadSpotify("https://open.spotify.com/album/37i9dQZF1DX7zqr9q1MPG7"), true);
  assert.equal(env.audio.paused, true);
  assert.equal(env.music.status().source, "spotify");
  assert.equal(env.music.status().playing, false);
  assert.equal(env.music.status().externalPlayback, true);
  const spotifyPanel = env.ids.get("music-spotify-panel");
  const embeds = () => spotifyPanel.children.flatMap((child) => child.children).filter((child) => child.tagName === "iframe");
  assert.equal(embeds().length, 1);
  assert.match(embeds()[0].src, /^https:\/\/open\.spotify\.com\/embed\/album\//);
  env.music.setSource("local");
  assert.equal(embeds().length, 0, "leaving Spotify removes its live playback frame");
  assert.equal(env.audio.paused, true, "switching sources is not implicit autoplay");
});

test("Theme selection updates global tokens, emits graph palette changes and survives a restart", () => {
  const env = environment();
  env.music.applyTheme("violet");
  assert.equal(env.styles.get("--gold-bright"), "#dcc4ff");
  assert.equal(env.styles.get("--studio-accent-rgb"), "178,151,222");
  assert.equal(env.document.documentElement.dataset.studioTheme, "violet");
  assert.ok(env.events.some((event) => event.type === "mefi-theme-change" && event.detail.theme === "violet"));
  const restored = environment({ saved: JSON.parse(env.storage.get("mefiStudio.music.v1")) });
  assert.equal(restored.music.status().theme, "violet");
  assert.equal(restored.music.status().queueLength, 0);
});

test("Node preferences default to classic orbs and constellation and reject unsupported saved values", () => {
  for (const saved of [null, { nodeStyle: "untrusted", nodeLayout: "columns" }, { nodeStyle: "__proto__", nodeLayout: "toString" }]) {
    const env = environment({ saved });
    assert.equal(env.music.status().nodeStyle, "orbs");
    assert.equal(env.music.status().nodeLayout, "constellation");
    assert.equal(env.document.documentElement.dataset.nodeStyle, "orbs");
    assert.equal(env.document.documentElement.dataset.nodeLayout, "constellation");
    const events = env.events.filter((event) => event.type === "mefi-tree-preferences");
    assert.equal(events.length, 1, "initialization publishes the saved choices exactly once");
    assert.equal(events[0].detail.nodeStyle, "orbs");
    assert.equal(events[0].detail.nodeLayout, "constellation");
    assert.equal(env.ids.get("music-node-style-orbs").attrs["aria-pressed"], "true");
    assert.equal(env.ids.get("music-node-layout-constellation").attrs["aria-pressed"], "true");
  }
});

test("Node controls persist independent style and layout choices and accurately expose selection", () => {
  const env = environment();
  env.ids.get("music-node-layout-tree").click();
  env.ids.get("music-node-style-glass").click();
  assert.equal(env.music.status().nodeStyle, "glass");
  assert.equal(env.music.status().nodeLayout, "tree", "style selection must not rearrange the layout");
  env.ids.get("music-node-layout-radial").click();
  assert.equal(env.music.status().nodeStyle, "glass", "layout selection must retain the visual style");
  for (const [groupId, selected] of [["music-node-styles", "music-node-style-glass"], ["music-node-layouts", "music-node-layout-radial"]]) {
    const group = env.ids.get(groupId);
    assert.equal(group.attrs.role, "group");
    assert.ok(group.attrs["aria-labelledby"]);
    assert.deepEqual(group.children.filter((choice) => choice.attrs["aria-pressed"] === "true").map((choice) => choice.id), [selected]);
    assert.ok(group.children.every((choice) => choice.tagName === "button" && choice.type === "button"));
    assert.ok(group.children.every((choice) => choice.children[0].attrs["aria-hidden"] === "true"), "decorative previews do not repeat the accessible label");
  }
  const last = env.events.filter((event) => event.type === "mefi-tree-preferences").at(-1);
  assert.equal(last.detail.nodeStyle, "glass");
  assert.equal(last.detail.nodeLayout, "radial");
  const persisted = JSON.parse(env.storage.get("mefiStudio.music.v1"));
  const restored = environment({ saved: persisted });
  assert.equal(restored.music.graphPreferences().nodeStyle, "glass");
  assert.equal(restored.music.graphPreferences().nodeLayout, "radial");
  const copy = restored.music.graphPreferences();
  copy.nodeStyle = "minimal";
  assert.equal(restored.music.graphPreferences().nodeStyle, "glass", "readers cannot mutate the stored preference object");
});

test("Node preferences preserve color, volume, Spotify links and live playback across changes", async () => {
  const link = "https://open.spotify.com/playlist/37i9dQZF1DX7zqr9q1MPG7";
  const env = environment({ saved: { theme: "forest", volume: .35, spotify: [link], nodeStyle: "glass", nodeLayout: "radial" } });
  env.music.addFiles([file("Independent music.mp3")]);
  env.ids.get("music-play").click(); await flush();
  env.music.applyNodeStyle("minimal");
  env.music.applyNodeLayout("tree");
  assert.equal(env.music.status().playing, true);
  assert.equal(env.audio.volume, .35);
  assert.equal(env.music.status().theme, "forest");
  const treeEvents = env.events.filter((event) => event.type === "mefi-tree-preferences").length;
  env.music.applyTheme("violet");
  assert.equal(env.events.filter((event) => event.type === "mefi-tree-preferences").length, treeEvents, "color changes cannot trigger a layout event");
  const saved = JSON.parse(env.storage.get("mefiStudio.music.v1"));
  assert.deepEqual(saved, { theme: "violet", customColors: { ...env.music.customColors() }, volume: .35, spotify: [link], nodeStyle: "minimal", nodeLayout: "tree", orbitTrails: false, extraGlow: false });
  assert.equal(env.music.status().nodeStyle, "minimal");
  assert.equal(env.music.status().nodeLayout, "tree");
});

test("Preference setters validate input and optional previews do not overwrite persisted choices", () => {
  const saved = { theme: "midnight", volume: .6, spotify: [], nodeStyle: "glass", nodeLayout: "radial" };
  const env = environment({ saved });
  const before = env.storage.get("mefiStudio.music.v1");
  assert.equal(env.music.applyNodeStyle("unsupported", false), "orbs");
  assert.equal(env.music.applyNodeLayout("constructor", false), "constellation");
  assert.equal(env.storage.get("mefiStudio.music.v1"), before);
  assert.equal(env.music.status().theme, "midnight");
  assert.equal(env.audio.volume, .6);
  assert.equal(env.document.documentElement.dataset.nodeStyle, "orbs");
  assert.equal(env.document.documentElement.dataset.nodeLayout, "constellation");
});

test("Graph effects are opt-in Boolean preferences with accessible native checkboxes", () => {
  for (const saved of [null, { orbitTrails: "true", extraGlow: "1" }, { orbitTrails: 1, extraGlow: {} }]) {
    const env = environment({ saved });
    for (const [key, id] of [["orbitTrails", "music-orbit-trails"], ["extraGlow", "music-extra-glow"]]) {
      assert.equal(env.music.status()[key], false);
      assert.equal(env.music.graphPreferences()[key], false);
      const input = env.ids.get(id);
      assert.equal(input.tagName, "input");
      assert.equal(input.type, "checkbox");
      assert.equal(input.checked, false);
      assert.ok(input.attrs["aria-label"]);
      assert.ok(env.ids.get(input.attrs["aria-describedby"]), "effect has an associated explanatory description");
      assert.equal(env.events.find((event) => event.type === "mefi-tree-preferences").detail[key], false);
    }
  }
});

test("Graph effects update independently, persist and never start playback or recommendations", async () => {
  let requests = 0;
  const link = "https://open.spotify.com/playlist/37i9dQZF1DX7zqr9q1MPG7";
  const env = environment({ saved: { theme: "forest", volume: .35, spotify: [link], nodeStyle: "minimal", nodeLayout: "radial" }, recommend: async () => { requests += 1; return { ok: true, text: "Unused" }; } });
  env.music.addFiles([file("Quiet track.mp3")]);
  env.audio.currentTime = 17;
  const playerEvents = env.events.filter((event) => event.type === "mefi-music-change").length;
  for (const id of ["music-orbit-trails", "music-extra-glow"]) {
    const input = env.ids.get(id); input.checked = true; input.dispatch("change");
  }
  await flush();
  assert.deepEqual({ ...env.music.graphPreferences() }, { nodeStyle: "minimal", nodeLayout: "radial", orbitTrails: true, extraGlow: true });
  assert.deepEqual({ ...env.events.filter((event) => event.type === "mefi-tree-preferences").at(-1).detail }, { nodeStyle: "minimal", nodeLayout: "radial", orbitTrails: true, extraGlow: true });
  assert.equal(env.events.filter((event) => event.type === "mefi-music-change").length, playerEvents);
  assert.equal(requests, 0);
  assert.equal(env.audio.paused, true);
  assert.equal(env.audio.currentTime, 17);
  assert.equal(env.audio.volume, .35);
  assert.equal(env.music.status().queueLength, 1);
  const saved = JSON.parse(env.storage.get("mefiStudio.music.v1"));
  assert.deepEqual(saved, { theme: "forest", customColors: { ...env.music.customColors() }, volume: .35, spotify: [link], nodeStyle: "minimal", nodeLayout: "radial", orbitTrails: true, extraGlow: true });
  const restored = environment({ saved });
  assert.equal(restored.ids.get("music-orbit-trails").checked, true);
  assert.equal(restored.ids.get("music-extra-glow").checked, true);
  restored.music.applyNodeEffects({ orbitTrails: false });
  assert.equal(restored.music.status().extraGlow, true, "changing one effect retains the other");
  restored.music.applyNodeStyle("glass"); restored.music.applyNodeLayout("tree"); restored.music.applyTheme("violet");
  assert.equal(restored.music.status().extraGlow, true, "style, layout and colors retain effect choices");
  assert.equal(restored.music.status().orbitTrails, false);
  const persisted = restored.storage.get("mefiStudio.music.v1");
  restored.music.applyNodeEffects({ extraGlow: "true", injected: true }, false);
  assert.equal(restored.music.status().extraGlow, false, "only a Boolean true enables effects");
  assert.equal(restored.storage.get("mefiStudio.music.v1"), persisted, "temporary previews do not overwrite saved effects");
  assert.equal(Object.hasOwn(restored.music.graphPreferences(), "injected"), false);
});

test("Live tree settings claim the original view, use measured canvas space and restore Workspace on close", () => {
  const env = environment({ preview: true, workspaceActive: true });
  env.music.open();
  assert.deepEqual(env.lifecycle, ["claim:music", "workspace:exit"], "claim the origin before activating a graph preview");
  assert.equal(env.ids.get("music-overlay").hidden, false);
  const sheet = env.ids.get("music-overlay").children[0];
  assert.equal(sheet.attrs["aria-modal"], "false", "the live graph remains available beside settings");
  env.frames();
  assert.deepEqual(env.lifecycle.at(-1), { x: 400, y: 80, w: 600, h: 640 });
  env.resize({ x: 320, y: 60, width: 306, height: 688 });
  env.frames();
  assert.deepEqual(env.lifecycle.at(-1), { x: 320, y: 60, w: 306, h: 688 });
  env.music.open(); env.frames();
  assert.equal(env.lifecycle.filter((item) => item === "claim:music").length, 1, "reopening does not replace the saved origin");
  env.music.close();
  assert.deepEqual(env.lifecycle.slice(-3), ["preview:close", "workspace:enter", "release:music"]);
  assert.equal(env.ids.get("music-overlay").hidden, true);
});

test("Closing settings cancels pending canvas activation and non-Workspace origins stay unchanged", () => {
  const env = environment({ preview: true });
  env.music.open(); env.music.close(); env.frames();
  assert.deepEqual(env.lifecycle, ["claim:music", "preview:close", "release:music"]);
  env.resize({ x: 20, y: 40, width: 400, height: 220 }); env.frames();
  assert.equal(env.lifecycle.length, 3, "a closed panel cannot reactivate the graph on resize");
  env.music.open(); env.frames();
  assert.deepEqual(env.lifecycle.at(-1), { x: 20, y: 40, w: 400, h: 220 });
  env.music.close();
  assert.equal(env.lifecycle.includes("workspace:enter"), false);
});

test("Music recommendations call only the dedicated safe service and construct trusted Spotify searches", async () => {
  const asks = [];
  const env = environment({ recommend: async (request) => { asks.push(request); return { ok: true, suggestions: [{ title: "Fixture Song", artist: "An artist", reason: "Quiet texture", query: "Fixture Song An artist", url: "javascript:alert(1)" }] }; } });
  assert.equal(asks.length, 0);
  env.ids.get("music-mood").value = "Calm music";
  env.ids.get("music-recommend").click(); await flush();
  assert.equal(asks.length, 1);
  assert.equal(asks[0].mood, "Calm music");
  const output = env.ids.get("music-recommendation");
  assert.match(output.textContent, /Fixture Song/);
  output.children[0].children.at(-1).click(); await flush();
  assert.deepEqual(env.opened, ["https://open.spotify.com/search/Fixture%20Song%20An%20artist"]);
  const disconnected = environment();
  assert.equal(disconnected.ids.get("music-recommend").disabled, true);
});

test("expanded node choices persist without disturbing effects, colors, or playback", () => {
  const env = environment({ saved: { theme: "aurora", orbitTrails: true, extraGlow: true } });
  for (const style of ["halo", "crystal"]) {
    env.ids.get(`music-node-style-${style}`).click();
    assert.equal(env.music.graphPreferences().nodeStyle, style);
    assert.equal(env.ids.get(`music-node-style-${style}`).attrs["aria-pressed"], "true");
  }
  for (const layout of ["helix", "layers"]) {
    env.ids.get(`music-node-layout-${layout}`).click();
    assert.equal(env.music.graphPreferences().nodeLayout, layout);
    assert.equal(env.music.graphPreferences().nodeStyle, "crystal");
  }
  const restored = environment({ saved: JSON.parse(env.storage.get("mefiStudio.music.v1")) });
  assert.deepEqual({ ...restored.music.graphPreferences() }, { nodeStyle: "crystal", nodeLayout: "layers", orbitTrails: true, extraGlow: true });
  assert.equal(restored.music.status().theme, "aurora");assert.equal(restored.music.status().playing, false);
});

test("custom palettes accept only six-digit colors and preserve unrelated settings", () => {
  for (const invalid of ["red", "#fff", "#12345678", "url(http://x)", "var(--x)", "#GGGGGG", 123456]) assert.equal(helpers.hexColor(invalid), null);
  assert.equal(helpers.hexColor(" #a1b2c3 "), "#A1B2C3");
  const env = environment({ saved: { theme: "rose", volume: .4, nodeStyle: "halo", nodeLayout: "helix", customColors: { accent: "#83cbaa", background: "invalid", injected: "#123456" } } });
  assert.equal(env.music.customColors().accent, "#83CBAA");assert.equal(env.music.customColors().background, "#050507");
  const before = JSON.stringify(env.music.customColors());
  assert.equal(env.music.applyCustomColors({ accent: "#AA00BB", surface: "invalid" }), false);
  assert.equal(JSON.stringify(env.music.customColors()), before, "invalid batches make no partial changes");
  assert.equal(env.music.status().theme, "rose");
  assert.equal(env.music.applyCustomColors({ accent: "#22bbaa", injected: "javascript:bad" }), true);
  assert.equal(env.music.status().theme, "custom");assert.equal(env.music.status().nodeStyle, "halo");
  assert.equal(env.music.status().nodeLayout, "helix");assert.equal(env.audio.volume, .4);
  const copy = env.music.customColors();copy.accent = "#000000";
  assert.equal(env.music.customColors().accent, "#22BBAA");
  assert.equal(Object.hasOwn(env.music.customColors(), "injected"), false);
});

test("accessible custom color controls live-apply, reject incomplete hex, reset, and survive reload", () => {
  const env = environment();env.music.applyTheme("custom");
  assert.equal(env.ids.get("music-custom-palette").hidden, false);
  const hex = env.ids.get("music-color-accent-hex"), picker = env.ids.get("music-color-accent");
  assert.equal(picker.type, "color");assert.ok(picker.attrs["aria-label"]);assert.ok(hex.attrs["aria-describedby"]);
  hex.value = "#12";hex.dispatch("input");
  assert.equal(hex.attrs["aria-invalid"], "true");assert.equal(env.music.customColors().accent, "#C9A86A");
  hex.value = "#63aece";hex.dispatch("input");
  assert.equal(hex.attrs["aria-invalid"], "false");assert.equal(picker.value, "#63AECE");
  picker.value = "#BD88DC";picker.dispatch("input");assert.equal(hex.value, "#BD88DC");
  const restored = environment({ saved: JSON.parse(env.storage.get("mefiStudio.music.v1")) });
  assert.equal(restored.music.status().theme, "custom");assert.equal(restored.music.customColors().accent, "#BD88DC");
  restored.music.applyTheme("aurora");assert.equal(restored.ids.get("music-custom-palette").hidden, true);
  restored.music.applyTheme("custom");assert.equal(restored.music.customColors().accent, "#BD88DC", "presets do not discard custom colors");
  restored.ids.get("music-custom-reset").click();assert.equal(restored.music.customColors().accent, "#C9A86A");
});

test("theme events carry readable UI and canvas palettes without changing graph layout or requesting audio", () => {
  let requests = 0;
  const env = environment({ recommend: () => { requests++; } });
  const graphEvents = env.events.filter((event) => event.type === "mefi-tree-preferences").length;
  const playerEvents = env.events.filter((event) => event.type === "mefi-music-change").length;
  for (const theme of ["aurora", "rose"]) {
    env.music.applyTheme(theme);
    const palette = env.music.themePalette();
    assert.equal(palette.theme, theme);assert(helpers.contrast(palette.text, palette.surface) >= 4.5);
  }
  // Opposing canvas/panel colors require separately derived foregrounds.
  env.music.applyCustomColors({ accent: "#777777", background: "#FFFFFF", surface: "#000000", text: "#222222" });
  const event = env.events.filter((entry) => entry.type === "mefi-theme-change").at(-1).detail;
  assert.equal(event.background, "#FFFFFF");assert.equal(event.surface, "#000000");
  assert(helpers.contrast(event.text, event.surface) >= 4.5);
  assert(helpers.contrast(event.muted, event.surface) >= 4.5);
  assert(helpers.contrast(event.border, event.surface) >= 3);
  assert(helpers.contrast(event.canvas.text, event.canvas.background) >= 4.5);
  assert(helpers.contrast(event.canvas.muted, event.canvas.background) >= 4.5);
  assert.equal(event.tokens["--ivory"], event.text);assert.equal(env.styles.get("--cmd-bg"), event.canvas.background);
  assert.equal(env.styles.get("--canvas-text"), event.canvas.text);assert.equal(env.styles.get("--canvas-muted"), event.canvas.muted);
  assert.equal(env.events.filter((entry) => entry.type === "mefi-tree-preferences").length, graphEvents);
  assert.equal(env.events.filter((entry) => entry.type === "mefi-music-change").length, playerEvents);
  assert.equal(env.audio.paused, true);assert.equal(requests, 0);
  assert.equal(env.music.customColors().text, "#222222", "the chosen color remains saved even when displayed text needs contrast correction");
});

test("live preview view controls change the real tree and follow external view changes", () => {
  const env = environment({ preview: true });env.music.open();
  const flat=env.ids.get("music-tree-view-2d"),solid=env.ids.get("music-tree-view-3d");
  assert.equal(flat.attrs["aria-pressed"],"false");assert.equal(solid.attrs["aria-pressed"],"true");
  assert.equal(flat.disabled,false);assert.ok(flat.attrs["aria-label"]);
  flat.click();assert.equal(flat.attrs["aria-pressed"],"true");assert.equal(solid.attrs["aria-pressed"],"false");
  env.view("3d");assert.equal(solid.attrs["aria-pressed"],"true");
  assert.equal(env.music.status().nodeLayout,"constellation");assert.equal(env.music.status().playing,false);
  const noGraph=environment();assert.equal(noGraph.ids.get("music-tree-view-2d").disabled,true,"unavailable canvas is not offered as a working control");
});

test("Audio link settings choose their source and response without connecting until the user requests it", () => {
  const calls = [];
  let status = { selection: "auto", source: "auto", reactive: false, listening: false, pending: false, error: null, response: 1, label: "Audio link off", description: "Choose a source and connect." };
  const env = environment({ preview: true, audioLink: {
    audioStatus: () => status,
    setAudioSource: (selection) => { calls.push(["source", selection]); status = { ...status, selection }; },
    setAudioResponse: (response) => { calls.push(["response", response]); status = { ...status, response }; },
    setMusicReactive: (reactive) => { calls.push(["connect", reactive]); status = { ...status, reactive, pending: reactive && status.selection !== "local", listening: false, label: !reactive ? "Audio link off" : status.selection === "local" ? "Add a track to link" : "Connecting audio…" }; },
  } });
  const selector = env.ids.get("music-audio-source"), toggle = env.ids.get("music-audio-toggle"), response = env.ids.get("music-audio-response");
  env.music.open(); env.frames();
  assert.deepEqual(calls, [], "opening and painting the settings preview cannot request capture");
  assert.equal(selector.disabled, false, "a source can be chosen before any capture starts");
  assert.deepEqual(selector.children.map((option) => option.value), ["auto", "local", "desktop", "mic"]);
  assert.equal(toggle.textContent, "Connect audio");
  assert.equal(toggle.attrs["aria-pressed"], "false");
  selector.value = "mic"; selector.dispatch("change");
  const announcements = env.ids.get("music-audio-state").textWrites;
  response.value = "1.65"; response.dispatch("input");
  assert.equal(env.ids.get("music-audio-state").textWrites, announcements, "response changes do not repeat an unchanged live announcement");
  assert.deepEqual(calls, [["source", "mic"], ["response", 1.65]]);
  assert.equal(response.parentElement.children.at(-1).textContent, "165%");
  assert.equal(response.type, "range");
  assert.equal(response.min, "0"); assert.equal(response.max, "2");
  assert.equal(selector.attrs["aria-describedby"], "music-audio-hint");
  toggle.click();
  assert.deepEqual(calls.at(-1), ["connect", true]);
  assert.equal(toggle.textContent, "Disconnect", "a pending capture can be cancelled from the same control");
  assert.equal(toggle.attrs["aria-pressed"], "true");
  assert.equal(env.ids.get("music-audio-state").textContent, "Connecting audio…");
  toggle.click();
  assert.deepEqual(calls.at(-1), ["connect", false]);
  assert.equal(toggle.textContent, "Connect audio");
  assert.equal(env.audio.paused, true, "link controls never start local transport");
  selector.value = "local"; selector.dispatch("change");
  toggle.click();
  assert.equal(toggle.textContent, "Disconnect", "an armed local link can be cancelled while waiting for the first track");
  assert.equal(env.ids.get("music-audio-state").textContent, "Add a track to link");
  toggle.click();
  assert.deepEqual(calls.at(-1), ["connect", false]);
  assert.equal(toggle.attrs["aria-pressed"], "false");
});

test("Audio link mirrors Command changes, retries failed capture and disconnects without stopping local playback", async () => {
  const requests = [];
  let status = { selection: "desktop", source: "desktop", reactive: true, listening: false, pending: false, error: "Access denied", response: .75, label: "Audio unavailable", description: "Audio access was not allowed. Connect to retry." };
  const env = environment({ audioLink: {
    audioStatus: () => status,
    setAudioSource: () => {}, setAudioResponse: () => {},
    setMusicReactive: (enabled) => {
      requests.push(enabled);
      status = { ...status, reactive: enabled, error: null, listening: false, pending: enabled, label: enabled ? "Connecting audio…" : "Audio link off" };
    },
  } });
  const toggle = env.ids.get("music-audio-toggle");
  env.music.open();
  assert.equal(toggle.textContent, "Retry audio link");
  assert.equal(env.ids.get("music-audio-state").attrs.role, "status");
  assert.match(env.ids.get("music-audio-hint").textContent, /not allowed/);
  toggle.click();
  assert.deepEqual(requests, [true]);
  assert.equal(toggle.textContent, "Disconnect");
  env.music.addFiles([file("Keep playing.mp3")]);
  env.ids.get("music-play").click(); await flush();
  assert.equal(env.audio.paused, false);
  status = { ...status, selection: "auto", source: "local", listening: true, pending: false, response: 1.3, label: "Track linked", description: "Following the Studio player." };
  env.emit("mefi-audio-change", status);
  assert.equal(env.ids.get("music-audio-source").value, "auto");
  assert.equal(env.ids.get("music-audio-response").value, "1.3");
  assert.equal(env.ids.get("music-audio-response").parentElement.children.at(-1).textContent, "130%");
  assert.equal(env.ids.get("music-audio-state").textContent, "Track linked");
  assert.equal(env.ids.get("music-audio-hint").textContent, "Following the Studio player.");
  assert.equal(toggle.attrs["aria-pressed"], "true");
  assert.deepEqual(requests, [true], "a Command status notification does not request capture again");
  toggle.click();
  assert.deepEqual(requests, [true, false]);
  assert.equal(env.audio.paused, false, "disconnecting the nodes leaves the local track playing");
  assert.equal(toggle.attrs["aria-pressed"], "false");
});

test("Audio link controls remain unavailable when the Command audio API is absent", () => {
  const env = environment(); env.music.open();
  for (const id of ["music-audio-toggle", "music-audio-source", "music-audio-response", "music-audio-waves", "music-audio-splitBands", "music-audio-nodes", "music-audio-percussion", "music-audio-background"]) assert.equal(env.ids.get(id).disabled, true, id);
  assert.equal(env.ids.get("music-audio-state").textContent, "Audio link off");
  assert.equal(env.audio.paused, true);
});

test("Audio reactions start gently and provide independent accessible checkboxes", () => {
  const env = environment({ audioLink: { audioStatus: () => ({}), setAudioEffects() {}, setAudioResponse() {} } });
  assert.equal(env.ids.get("music-audio-response").value, "0.35");
  assert.equal(env.ids.get("music-audio-response").parentElement.children.at(-1).textContent, "35%");
  const defaults = { waves: true, splitBands: true, nodes: true, percussion: false, background: false };
  const labels = { waves: "Connection waves", splitBands: "Separate frequency lines", nodes: "Node glow", percussion: "Drum accents", background: "Background glow" };
  for (const [key, enabled] of Object.entries(defaults)) {
    const input = env.ids.get(`music-audio-${key}`);
    assert.equal(input.tagName, "input"); assert.equal(input.type, "checkbox");
    assert.equal(input.disabled, false); assert.equal(input.checked, enabled);
    assert.equal(input.attrs["aria-label"], labels[key]);
    assert.ok(env.ids.get(input.attrs["aria-describedby"]).textContent, "each reaction explains its visible effect");
    assert.equal(input.parentElement.tagName, "label", "the full row activates the native checkbox");
    assert.equal(input.parentElement.parentElement.attrs.role, "group");
  }
  const response = env.ids.get("music-audio-response");
  assert.ok(response.attrs["aria-label"]);
  assert.match(env.ids.get(response.attrs["aria-describedby"]).textContent, /0%.*without changing playback volume/);
});

test("Audio reaction choices restore from the host and follow external status updates without changing capture", () => {
  let writes = 0;
  const saved = { waves: false, splitBands: false, nodes: false, percussion: true, background: true };
  const status = { selection: "desktop", response: 0, effects: saved, reactive: true, listening: true, label: "Desktop linked" };
  const env = environment({ audioLink: {
    audioStatus: () => status,
    setAudioEffects: () => { writes += 1; }, setAudioResponse: () => { writes += 1; },
    setAudioSource: () => { writes += 1; }, setMusicReactive: () => { writes += 1; },
  } });
  env.music.open();
  for (const [key, enabled] of Object.entries(saved)) assert.equal(env.ids.get(`music-audio-${key}`).checked, enabled);
  assert.equal(env.ids.get("music-audio-response").value, "0", "a saved zero remains zero");
  assert.equal(env.ids.get("music-audio-response").parentElement.children.at(-1).textContent, "0%");
  const changed = { waves: true, splitBands: true, nodes: false, percussion: false, background: true };
  env.emit("mefi-audio-change", { ...status, effects: changed, response: .2 });
  for (const [key, enabled] of Object.entries(changed)) assert.equal(env.ids.get(`music-audio-${key}`).checked, enabled);
  assert.equal(env.ids.get("music-audio-response").value, "0.2");
  assert.equal(env.ids.get("music-audio-source").value, "desktop");
  assert.equal(env.ids.get("music-audio-toggle").attrs["aria-pressed"], "true");
  assert.equal(writes, 0, "restoring and synchronizing controls only reads the host's preferences");
  assert.equal(env.audio.paused, true);
});

test("Audio reactions submit only the changed choice and zero strength leaves playback and capture alone", async () => {
  const calls = [];
  let requests = 0;
  let status = { selection: "local", response: .35, effects: { waves: true, splitBands: true, nodes: true, percussion: false, background: false }, reactive: true, listening: true, label: "Track linked" };
  const env = environment({ recommend: async () => { requests += 1; }, audioLink: {
    audioStatus: () => status,
    setAudioEffects: (effects) => { calls.push(["effects", { ...effects }]); status = { ...status, effects: { ...status.effects, ...effects } }; },
    setAudioResponse: (response) => { calls.push(["response", response]); status = { ...status, response }; },
    setAudioSource: () => { calls.push(["source"]); }, setMusicReactive: () => { calls.push(["capture"]); },
  } });
  env.music.addFiles([file("Keep this quiet.mp3")]);
  env.audio.currentTime = 17;
  const expected = { ...status.effects };
  for (const key of Object.keys(expected)) {
    const input = env.ids.get(`music-audio-${key}`);
    expected[key] = !expected[key]; input.checked = expected[key]; input.dispatch("change");
    assert.deepEqual(calls.at(-1), ["effects", { [key]: expected[key] }]);
    for (const [other, enabled] of Object.entries(expected)) assert.equal(env.ids.get(`music-audio-${other}`).checked, enabled, `${key} leaves ${other} independent`);
  }
  const response = env.ids.get("music-audio-response");
  response.value = "0"; response.dispatch("input");
  assert.deepEqual(calls.at(-1), ["response", 0], "zero is passed as a number to the host");
  assert.equal(response.value, "0"); assert.equal(response.parentElement.children.at(-1).textContent, "0%");
  assert.equal(env.audio.paused, true, "changing preferences never starts playback");
  assert.equal(env.audio.currentTime, 17); assert.equal(env.audio.volume, .7);
  env.ids.get("music-play").click(); await flush();
  assert.equal(env.audio.paused, false);
  const waves = env.ids.get("music-audio-waves"); waves.checked = true; waves.dispatch("change");
  response.value = ".1"; response.dispatch("input");
  assert.equal(env.audio.paused, false, "changing preferences does not stop a playing track");
  assert.equal(env.audio.currentTime, 17); assert.equal(env.audio.volume, .7);
  assert.equal(calls.some(([type]) => type === "source" || type === "capture"), false);
  assert.equal(requests, 0);
});
