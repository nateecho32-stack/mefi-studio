import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/music.js", import.meta.url), "utf8");
const pure = vm.createContext({ URL });
vm.runInContext(`${source.slice(source.indexOf("  const THEMES"), source.indexOf("  let stored;"))}\nthis.api = {spotifyLink, mediaLink, playableLink, startSeconds, safePreferences, audioFile, nextIndex, timeLabel, hexColor, resolvePalette, contrast};`, pure);
const helpers = pure.api;
const flush = async () => { for (let index = 0; index < 15; index += 1) await Promise.resolve(); };

function environment({ saved = null, recommend, preview = false, previewRegistered = false, workspaceActive = false, audioLink = null, search = "", premiumSaved = null, hint = null, community = null, bridge = null } = {}) {
  const ids = new Map();
  const events = [];
  const revoked = [];
  const opened = [];
  const styles = new Map();
  const storage = new Map(saved ? [["mefiStudio.music.v1", JSON.stringify(saved)]] : []);
  // The Void collection: a saved premium choice and the community boot hint.
  if (premiumSaved) storage.set("mefiStudio.music.premium.v1", JSON.stringify(premiumSaved));
  if (hint) storage.set("mefiStudio.community.v1", JSON.stringify(hint));
  const writes = [];
  const toasts = [];
  const lifecycle = [];
  const frames = new Map();
  const listeners = new Map();
  const documentListeners = new Map();
  let frameId = 0;
  let previewRect = { x: 400, y: 80, width: 600, height: 640 };
  let treeView = "3d";
  let audio;
  const audios = [];
  const refused = new Set();
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  let minInterval = 1;
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
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    getBoundingClientRect() { return previewRect; }
  }
  class Audio extends Element {
    constructor() { super("audio"); this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 120; this.volume = 1; this.src = ""; }
    // Like Chromium, a load that fails leaves the element unpaused with an error.
    async play() { if (!this.src) throw new Error("No source"); this.paused = false; this.ended = false; if (refused.has(this.src)) { this.error = { code: 4 }; throw new Error("Refused by fixture"); } this.dispatch("play"); }
    pause() { this.paused = true; this.dispatch("pause"); }
    load() { this.currentTime = 0; this.ended = false; this.error = null; this.dispatch("loadedmetadata"); }
  }
  class RuntimeURL extends URL {
    static createObjectURL() { return `blob:fixture-${++blob}`; }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  document = {
    readyState: "loading", activeElement: null, documentElement: new Element("html"), body: new Element("body"),
    addEventListener: (type, callback) => documentListeners.set(type, callback),
    removeEventListener: (type, callback) => { if (documentListeners.get(type) === callback) documentListeners.delete(type); },
    getElementById: (id) => ids.get(id) ?? null,
    createElement: (tag) => tag === "audio" ? (audios.push(audio = new Audio()), audio) : new Element(tag),
  };
  const context = vm.createContext({
    URL: RuntimeURL, document,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: {
      dispatchEvent: (event) => events.push(event), addEventListener: (type, callback) => listeners.set(type, callback), open: (url) => opened.push(url),
      requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: (id) => frames.delete(id),
      performance: { now: () => clock },
      location: { search },
      setTimeout: (callback, delay = 0) => { timers.set(++timerId, { at: clock + delay, callback }); return timerId; },
      clearTimeout: (id) => { timers.delete(id); },
      setInterval: (callback, delay = 0) => { const every = Math.max(minInterval, delay); timers.set(++timerId, { at: clock + every, every, callback }); return timerId; },
      clearInterval: (id) => { timers.delete(id); },
      MefiNav: { get: (id) => (previewRegistered && id === "appearancePreview") || ["help", "palette", "profiler"].includes(id) ? { id, kind: "overlay" } : null, claim: (id) => lifecycle.push(`claim:${id}`), release: (id) => lifecycle.push(`release:${id}`) },
      ...(preview || audioLink ? {
        MefiIdle: {
          ...(preview ? { setSettingsPreview: (rect) => lifecycle.push(rect ? { ...rect } : "preview:close"), status: () => ({ view: treeView }), setView: (view) => { treeView = view; listeners.get("mefi-tree-view")?.({ detail: { view } }); } } : {}),
          ...audioLink,
        },
      } : {}),
      ...(preview ? {
        MefiWorkspace: { isActive: () => workspaceActive, exit: () => { workspaceActive = false; lifecycle.push("workspace:exit"); }, enter: () => { workspaceActive = true; lifecycle.push("workspace:enter"); } },
      } : {}),
      mefiStudio: { ...(recommend ? { musicRecommend: recommend } : {}), openExternal: (url) => { opened.push(url); return Promise.resolve(); }, ...bridge },
      MefiToast: (text, kind) => toasts.push([text, kind]),
      ...(community ? { MefiCommunity: community } : {}),
    },
  });
  vm.runInContext(source, context);
  const music = context.window.MefiMusic;
  music.init();
  return { music, window: context.window, ids, events, revoked, opened, styles, storage, document, audio, audios, refused, lifecycle, writes, toasts,
    // Intervals created after this tick no faster than `ms`, like a hidden window.
    throttle: (ms) => { minInterval = ms; },
    // Runs every timer that falls due, in order, as if `ms` had passed.
    advance: (ms) => {
      const end = clock + ms;
      for (;;) {
        let next = null;
        for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        const [id, timer] = next;
        clock = timer.at;
        if (timer.every) timer.at += timer.every; else timers.delete(id);
        timer.callback();
      }
      clock = end;
    },
    frames: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); },
    resize: (rect) => { previewRect = rect; listeners.get("resize")?.(); },
    view: (view) => { treeView = view; listeners.get("mefi-tree-view")?.({ detail: { view } }); },
    emit: (type, detail) => listeners.get(type)?.({ detail }),
    pointer: (target) => documentListeners.get("pointerdown")?.({ target }),
    gesture: (type, target, detail = {}) => {
      const event = { type, target, pointerId: 1, button: 0, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...detail };
      listeners.get(type)?.(event);
      return event;
    },
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
  assert.equal(value.theme, "aurora"); assert.equal(value.volume, 1);
  assert.deepEqual(Array.from(value.links), [link], "the list saved before the Links tab is read into links");
  assert.deepEqual(Object.keys(value).sort(), ["customColors", "extraGlow", "links", "nodeLayout", "nodeStyle", "orbitTrails", "radioOn", "source", "station", "theme", "volume"]);
  assert.equal(helpers.safePreferences({ source: "spotify" }).source, "link", "the old Spotify tab comes back as Links");
  assert.equal(value.source, "local");
  assert.equal(value.radioOn, false);
  for (const bad of ["youtube", "RADIO", "__proto__", 1, null]) assert.equal(helpers.safePreferences({ source: bad, radioOn: "yes" }).source, "local", String(bad));
  assert.equal(helpers.safePreferences({ radioOn: "yes" }).radioOn, false, "only a real Boolean restarts a station");
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

test("A Spotify link pauses local audio, does not invent playback state and unloads when switching back", async () => {
  const env = environment();
  env.music.addFiles([file("Focus.mp3")]); env.ids.get("music-play").click(); await flush();
  assert.equal(env.music.loadSpotify("https://open.spotify.com/album/37i9dQZF1DX7zqr9q1MPG7"), true);
  assert.equal(env.audio.paused, true);
  assert.equal(env.music.status().source, "link");
  assert.equal(env.music.status().provider, "Spotify");
  assert.equal(env.music.status().playing, false);
  assert.equal(env.music.status().externalPlayback, true);
  const spotifyPanel = env.ids.get("music-link-panel");
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
  assert.deepEqual(saved, { theme: "violet", customColors: { ...env.music.customColors() }, volume: .35, links: [link], station: null, source: "local", radioOn: false, nodeStyle: "minimal", nodeLayout: "tree", orbitTrails: false, extraGlow: false });
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
  assert.deepEqual(saved, { theme: "forest", customColors: { ...env.music.customColors() }, volume: .35, links: [link], station: null, source: "local", radioOn: false, nodeStyle: "minimal", nodeLayout: "radial", orbitTrails: true, extraGlow: true });
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

test("glass reading surfaces and both action-gradient ends retain contrast for custom palettes", () => {
  const env = environment();
  for (const colors of [
    { accent: "#164AD8", background: "#FFFFFF", surface: "#101923", text: "#E8EEF4" },
    { accent: "#BA2460", background: "#050507", surface: "#F4EFF4", text: "#24202A" },
    { accent: "#777777", background: "#777777", surface: "#777777", text: "#777777" },
  ]) {
    env.music.applyCustomColors(colors);
    const palette = env.music.themePalette();
    for (const ink of [palette.text, palette.muted, palette.bright]) {
      assert.ok(helpers.contrast(ink, palette.readingBackground) >= 4.5);
    }
    assert.ok(helpers.contrast(palette.onAccent, palette.accent) >= 4.5);
    assert.ok(helpers.contrast(palette.onAccent, palette.actionEnd) >= 4.5);
    assert.equal(env.styles.get("--studio-reading-bg"), palette.readingBackground);
    assert.equal(env.styles.get("--studio-action-end"), palette.actionEnd);
    assert.equal(env.styles.get("--cmd-bg"), colors.background, "canvas preserves the selected background");
    assert.equal(env.music.customColors().surface, colors.surface, "contrast protection does not rewrite saved colours");
  }
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
  for (const id of ["music-audio-toggle", "music-audio-source", "music-audio-response", "music-audio-waves", "music-audio-splitBands", "music-audio-nodes", "music-audio-motion", "music-audio-percussion", "music-audio-background"]) assert.equal(env.ids.get(id).disabled, true, id);
  assert.equal(env.ids.get("music-audio-state").textContent, "Audio link off");
  assert.equal(env.audio.paused, true);
});

test("Audio reactions start gently and provide independent accessible checkboxes", () => {
  const env = environment({ audioLink: { audioStatus: () => ({}), setAudioEffects() {}, setAudioResponse() {} } });
  assert.equal(env.ids.get("music-audio-response").value, "0.35");
  assert.equal(env.ids.get("music-audio-response").parentElement.children.at(-1).textContent, "35%");
  const defaults = { waves: true, splitBands: true, nodes: true, motion: true, percussion: false, background: false };
  const labels = { waves: "Connection waves", splitBands: "Separate frequency lines", nodes: "Node glow", motion: "Tree motion", percussion: "Drum accents", background: "Background glow" };
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
  const saved = { waves: false, splitBands: false, nodes: false, motion: false, percussion: true, background: true };
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
  const changed = { waves: true, splitBands: true, nodes: false, motion: true, percussion: false, background: true };
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
  let status = { selection: "local", response: .35, effects: { waves: true, splitBands: true, nodes: true, motion: true, percussion: false, background: false }, reactive: true, listening: true, label: "Track linked" };
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

const mirror = (id, host = "ice1") => `https://${host}.somafm.com/${id}-128-mp3`;

test("A saved station is bounded to the built-in list", () => {
  assert.equal(helpers.safePreferences({ station: "groovesalad" }).station, "groovesalad");
  for (const bad of ["https://evil.test/stream", "blob:private", "", 7, null, "GROOVESALAD", "__proto__"]) assert.equal(helpers.safePreferences({ station: bad }).station, null, String(bad));
});

test("A station plays on the shared deck, reports internal playback and persists only its id", async () => {
  const env = environment();
  env.music.setSource("radio");
  assert.equal(env.ids.get("music-radio-panel").hidden, false);
  assert.equal(env.ids.get("music-local-panel").hidden, true);
  assert.equal(env.ids.get("music-radio-tab").attrs["aria-selected"], "true");
  assert.equal(env.ids.get("music-radio-stop").disabled, true, "nothing to stop before a station is chosen");
  env.ids.get("music-station-groovesalad").click(); await flush();
  assert.equal(env.audios.length, 1, "the first station needs no second deck");
  assert.equal(env.audio.src, mirror("groovesalad"));
  assert.equal(env.audio.crossOrigin, "anonymous", "CORS keeps a captured stream audible and readable");
  assert.equal(env.music.getAudioElement(), env.audio);
  const status = env.music.status();
  assert.equal(status.source, "radio");
  assert.equal(status.playing, true);
  assert.equal(status.externalPlayback, false, "radio is Studio's own playback, unlike Spotify");
  assert.equal(status.stationName, "Groove Salad");
  assert.equal(status.radioPhase, "playing");
  assert.equal(env.ids.get("music-radio-state").textContent, "Groove Salad · SomaFM · mirror 1 of 3");
  assert.equal(env.ids.get("music-station-groovesalad").attrs["aria-pressed"], "true");
  assert.equal(env.ids.get("music-station-dronezone").attrs["aria-pressed"], "false");
  assert.equal(env.ids.get("music-radio-stop").disabled, false);
  assert.equal(JSON.parse(env.storage.get("mefiStudio.music.v1")).station, "groovesalad");
  assert.ok(![...env.storage.values()].some((value) => value.includes("somafm.com")), "stream addresses are never persisted");
  env.ids.get("music-station-groovesalad").click(); await flush();
  assert.equal(env.audios.length, 1, "choosing the playing station again does not reconnect");
  assert.equal(env.audio.src, mirror("groovesalad"));
  env.ids.get("music-radio-stop").click();
  assert.equal(env.audio.paused, true);
  assert.equal(env.audio.src, "");
  assert.equal(env.music.status().radioPhase, "idle");
  assert.equal(env.ids.get("music-radio-stop").disabled, true);
  assert.equal(env.ids.get("music-radio-state").textContent, "Groove Salad ready");
});

test("Changing station mid-song crosses over on a second deck, then releases the first", async () => {
  const env = environment();
  env.music.tune("groovesalad"); await flush();
  const deckA = env.audio;
  env.music.tune("dronezone"); await flush();
  assert.equal(env.audios.length, 2);
  const deckB = env.audios[1];
  assert.equal(deckB.src, mirror("dronezone"));
  assert.equal(deckB.crossOrigin, "anonymous");
  assert.equal(env.music.getAudioElement(), deckB, "the analyser follows the deck that carries the station");
  assert.equal(deckA.paused, false, "the old station keeps sounding under the fade");
  env.advance(600);
  assert.ok(deckB.volume > 0 && deckB.volume < .7, "mid-fade both decks sound");
  assert.ok(deckA.volume > 0 && deckA.volume < .7);
  env.ids.get("music-radio-volume").value = ".4"; env.ids.get("music-radio-volume").dispatch("input");
  env.advance(1000);
  assert.equal(deckB.volume, .4, "a volume change made mid-fade is where the fade lands");
  assert.equal(deckA.paused, true);
  assert.equal(deckA.src, "", "the released deck drops its connection");
  assert.equal(JSON.parse(env.storage.get("mefiStudio.music.v1")).volume, .4);
  assert.equal(env.music.status().stationName, "Drone Zone");
  env.music.tune("lush"); await flush();
  assert.equal(env.audios.length, 2, "decks alternate instead of multiplying");
  assert.equal(env.music.getAudioElement(), deckA);
  assert.equal(deckA.src, mirror("lush"));
});

test("A new choice mid-fade settles the running fade first instead of racing it", async () => {
  const env = environment();
  env.music.tune("groovesalad"); await flush();
  env.music.tune("dronezone"); await flush();
  const [deckA, deckB] = env.audios;
  env.advance(400);
  env.music.tune("lush"); await flush();
  assert.equal(deckB.paused, false, "the deck that owned the fade keeps playing");
  assert.equal(deckA.src, mirror("lush"));
  env.advance(2000);
  assert.equal(deckA.src, mirror("lush"), "the superseded fade never releases the deck carrying the new station");
  assert.equal(deckA.paused, false);
  assert.equal(deckA.volume, .7);
  assert.equal(deckB.paused, true);
  assert.equal(deckB.src, "");
});

test("A stalled mirror hands over to the next on the other deck, and says so once every mirror is spent", async () => {
  const env = environment();
  env.music.tune("groovesalad"); await flush();
  env.audio.dispatch("waiting");
  assert.equal(env.music.status().radioPhase, "buffering");
  env.advance(3000);
  env.audio.dispatch("playing");
  env.advance(10000);
  assert.equal(env.audios.length, 1, "a stream that recovers on its own is left alone");
  assert.equal(env.music.status().radioPhase, "playing");
  env.audio.dispatch("stalled");
  env.advance(7000); await flush();
  assert.equal(env.audios.length, 2);
  assert.equal(env.audios[1].src, mirror("groovesalad", "ice2"));
  assert.equal(env.ids.get("music-radio-state").textContent, "Groove Salad · SomaFM · mirror 2 of 3 — The stream stopped sending. Moving to mirror 2.");
  env.advance(2000);
  assert.equal(env.audio.src, "", "the stalled mirror is released after the crossover");
  env.audios[1].dispatch("waiting"); env.advance(7000); await flush();
  assert.equal(env.audio.src, mirror("groovesalad", "ice4"));
  env.advance(2000);
  env.audio.dispatch("waiting"); env.advance(7000); await flush();
  assert.equal(env.music.status().radioPhase, "error");
  assert.equal(env.music.status().playing, false);
  assert.match(env.ids.get("music-radio-state").textContent, /Every mirror for Groove Salad was tried; choose it again to retry\.$/);
  env.audio.dispatch("playing");
  assert.equal(env.music.status().radioPhase, "playing", "a mirror that comes back on its own is welcomed back");
});

test("While a new station connects, the old deck's troubles cannot fail over the new one", async () => {
  const env = environment();
  env.music.tune("groovesalad"); await flush();
  env.refused.add(mirror("dronezone"));
  env.music.tune("dronezone");
  env.audio.dispatch("error");
  env.audio.dispatch("ended");
  await flush();
  assert.equal(env.audios[1].src, mirror("dronezone", "ice2"), "only the refusal moved the new station, exactly one mirror");
  assert.equal(env.music.status().stationName, "Drone Zone");
  // A real element that reaches its end is paused and ended, per the spec.
  env.audios[1].paused = true; env.audios[1].ended = true;
  env.audios[1].dispatch("ended"); await flush();
  assert.equal(env.music.getAudioElement().src, mirror("dronezone", "ice4"), "a settled stream that ends moves on like one that drops");
  assert.equal(env.music.status().playing, true);
});

test("A refused connection falls through to the next mirror, and a slow answer cannot take the speakers back", async () => {
  const env = environment();
  env.refused.add(mirror("groovesalad"));
  env.music.tune("groovesalad"); await flush();
  assert.equal(env.audios.length, 1);
  assert.equal(env.audio.src, mirror("groovesalad", "ice2"));
  assert.equal(env.music.status().radioPhase, "playing");
  assert.equal(env.ids.get("music-radio-state").textContent, "Groove Salad · SomaFM · mirror 2 of 3 — Groove Salad refused the connection (Refused by fixture). Moving to mirror 2.");

  const quick = environment();
  quick.music.tune("groovesalad"); quick.music.tune("dronezone"); await flush();
  assert.equal(quick.music.status().stationName, "Drone Zone");
  assert.equal(quick.music.getAudioElement().src, mirror("dronezone"));
  assert.equal(quick.audios.length, 1, "a choice that has not answered yet is redirected, not doubled up");
  quick.music.tune("lush"); quick.music.stopRadio(); await flush();
  assert.equal(quick.music.status().radioPhase, "idle", "an answer that lands after Stop is ignored");
  assert.equal(quick.music.status().playing, false);
  assert.ok(quick.audios.every((deck) => deck.paused && !deck.src));
});

test("A connection that never answers is swapped for the next mirror", async () => {
  const env = environment();
  env.audio.play = function () { this.paused = false; return new Promise(() => {}); };
  env.music.tune("rp-main");
  assert.equal(env.music.status().radioPhase, "connecting");
  assert.equal(env.music.status().playing, false, "a deck that is still connecting is not music yet");
  assert.equal(env.ids.get("music-radio-state").textContent, "Connecting to Radio Paradise…");
  env.advance(6999);
  assert.equal(env.audios.length, 1);
  env.advance(1); await flush();
  assert.equal(env.audios.length, 1, "nothing was sounding, so the same deck takes the next mirror");
  assert.equal(env.audio.src, "https://stream.radioparadise.com/aac-128");
  assert.equal(env.ids.get("music-radio-state").textContent, "Connecting to Radio Paradise… — Radio Paradise did not answer. Moving to mirror 2.");
});

test("Leaving radio stops both decks and hands the selected local track back without playing it", async () => {
  const env = environment();
  env.music.addFiles([file("Focus.mp3")]);
  env.music.tune("groovesalad"); await flush();
  env.music.tune("dronezone"); await flush();
  env.music.setSource("local");
  assert.equal(env.audios[1].paused, true);
  assert.equal(env.audios[1].src, "", "no deck keeps streaming in the background");
  assert.equal(env.audio.src, "blob:fixture-1", "the selected track is loaded back on deck A");
  assert.equal(env.audio.paused, true, "switching sources is not implicit autoplay");
  assert.equal(env.audio.crossOrigin, null, "local files go back to plain same-origin playback");
  assert.equal(env.audio.volume, .7);
  assert.equal(env.music.getAudioElement(), env.audio);
  assert.equal(env.music.status().source, "local");
  env.ids.get("music-play").click(); await flush();
  assert.equal(env.music.status().playing, true);
});

test("A remembered station is offered on return but never starts by itself", async () => {
  const env = environment({ saved: { station: "rp-main" } });
  await flush();
  assert.equal(env.music.status().source, "local");
  assert.equal(env.audio.src, "");
  env.music.setSource("radio");
  assert.equal(env.ids.get("music-radio-state").textContent, "Radio Paradise ready");
  assert.equal(env.music.status().playing, false);
  assert.equal(env.audios.length, 1);
});

test("A station that was on when Studio closed plays again on the next launch; Stop or another source ends that", async () => {
  const env = environment();
  env.music.tune("dronezone"); await flush();
  const saved = JSON.parse(env.storage.get("mefiStudio.music.v1"));
  assert.equal(saved.source, "radio");
  assert.equal(saved.radioOn, true);
  assert.equal(saved.station, "dronezone");
  const relaunched = environment({ saved }); await flush();
  assert.equal(relaunched.audios.length, 1, "a relaunch tunes on deck A; there is nothing to cross over from");
  assert.equal(relaunched.audio.src, mirror("dronezone"));
  assert.equal(relaunched.audio.volume, .7);
  assert.equal(relaunched.music.status().source, "radio");
  assert.equal(relaunched.music.status().playing, true);
  assert.equal(relaunched.ids.get("music-radio-panel").hidden, false, "the radio tab is the one showing");
  relaunched.ids.get("music-radio-stop").click();
  const stopped = JSON.parse(relaunched.storage.get("mefiStudio.music.v1"));
  assert.equal(stopped.radioOn, false);
  assert.equal(stopped.source, "radio");
  const quiet = environment({ saved: stopped }); await flush();
  assert.equal(quiet.music.status().source, "radio", "a stopped station still reopens on its tab");
  assert.equal(quiet.music.status().playing, false);
  assert.equal(quiet.audio.src, "");
  assert.equal(quiet.ids.get("music-radio-state").textContent, "Drone Zone ready");
  const leaving = environment({ saved }); await flush();
  leaving.music.setSource("local");
  const local = JSON.parse(leaving.storage.get("mefiStudio.music.v1"));
  assert.equal(local.source, "local");
  assert.equal(local.radioOn, false);
  const back = environment({ saved: local }); await flush();
  assert.equal(back.music.status().source, "local");
  assert.equal(back.audio.src, "");
});

test("Smoke and capture runs share the owner's profile but never start the saved station", async () => {
  const saved = { station: "groovesalad", source: "radio", radioOn: true };
  for (const search of ["?capture=0&smoke=1", "?capture=1&smoke=0"]) {
    const env = environment({ saved, search }); await flush();
    assert.equal(env.audio.src, "", search);
    assert.equal(env.music.status().playing, false, search);
    assert.equal(env.music.status().source, "radio", `${search} still shows the tab`);
    assert.equal(JSON.parse(env.storage.get("mefiStudio.music.v1")).radioOn, true, `${search} leaves the owner's choice alone`);
  }
  const app = environment({ saved, search: "?capture=0&smoke=0" }); await flush();
  assert.equal(app.audio.src, mirror("groovesalad"));
  assert.equal(app.music.status().playing, true);
});

test("A link returns to the Links tab on the next launch and mounts its player only when the sheet opens", async () => {
  const link = "https://open.spotify.com/playlist/37i9dQZF1DX7zqr9q1MPG7";
  const env = environment();
  env.music.loadSpotify(link);
  const saved = JSON.parse(env.storage.get("mefiStudio.music.v1"));
  assert.equal(saved.source, "link");
  const relaunched = environment({ saved }); await flush();
  const panel = relaunched.ids.get("music-link-panel");
  const embeds = () => panel.children.flatMap((child) => child.children).filter((child) => child.tagName === "iframe");
  assert.equal(relaunched.music.status().source, "link");
  assert.equal(relaunched.music.status().playing, false, "Spotify's own playback is never claimed");
  assert.equal(relaunched.ids.get("music-link-url").value, link);
  assert.equal(relaunched.audio.src, "");
  assert.equal(embeds().length, 0, "nothing loads from Spotify until the sheet is opened");
  relaunched.music.openAudio();
  assert.equal(embeds().length, 1);
  assert.match(embeds()[0].src, /^https:\/\/open\.spotify\.com\/embed\/playlist\/37i9dQZF1DX7zqr9q1MPG7$/);
  relaunched.music.closeAudio(); relaunched.music.openAudio();
  assert.equal(embeds().length, 1, "reopening keeps the same player");
  const linkless = environment({ saved: { ...saved, links: [] } });
  assert.equal(linkless.music.status().source, "local", "a Links tab with no link to offer falls back to local");
  const legacy = environment({ saved: { source: "spotify", spotify: [link] } }); await flush();
  assert.equal(legacy.music.status().source, "link", "a Spotify tab saved before Links comes back as Links");
  assert.equal(legacy.ids.get("music-link-url").value, link);
});

test("Source tabs move in order with the arrow keys and jump with Home and End", () => {
  const env = environment();
  const tabs = env.ids.get("music-local-tab").parentElement;
  const press = (key) => tabs.dispatch("keydown", { key });
  press("ArrowRight"); assert.equal(env.music.status().source, "radio");
  press("ArrowRight"); assert.equal(env.music.status().source, "link");
  press("ArrowRight"); assert.equal(env.music.status().source, "local", "the last tab wraps to the first");
  press("ArrowLeft"); assert.equal(env.music.status().source, "link");
  press("Home"); assert.equal(env.music.status().source, "local");
  press("End"); assert.equal(env.music.status().source, "link");
  assert.equal(env.document.activeElement, env.ids.get("music-link-tab"));
});

test("A stream that dies mid-play is reloaded on its own deck; there is nothing to fade from", async () => {
  const env = environment();
  env.music.tune("groovesalad"); await flush();
  env.audio.error = { code: 2 };
  env.audio.dispatch("error"); await flush();
  assert.equal(env.audios.length, 1);
  assert.equal(env.audio.src, mirror("groovesalad", "ice2"));
  assert.equal(env.music.status().radioPhase, "playing");
  assert.equal(env.audio.volume, .7);
});

test("A crossfade reads the clock, so a throttled timer lands it late instead of stretching it", async () => {
  const env = environment();
  env.music.tune("groovesalad"); await flush();
  env.throttle(1000); // a hidden window: interval ticks arrive a second apart
  env.music.tune("dronezone"); await flush();
  const [deckA, deckB] = env.audios;
  env.advance(1000);
  assert.ok(deckB.volume > .5 && deckB.volume < .7, "one late tick jumps to where the clock says the fade is");
  env.advance(1000);
  assert.equal(deckB.volume, .7, "the second late tick finishes it");
  assert.equal(deckA.src, "");
});

test("A mirror that fails while connecting says so, instead of claiming a stream dropped", async () => {
  const env = environment();
  env.audio.play = function () { this.paused = false; return new Promise(() => {}); };
  env.music.tune("groovesalad");
  env.audio.error = { code: 4 };
  env.audio.dispatch("error"); await flush();
  assert.equal(env.audios.length, 1);
  assert.equal(env.audio.src, mirror("groovesalad", "ice2"));
  assert.equal(env.ids.get("music-radio-state").textContent, "Connecting to Groove Salad… — Groove Salad could not connect. Moving to mirror 2.");
});

// ---- The Void collection: members' themes and node styles ----
const FORK_COPY = "Members of the Void Engine Discord unlock these. Studio is MIT-licensed: fork the project and unlock it yourself, or ask an agent to do it for you.";
const PREMIUM_THEMES = ["void", "eclipse", "abyss", "dusk"];
const PREMIUM_STYLES = ["singularity", "prism", "sigil"];
const premiumStore = (env) => JSON.parse(env.storage.get("mefiStudio.music.premium.v1") ?? "null");
const musicWrites = (env) => env.writes.filter(([key]) => key === "mefiStudio.music.v1").map(([, value]) => JSON.parse(value));
const lastEvent = (env, type) => env.events.filter((event) => event.type === type).at(-1)?.detail;
const eventCount = (env, type) => env.events.filter((event) => event.type === type).length;
const member = (allowed = () => true, offers = []) => ({ has: (perk) => perk === "premium" && allowed(), offer: (item) => offers.push({ ...item }) });

test("Saved preferences keep only free keys; the premium store keeps only premium keys", () => {
  for (const theme of PREMIUM_THEMES) assert.equal(helpers.safePreferences({ theme }).theme, "aurora", theme);
  for (const nodeStyle of PREMIUM_STYLES) assert.equal(helpers.safePreferences({ nodeStyle }).nodeStyle, "orbs", nodeStyle);
  const scope = vm.createContext({ URL });
  vm.runInContext(`${source.slice(source.indexOf("  const THEMES"), source.indexOf("  let stored;"))}\nthis.api = {safePremium, resolvePalette};`, scope);
  assert.deepEqual({ ...scope.api.safePremium({ theme: "void", nodeStyle: "prism", extra: 1 }) }, { theme: "void", nodeStyle: "prism" });
  for (const bad of [null, "void", { theme: "rose", nodeStyle: "orbs" }, { theme: "__proto__", nodeStyle: "constructor" }]) assert.deepEqual({ ...scope.api.safePremium(bad) }, {}, JSON.stringify(bad));
  for (const theme of PREMIUM_THEMES) {
    const palette = scope.api.resolvePalette(theme);
    assert.match(palette.accent2, /^#[0-9a-f]{6}$/i, `${theme} carries its second hue`);
    assert.ok(helpers.contrast(palette.text, palette.surface) >= 4.5, `${theme} text stays readable`);
  }
});

test("An unlinked premium theme previews live without saving and offers the unlock", () => {
  const offers = [];
  const env = environment({ saved: { theme: "rose" }, community: member(() => false, offers) });
  const themeEvents = eventCount(env, "mefi-theme-change");
  assert.equal(env.music.applyTheme("void"), "void");
  assert.equal(env.music.status().theme, "void");
  assert.equal(env.music.themePalette().theme, "void");
  assert.equal(env.document.documentElement.dataset.studioTheme, "void");
  assert.equal(env.document.documentElement.dataset.studioThemeTier, "premium");
  assert.equal(env.styles.get("--accent-2"), "#36d1ff");
  assert.equal(eventCount(env, "mefi-theme-change"), themeEvents + 1);
  assert.equal(lastEvent(env, "mefi-theme-change").theme, "void");
  assert.equal(lastEvent(env, "mefi-theme-change").preview, true, "Workspace can distinguish a temporary look");
  assert.deepEqual(offers, [{ kind: "theme", key: "void", name: "Void" }]);
  assert.deepEqual(env.writes, [], "a preview writes neither the free nor premium preference");
  assert.equal(premiumStore(env), null);
  const locked = env.ids.get("music-theme-void");
  assert.equal(locked.attrs["aria-disabled"], undefined, "a previewable choice is enabled");
  assert.equal(locked.disabled, false);
  assert.equal(locked.attrs["aria-pressed"], "true");
  assert.match(locked.textContent, /Members$/);
  env.ids.get("music-theme-eclipse").click();
  assert.equal(offers.length, 2, "choosing another look updates the preview and explains it");
  assert.equal(env.music.status().theme, "eclipse");
  assert.deepEqual(env.writes, []);
  env.music.open(); env.music.close();
  assert.equal(env.music.status().theme, "rose", "closing the sheet restores the saved theme");
  assert.equal(env.document.documentElement.dataset.studioThemeTier, "free");
  assert.deepEqual(env.writes, [], "closing the preview also writes nothing");
  const box = env.ids.get("music-premium-themes").parentElement;
  const free = box.parentElement.children.find((child) => child.className === "music-themes");
  assert.deepEqual(free.children.map((choice) => choice.dataset.theme), ["gold", "midnight", "forest", "violet", "ember", "aurora", "rose", "custom"], "the free grid is unchanged");
  assert.deepEqual(env.ids.get("music-premium-themes").children.map((choice) => choice.dataset.theme), PREMIUM_THEMES);
  assert.ok(env.ids.get("music-premium-themes").children.every((choice) => choice.dataset.premium === "true"));
  assert.equal(env.ids.get("music-premium-theme-preview-note").hidden, false);
  assert.match(env.ids.get("music-premium-theme-preview-note").textContent, /Preview any look now/);
  assert.ok(env.ids.get("music-premium-themes").attrs["aria-describedby"].split(" ").includes("music-premium-theme-preview-note"));
  assert.match(locked.title, /Preview this Void collection theme/);
  assert.equal(env.ids.get("music-premium-theme-fineprint").textContent, FORK_COPY);
});

test("A member's premium theme applies with its second hue and is saved only in the premium store", () => {
  let offers = 0;
  const env = environment({ saved: { theme: "forest" }, community: { has: (perk) => perk === "premium", offer: () => { offers += 1; } } });
  assert.equal(env.ids.get("music-theme-void").attrs["aria-disabled"], undefined);
  env.ids.get("music-theme-void").click();
  assert.equal(env.music.status().theme, "void");
  assert.equal(env.music.themePalette().theme, "void");
  assert.equal(env.document.documentElement.dataset.studioTheme, "void");
  assert.equal(env.document.documentElement.dataset.studioThemeTier, "premium");
  assert.equal(env.styles.get("--accent-2"), "#36d1ff");
  assert.equal(env.styles.get("--accent-2-rgb"), "54,209,255");
  assert.equal(env.styles.get("--studio-accent-rgb"), "124,108,255");
  const detail = lastEvent(env, "mefi-theme-change");
  assert.equal(detail.theme, "void"); assert.equal(detail.tier, "premium"); assert.equal(detail.accent2, "#36d1ff");
  assert.equal(env.ids.get("music-theme-void").attrs["aria-pressed"], "true");
  assert.deepEqual(premiumStore(env), { theme: "void" });
  assert.deepEqual(musicWrites(env), [], "the free preferences are untouched");
  assert.equal(offers, 0);
  env.music.applyTheme("abyss");
  assert.deepEqual(premiumStore(env), { theme: "abyss" });
  env.music.applyTheme("violet");
  assert.equal(env.music.status().theme, "violet");
  assert.equal(env.document.documentElement.dataset.studioThemeTier, "free");
  assert.deepEqual(premiumStore(env), {}, "a free choice clears the premium theme");
  assert.equal(env.ids.get("music-theme-abyss").attrs["aria-pressed"], "false");
  env.music.applyCustomColors({ accent: "#22bbaa" });
  assert.equal(env.music.status().theme, "custom");
  const saved = musicWrites(env);
  assert.ok(saved.length >= 2);
  assert.ok(saved.every((value) => !PREMIUM_THEMES.includes(value.theme) && !PREMIUM_STYLES.includes(value.nodeStyle)), "mefiStudio.music.v1 never holds a premium key");
  assert.equal(saved.at(-1).theme, "custom");
});

test("Premium node styles follow the same gate, and graphPreferences reports the style on screen", () => {
  let allowed = false;
  const offers = [];
  const env = environment({ saved: { nodeStyle: "glass" }, community: member(() => allowed, offers) });
  const treeEvents = eventCount(env, "mefi-tree-preferences");
  assert.equal(env.music.applyNodeStyle("prism"), "prism");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  assert.equal(env.document.documentElement.dataset.nodeStyle, "prism");
  assert.equal(eventCount(env, "mefi-tree-preferences"), treeEvents + 1, "the tree receives the preview style");
  assert.equal(lastEvent(env, "mefi-tree-preferences").nodeStyle, "prism");
  assert.deepEqual(offers, [{ kind: "nodeStyle", key: "prism", name: "Prism" }]);
  assert.deepEqual(env.writes, []);
  assert.equal(premiumStore(env), null);
  for (const style of PREMIUM_STYLES) {
    const choice = env.ids.get(`music-node-style-${style}`);
    assert.equal(choice.attrs["aria-disabled"], undefined, "Void styles can be previewed");
    assert.equal(choice.children[0].attrs["aria-hidden"], "true");
    assert.equal(choice.children[0].className, `music-node-preview music-preview-${style}`);
  }
  assert.equal(env.ids.get("music-node-style-prism").attrs["aria-pressed"], "true");
  assert.equal(env.ids.get("music-premium-style-preview-note").hidden, false);
  assert.ok(env.ids.get("music-node-premium-styles").attrs["aria-describedby"].split(" ").includes("music-premium-style-preview-note"));
  assert.deepEqual(env.ids.get("music-node-styles").children.map((choice) => choice.dataset.nodeStyle), ["orbs", "glass", "minimal", "halo", "crystal"], "the free cards are unchanged");
  allowed = true;
  env.emit("mefi-community-change", { premium: true, perks: ["premium"], validUntil: null, reason: "member" });
  assert.equal(env.ids.get("music-node-style-prism").attrs["aria-disabled"], undefined);
  assert.deepEqual(premiumStore(env), { nodeStyle: "prism" }, "linking commits the style on screen");
  env.ids.get("music-node-style-prism").click();
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  assert.equal(env.music.status().nodeStyle, "prism");
  assert.equal(env.document.documentElement.dataset.nodeStyle, "prism");
  assert.equal(lastEvent(env, "mefi-tree-preferences").nodeStyle, "prism");
  assert.equal(env.ids.get("music-node-style-prism").attrs["aria-pressed"], "true");
  assert.equal(env.ids.get("music-node-style-glass").attrs["aria-pressed"], "false");
  assert.deepEqual(premiumStore(env), { nodeStyle: "prism" });
  env.music.applyNodeLayout("tree");
  assert.deepEqual({ ...env.music.graphPreferences() }, { nodeStyle: "prism", nodeLayout: "tree", orbitTrails: false, extraGlow: false });
  assert.equal(musicWrites(env).at(-1).nodeStyle, "glass", "the saved free style stays the fallback");
  env.music.applyNodeStyle("halo");
  assert.equal(env.music.graphPreferences().nodeStyle, "halo");
  assert.deepEqual(premiumStore(env), {}, "a free style clears the premium one");
  assert.ok(musicWrites(env).every((value) => !PREMIUM_STYLES.includes(value.nodeStyle) && !PREMIUM_THEMES.includes(value.theme)));
});

test("Unlinked previews end on close or when navigation leaves Style & sound, without changing saved choices", () => {
  const saved = { theme: "forest", nodeStyle: "glass" };
  const env = environment({ saved, community: member(() => false) });
  const before = env.storage.get("mefiStudio.music.v1");
  env.music.applyTheme("abyss");
  env.music.applyNodeStyle("sigil");
  assert.equal(env.music.status().theme, "abyss");
  assert.equal(env.music.graphPreferences().nodeStyle, "sigil");
  assert.equal(env.storage.get("mefiStudio.music.v1"), before);
  assert.equal(premiumStore(env), null);
  assert.deepEqual(env.writes, []);

  env.emit("mefi:nav", { action: "open", id: "studio" });
  env.emit("mefi:nav", { action: "open", id: "music" });
  env.emit("mefi:nav", { action: "open", id: "appearancePreview" });
  for (const id of ["help", "palette", "profiler"]) {
    env.emit("mefi:nav", { action: "open", id });
    env.emit("mefi:nav", { action: "close", id });
  }
  assert.equal(env.music.status().theme, "abyss", "moving between Settings and Style & sound keeps the preview");
  assert.equal(env.music.graphPreferences().nodeStyle, "sigil");
  env.emit("mefi:nav", { action: "open", id: "workspace" });
  assert.equal(env.music.status().theme, "forest");
  assert.equal(env.music.graphPreferences().nodeStyle, "glass");
  assert.equal(env.document.documentElement.dataset.studioThemeTier, "free");
  assert.equal(lastEvent(env, "mefi-theme-change").preview, undefined);

  env.music.open();
  env.ids.get("music-theme-dusk").click();
  env.ids.get("music-node-style-singularity").click();
  env.music.close();
  assert.equal(env.music.status().theme, "forest", "closing the sheet ends a theme preview");
  assert.equal(env.music.graphPreferences().nodeStyle, "glass", "closing the sheet ends a node style preview");
  assert.deepEqual(env.writes, [], "neither preview lifecycle writes preferences");
  const restarted = environment({ saved: JSON.parse(env.storage.get("mefiStudio.music.v1")) });
  assert.equal(restarted.music.status().theme, "forest");
  assert.equal(restarted.music.graphPreferences().nodeStyle, "glass");
});

test("A linked non-member still previews, and a premium event commits both previews for the next launch", () => {
  let allowed = false;
  const community = { has: (perk) => perk === "premium" && allowed, offer() {}, status: () => ({ configured: true, linked: true, state: allowed ? "ok" : "not-member" }) };
  const env = environment({ saved: { theme: "rose", nodeStyle: "halo" }, community });
  env.music.applyTheme("eclipse");
  env.music.applyNodeStyle("prism");
  env.emit("mefi-community-change", { premium: false, perks: [], validUntil: null, reason: "not-member" });
  assert.equal(env.music.status().theme, "eclipse", "link alone does not end the preview");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  assert.equal(premiumStore(env), null, "link alone does not save premium choices");
  assert.deepEqual(env.writes, []);

  allowed = true;
  env.emit("mefi-community-change", { premium: true, perks: ["premium"], validUntil: null, reason: "member" });
  assert.deepEqual(premiumStore(env), { theme: "eclipse", nodeStyle: "prism" });
  assert.equal(lastEvent(env, "mefi-theme-change").preview, undefined, "the theme becomes a saved choice");
  assert.deepEqual(musicWrites(env), [], "the saved free fallbacks stay separate");
  env.music.open(); env.music.close();
  assert.equal(env.music.status().theme, "eclipse", "committed themes survive closing the sheet");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  const restarted = environment({ saved: { theme: "rose", nodeStyle: "halo" }, premiumSaved: premiumStore(env), hint: { premium: true, validUntil: null } });
  assert.equal(restarted.music.status().theme, "eclipse");
  assert.equal(restarted.music.graphPreferences().nodeStyle, "prism");
});

test("an explicitly unsaved preview remains temporary when Discord membership arrives", () => {
  let allowed = false;
  const env = environment({ saved: { theme: "rose", nodeStyle: "halo" }, premiumSaved: { theme: "eclipse", nodeStyle: "sigil" }, community: member(() => allowed) });
  env.music.applyTheme("void", false, { navigate: false });
  env.music.applyNodeStyle("prism", false, { navigate: false });
  assert.equal(env.music.status().theme, "void");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  allowed = true;
  env.emit("mefi-community-change", { premium: true, perks: ["premium"], validUntil: null, reason: "member" });
  assert.equal(env.music.status().theme, "void", "the live preview need not disappear at unlock");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  assert.deepEqual(premiumStore(env), { theme: "eclipse", nodeStyle: "sigil" }, "unsaved previews do not replace earlier premium choices");
  assert.deepEqual(env.writes, []);
  env.music.open(); env.music.close();
  assert.equal(env.music.status().theme, "eclipse", "closing restores the saved member choice");
  assert.equal(env.music.graphPreferences().nodeStyle, "sigil");
  assert.deepEqual(env.writes, []);
});

test("A member's premium choices return at launch from the boot hint, without MefiCommunity and without writes", () => {
  const env = environment({ saved: { theme: "rose", nodeStyle: "halo" }, premiumSaved: { theme: "abyss", nodeStyle: "sigil" }, hint: { premium: true, validUntil: Date.now() + 86400000 } });
  assert.equal(env.music.status().theme, "abyss");
  assert.equal(env.music.graphPreferences().nodeStyle, "sigil");
  assert.equal(env.document.documentElement.dataset.studioThemeTier, "premium");
  assert.ok(env.events.filter((event) => event.type === "mefi-theme-change").every((event) => event.detail.theme === "abyss"), "no flash of the free theme");
  const tree = env.events.filter((event) => event.type === "mefi-tree-preferences");
  assert.equal(tree.length, 1); assert.equal(tree[0].detail.nodeStyle, "sigil");
  assert.deepEqual(env.writes, [], "restoring a premium choice writes nothing");
  assert.equal(env.ids.get("music-theme-abyss").attrs["aria-disabled"], undefined);
  // A member sees one quiet line where the fork path and its buttons would be.
  assert.equal(env.ids.get("music-premium-theme-member").hidden, false);
  assert.equal(env.ids.get("music-premium-theme-member").textContent, "Unlocked with your Void Engine membershipManage in Settings › Community");
  assert.equal(env.ids.get("music-premium-theme-manage").hidden, true, "no Settings link without MefiCommunity to open it");
  for (const part of ["fineprint", "desktop"]) assert.equal(env.ids.get(`music-premium-theme-${part}`).hidden, true, part);
  assert.equal(env.ids.get("music-premium-theme-join").parentElement.hidden, true);
  const expired = environment({ saved: { theme: "rose", nodeStyle: "halo" }, premiumSaved: { theme: "abyss", nodeStyle: "sigil" }, hint: { premium: true, validUntil: 1 } });
  assert.equal(expired.music.status().theme, "rose");
  assert.equal(expired.music.graphPreferences().nodeStyle, "halo");
  assert.deepEqual(expired.writes, []);
  assert.deepEqual(premiumStore(expired), { theme: "abyss", nodeStyle: "sigil" }, "an expired hint keeps the saved choice");
  const self = environment({ premiumSaved: { theme: "dusk" }, hint: { premium: true, validUntil: null } });
  assert.equal(self.music.status().theme, "dusk", "a hint with no end date (a self-unlocked fork) stays open");
  const junk = environment({ premiumSaved: { theme: "rose", nodeStyle: "__proto__" }, hint: { premium: true, validUntil: null } });
  assert.equal(junk.music.status().theme, "aurora");
  assert.equal(junk.music.graphPreferences().nodeStyle, "orbs");
  const none = environment({ premiumSaved: { theme: "void" } });
  assert.equal(none.music.status().theme, "aurora", "no hint, no community: a saved premium choice stays dormant");
  assert.equal(none.music.applyTheme("void"), "void", "the same theme can be previewed");
  assert.deepEqual(none.writes, [], "previewing does not rewrite the dormant choice");
  none.music.open(); none.music.close();
  assert.equal(none.music.status().theme, "aurora");
  assert.match(none.ids.get("music-premium-theme-fineprint").textContent, /fork the project and unlock it yourself/);
});

test("A lapsed membership falls back to the free choices without writing, toasts once, and a relink restores them", () => {
  let allowed = true;
  const env = environment({ saved: { theme: "forest", nodeStyle: "crystal" }, premiumSaved: { theme: "dusk", nodeStyle: "singularity" }, community: member(() => allowed) });
  assert.equal(env.music.status().theme, "dusk");
  assert.equal(env.music.graphPreferences().nodeStyle, "singularity");
  allowed = false;
  env.emit("mefi-community-change", { premium: false, perks: [], validUntil: null, reason: "not-member" });
  assert.equal(env.music.status().theme, "forest");
  assert.equal(env.music.graphPreferences().nodeStyle, "crystal");
  assert.equal(env.document.documentElement.dataset.studioThemeTier, "free");
  assert.equal(lastEvent(env, "mefi-theme-change").theme, "forest");
  assert.equal(lastEvent(env, "mefi-tree-preferences").nodeStyle, "crystal");
  assert.deepEqual(env.toasts, [["Void collection locked again; your choice is saved.", "info"]]);
  assert.deepEqual(env.writes, [], "revoking writes nothing");
  assert.deepEqual(premiumStore(env), { theme: "dusk", nodeStyle: "singularity" });
  assert.equal(env.ids.get("music-theme-dusk").attrs["aria-disabled"], undefined, "lapsed members may preview again");
  assert.equal(env.ids.get("music-node-style-singularity").attrs["aria-disabled"], undefined);
  env.emit("mefi-community-change", { premium: false, perks: [], validUntil: null, reason: "not-member" });
  assert.equal(env.toasts.length, 1, "nothing premium was showing, so nothing to say");
  allowed = true;
  env.emit("mefi-community-change", { premium: true, perks: ["premium"], validUntil: null, reason: "member" });
  assert.equal(env.music.status().theme, "dusk");
  assert.equal(env.music.graphPreferences().nodeStyle, "singularity");
  assert.deepEqual(env.writes, []);
  assert.equal(env.toasts.length, 1);
});

test("A community event is taken at its word, so a status that lags behind it cannot pop an unlock offer", () => {
  const offers = [];
  const env = environment({ premiumSaved: { theme: "eclipse", nodeStyle: "prism" }, community: member(() => false, offers) });
  assert.equal(env.music.status().theme, "aurora");
  env.emit("mefi-community-change", { premium: true, perks: ["premium"], validUntil: null, reason: "member" });
  assert.equal(env.music.status().theme, "eclipse");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  assert.equal(lastEvent(env, "mefi-theme-change").tier, "premium");
  assert.deepEqual(offers, []);
  assert.deepEqual(env.writes, []);
});

test("Premium pickers offer Join, Link and Copy agent prompt through MefiCommunity when the desktop bridge is there", () => {
  const calls = [];
  const community = { has: () => false, offer() {}, status: () => ({ configured: true, linked: false, state: null }), join: () => calls.push("join"), link: () => calls.push("link"), copyAgentPrompt: () => calls.push("prompt") };
  const env = environment({ community, bridge: { communityLink: () => {}, communityOpen: () => {} } });
  for (const kind of ["theme", "style"]) {
    assert.equal(env.ids.get(`music-premium-${kind}-desktop`).hidden, true);
    assert.equal(env.ids.get(`music-premium-${kind}-join`).parentElement.hidden, false);
    assert.deepEqual(env.ids.get(`music-premium-${kind}-join`).parentElement.children.map((choice) => choice.textContent), ["Join the Discord", "Link my Discord", "Copy agent prompt"]);
    for (const action of ["join", "link", "prompt"]) env.ids.get(`music-premium-${kind}-${action}`).click();
  }
  assert.deepEqual(calls, ["join", "link", "prompt", "join", "link", "prompt"]);
  const web = environment({ community });
  assert.equal(web.ids.get("music-premium-style-desktop").hidden, false, "start:web has no bridge to link with");
  assert.equal(web.ids.get("music-premium-style-desktop").textContent, "Desktop app only");
});

test("Link my Discord shows only where linking can happen, and follows community status changes", () => {
  let current = { configured: false, linked: false, state: null };
  const community = { has: () => false, offer() {}, status: () => current, join() {}, link() {}, copyAgentPrompt() {} };
  const env = environment({ community, bridge: { communityLink: () => {}, communityOpen: () => {} } });
  const linkHidden = () => ["theme", "style"].map((kind) => env.ids.get(`music-premium-${kind}-link`).hidden);
  assert.deepEqual(linkHidden(), [true, true], "a build without a Discord client id (the shipped CLIENT_ID is empty) offers no Link");
  for (const kind of ["theme", "style"]) {
    assert.equal(env.ids.get(`music-premium-${kind}-join`).parentElement.hidden, false, "Join and the fork path stay");
    assert.equal(env.ids.get(`music-premium-${kind}-join`).hidden, false);
    assert.equal(env.ids.get(`music-premium-${kind}-prompt`).hidden, false);
  }
  current = { configured: true, linked: false, state: null };
  env.emit("mefi-community-status", { configured: true, linked: false, state: null, linking: false });
  assert.deepEqual(linkHidden(), [false, false], "a status change re-renders the buttons without an entitlement change");
  current = { configured: true, linked: true, state: "not-member" };
  env.emit("mefi-community-status", {});
  assert.deepEqual(linkHidden(), [true, true], "an account already linked is not linked again");
  current = { configured: true, linked: true, state: "relink" };
  env.emit("mefi-community-status", {});
  assert.deepEqual(linkHidden(), [false, false], "unless Discord asks for a new link");
  const early = environment({ community: { ...community, status: () => null }, bridge: { communityLink: () => {}, communityOpen: () => {} } });
  assert.equal(early.ids.get("music-premium-theme-link").hidden, true, "no Link before the first status");
  const throwing = environment({ community: { ...community, status: () => { throw new Error("boom"); } }, bridge: { communityLink: () => {} } });
  assert.equal(throwing.ids.get("music-premium-style-link").hidden, true);
});

test("Previewed Void choices explain in place: the Workspace select and the sheet's own tiles pass navigate:false", () => {
  const offers = [];
  const env = environment({ saved: { theme: "rose", nodeStyle: "glass" }, community: member(() => false, offers) });
  assert.equal(env.music.applyTheme("dusk", true, { navigate: false }), "dusk");
  assert.equal(lastEvent(env, "mefi-theme-change").theme, "dusk");
  assert.equal(lastEvent(env, "mefi-theme-change").preview, true);
  assert.deepEqual(offers, [{ kind: "theme", key: "dusk", name: "Neon Dusk", navigate: false }]);
  env.ids.get("music-theme-dusk").click();
  assert.deepEqual(offers.at(-1), { kind: "theme", key: "dusk", name: "Neon Dusk", navigate: false }, "a Void tile explains itself without closing Style & sound");
  env.ids.get("music-node-style-prism").click();
  assert.deepEqual(offers.at(-1), { kind: "nodeStyle", key: "prism", name: "Prism", navigate: false }, "so does a Void node style");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism", "the preview reaches the tree");
  assert.equal(env.music.applyNodeStyle("sigil", true, { navigate: false }), "sigil", "applyNodeStyle takes applyTheme's options");
  assert.deepEqual(offers.at(-1), { kind: "nodeStyle", key: "sigil", name: "Sigil", navigate: false });
  env.music.applyNodeStyle("singularity");
  assert.deepEqual(offers.at(-1), { kind: "nodeStyle", key: "singularity", name: "Singularity" }, "a caller that passes no options still offers Settings › Community");
  assert.deepEqual(env.writes, []);
});

test("Appearance holds only visual controls; the audio dropdown owns every player and its setup", () => {
  const env = environment({ preview: true });
  const sheet = env.ids.get("music-overlay").children[0];
  const [, body] = sheet.children;
  assert.deepEqual(body.children.map((child) => child.className), ["music-settings"]);
  const look = env.ids.get("music-look"), sound = env.ids.get("music-sound");
  assert.deepEqual(look.children.slice(1).map((child) => child.dataset.appearancePanel), ["themes", "nodes", "layout"], "appearance sections can be browsed independently");
  assert.equal(look.attrs["aria-labelledby"], "music-look-label");
  assert.equal(sound.attrs["aria-labelledby"], "music-sound-label");
  const node = env.ids.get("music-node-heading").parentElement;
  const after = (id) => node.children[node.children.indexOf(env.ids.get(id)) + 1];
  assert.equal(after("music-node-styles"), env.ids.get("music-node-premium-styles").parentElement, "the Void styles sit right under the free ones");
  assert.equal(env.ids.get("music-node-layouts").parentElement.dataset.appearancePanel, "layout", "arrangements have their own section");
  const dropdown = env.ids.get("music-dropdown");
  for (const id of ["music-sound", "music-audio-source", "music-audio-toggle", "music-audio-response", "music-recommend", "music-link-url", "music-files"]) {
    assert.equal(dropdown.contains(env.ids.get(id)), true, id);
    assert.equal(sheet.contains(env.ids.get(id)), false, id);
  }
  assert.equal(dropdown.hidden, true);
  assert.equal(sound.children[1], env.ids.get("music-local-tab").parentElement, "the player's source tabs open the Sound group");
  env.music.open(); env.frames();
  assert.equal(dropdown.hidden, true, "Appearance never opens the media menu");
  assert.equal(env.ids.get("music-premium-theme-label").children[0].textContent, "Members", "a narrow sheet folds the pill to its lock; the word stays");
});

test("The audio dropdown stays beneath its opener, dismisses without stopping playback and restores keyboard focus", async () => {
  const env = environment();
  const anchor = env.document.createElement("button");
  anchor.id = "idle-music-toggle";
  anchor.getBoundingClientRect = () => ({ width: 150, height: 36, bottom: 120, right: 950 });
  const dropdown = env.ids.get("music-dropdown");
  dropdown.getBoundingClientRect = () => ({ width: 448 });
  env.music.addFiles([file("Focus.mp3")]); env.ids.get("music-play").click(); await flush();
  env.audio.currentTime = 32;
  env.music.toggleAudio(anchor); env.frames();
  assert.equal(dropdown.hidden, false);
  assert.equal(anchor.attrs["aria-expanded"], "true");
  assert.equal(dropdown.style.top, "128px");
  assert.equal(dropdown.style.right, "74px");
  assert.equal(dropdown.style.maxHeight, "628px");
  assert.equal(env.document.activeElement, dropdown);
  env.pointer(env.ids.get("music-audio-source"));
  assert.equal(dropdown.hidden, false, "interacting with the setup keeps it open");
  dropdown.dispatch("keydown", { key: "Escape" });
  assert.equal(dropdown.hidden, true);
  assert.equal(anchor.attrs["aria-expanded"], "false");
  assert.equal(env.document.activeElement, anchor);
  assert.equal(env.audio.paused, false);
  assert.equal(env.audio.currentTime, 32);
  env.music.openAudio(anchor);
  env.pointer(env.document.body);
  assert.equal(dropdown.hidden, true, "outside clicks dismiss it");
  assert.equal(env.audio.paused, false);
  env.music.openAudio(anchor);
  env.emit("mefi:nav", { id: "workspace", action: "open" });
  assert.equal(dropdown.hidden, true, "navigation dismisses it");
  assert.equal(env.audio.paused, false);
});

test("A member's Void boxes trade the fork path for one quiet line with a Settings link; the lock marks go with the lock", () => {
  let premium = true;
  let current = { configured: true, linked: true, state: "ok", selfUnlocked: false };
  const opened = [];
  const community = { has: () => premium, offer() {}, status: () => current, open: () => opened.push("open"), join() {}, link() {}, copyAgentPrompt() {}, FORK_COPY: "The fork sentence, as community.js has it." };
  const env = environment({ community, bridge: { communityLink: () => {}, communityOpen: () => {} } });
  for (const kind of ["theme", "style"]) {
    const part = (name) => env.ids.get(`music-premium-${kind}-${name}`);
    assert.equal(part("member").hidden, false, kind);
    assert.equal(part("member").children[0].textContent, "Unlocked with your Void Engine membership");
    assert.equal(part("manage").hidden, false);
    assert.equal(part("manage").textContent, "Manage in Settings › Community");
    for (const name of ["fineprint", "desktop"]) assert.equal(part(name).hidden, true, `${kind} ${name}`);
    assert.equal(part("join").parentElement.hidden, true, "no Join, Link or Copy for a member");
    assert.equal(part("label").children[0].hidden, true, "no Members tag");
    assert.equal(env.ids.get(kind === "theme" ? "music-premium-themes" : "music-node-premium-styles").attrs["aria-describedby"], part("member").id);
  }
  assert.equal(env.ids.get("music-theme-void").children[0].hidden, true, "no lock on a member's theme");
  assert.equal(env.ids.get("music-node-style-prism").children[1].children[1].hidden, true, "nor on a node style's name row");
  env.ids.get("music-premium-style-manage").click();
  assert.deepEqual(opened, ["open"]);

  current = { ...current, selfUnlocked: true };
  env.emit("mefi-community-status", {});
  assert.equal(env.ids.get("music-premium-theme-member").children[0].textContent, "Unlocked in this build", "a SELF_UNLOCKED fork says so");

  premium = false;
  env.emit("mefi-community-change", { premium: false, perks: [], validUntil: null, reason: "not-member" });
  assert.equal(env.ids.get("music-premium-theme-member").hidden, true);
  assert.equal(env.ids.get("music-premium-theme-fineprint").hidden, false);
  assert.equal(env.ids.get("music-premium-theme-fineprint").textContent, "The fork sentence, as community.js has it.", "read from MefiCommunity, not a copy");
  assert.equal(env.ids.get("music-premium-theme-join").parentElement.hidden, false);
  assert.equal(env.ids.get("music-theme-void").children[0].hidden, false, "the lock comes back");
  assert.equal(env.ids.get("music-node-style-prism").children[1].children[1].hidden, false);
  assert.match(env.ids.get("music-theme-void").title, /Preview this Void collection theme.*Discord membership/, "the pointer's tooltip explains the preview");
});

test("MefiMusic exports what other modules read: isNodeStyle for the tree painters and the catalog for Community", () => {
  const env = environment();
  for (const name of ["isPremiumTheme", "isPremiumNodeStyle", "premiumAllowed", "premiumChoice"]) assert.equal(env.music[name], undefined, name);
  assert.equal(env.music.isNodeStyle("prism"), true);
  assert.equal(env.music.isNodeStyle("orbs"), true);
  assert.equal(env.music.isNodeStyle("__proto__"), false);
  const catalog = env.music.premiumCatalog();
  assert.deepEqual([...catalog.themes.map((theme) => theme.key)], PREMIUM_THEMES);
  assert.deepEqual([...catalog.nodeStyles.map((style) => style.key)], PREMIUM_STYLES);
  assert.ok(catalog.themes.every((theme) => /^#[0-9a-f]{6}$/i.test(theme.accent) && /^#[0-9a-f]{6}$/i.test(theme.accent2)), "both hues of every two-tone swatch");
  assert.match(source.slice(0, 400), /^\/\/ Style & sound: Studio's color themes, node styles and layouts, the members'\r?\n\/\/ Void collection/);
});


test("Settings mounts appearance controls while the players stay in the dropdown", () => {
  const env = environment({ preview: true });
  env.document.getElementById = (id) => env.ids.get(id) ?? null;
  const hosts = { look: env.document.createElement("section"), sound: env.document.createElement("section"), effects: env.document.createElement("section") };
  const look = env.ids.get("music-look"), sound = env.ids.get("music-sound");
  env.music.mountSettings(hosts);
  assert.equal(look.parentElement, hosts.look);
  assert.equal(env.ids.get("music-dropdown").contains(sound), true);
  assert.equal(hosts.sound.children.length, 0);
  assert.equal(hosts.effects.children.length, 0);
  assert.deepEqual(env.lifecycle, [], "mounting does not enter Command or claim a sheet");
  env.music.mountSettings(hosts);
  assert.equal(hosts.look.children.filter((node) => node === look).length, 1, "mounting is idempotent");
  assert.equal(hosts.look.children.filter((node) => node.id === "settings-canvas-preview").length, 1);
});

test("the optional canvas preview restores mounted appearance controls and focus on close", () => {
  const env = environment({ preview: true });
  env.document.getElementById = (id) => env.ids.get(id) ?? null;
  const hosts = { look: env.document.createElement("section"), sound: env.document.createElement("section"), effects: env.document.createElement("section") };
  env.music.mountSettings(hosts);
  assert.equal(hosts.look.children[0].id, "settings-canvas-preview", "the preview action precedes appearance controls on first mount");
  env.ids.get("settings-canvas-preview").click();
  env.frames();
  assert.equal(env.lifecycle[0], "claim:appearancePreview");
  assert.notEqual(env.ids.get("music-look").parentElement, hosts.look);
  assert.equal(env.ids.get("music-dropdown").contains(env.ids.get("music-sound")), true);
  env.music.close();
  assert.equal(env.ids.get("music-look").parentElement, hosts.look);
  assert.equal(hosts.look.children[0].id, "settings-canvas-preview", "closing preserves the same order");
  assert.equal(env.document.activeElement.id, "settings-canvas-preview");
  assert.ok(env.lifecycle.includes("release:appearancePreview"));
});

test("locked selections in Settings appear on the canvas but leave saved choices intact", () => {
  const env = environment({ preview: true, saved: { theme: "forest", nodeStyle: "glass" }, community: member(() => false) });
  env.document.getElementById = (id) => env.ids.get(id) ?? null;
  const hosts = { look: env.document.createElement("section"), sound: env.document.createElement("section"), effects: env.document.createElement("section") };
  env.music.mountSettings(hosts);
  env.ids.get("music-theme-abyss").click();
  env.ids.get("music-node-style-prism").click();
  assert.equal(env.music.status().theme, "abyss");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  env.ids.get("settings-canvas-preview").click();
  assert.equal(env.music.status().theme, "abyss", "opening the canvas keeps the chosen look visible");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  env.music.close();
  assert.equal(env.music.status().theme, "forest");
  assert.equal(env.music.graphPreferences().nodeStyle, "glass");
  assert.deepEqual(env.writes, [], "neither the Settings picker nor the canvas saves a locked choice");
});

test("canvas preview owns its registered navigation layer before Settings has mounted", () => {
  const env = environment({ preview: true, previewRegistered: true });
  env.music.openPreview();
  assert.equal(env.lifecycle[0], "claim:appearancePreview", "Escape and focus trapping have a real overlay owner");
  env.music.close();
  assert.equal(env.lifecycle.at(-1), "release:appearancePreview");
  assert.equal(env.ids.get("music-overlay").hidden, true);
});

test("outside dismissal consumes pointerdown, pointerup and click, then accepts the next gesture", () => {
  const env = environment({ preview: true, previewRegistered: true });
  env.music.openPreview();
  const canvas = env.document.createElement("canvas");
  for (const type of ["pointerdown", "pointerup", "click"]) {
    const event = env.gesture(type, canvas);
    assert.equal(event.prevented, true, type);
    assert.equal(event.stopped, true, `${type} cannot reach the tree`);
  }
  assert.equal(env.ids.get("music-overlay").hidden, true);
  for (const type of ["pointerdown", "pointerup", "click"]) assert.equal(env.gesture(type, canvas).stopped, false, `next ${type} reaches the tree`);
});

test("the live Settings drawer switches sections, reveals searched controls and dismisses without selecting work", () => {
  const env = environment({ preview: true });
  const make = (id, parent) => { const node = env.document.createElement("section"); node.id = id; parent?.append(node); return node; };
  const page = make("tab-studio", env.document.body), pane = make("settings-category-appearance", page);
  const look = make("settings-appearance-media", pane);
  const ui = make("settings-appearance", pane), details = make("settings-tree", pane);
  const close = make("appearance-close", pane), dock = make("appearance-dock", pane);
  const walk = (node) => node.children.flatMap(child => [child, ...walk(child)]);
  pane.querySelectorAll = (selector) => walk(pane).filter(node => selector === "[data-appearance-panel]" ? node.dataset.appearancePanel : node.dataset.appearanceSection);
  const routes = [];
  env.window.MefiNav.go = (...args) => routes.push(args);
  env.music.mountSettings({ look });
  env.music.activateSettings("appearance"); env.frames();
  assert.equal(env.music.settingsAppearanceActive(), true);
  assert.equal(env.ids.get("appearance-stage").hidden, false);
  assert.equal(ui.hidden, true); assert.equal(details.hidden, true);
  env.music.revealSettingsTarget(env.ids.get("music-node-layout-helix"));
  assert.equal(env.ids.get("music-node-layouts").parentElement.hidden, false);
  assert.equal(env.ids.get("music-node-heading").parentElement.hidden, true);
  env.music.revealSettingsTarget(env.ids.get("music-color-accent-hex"));
  assert.equal(env.ids.get("music-custom-palette").hidden, false);
  assert.equal(env.ids.get("music-node-layouts").parentElement.hidden, true);
  dock.click();
  assert.equal(env.storage.get("mefiStudio.appearanceDock"), "right");
  assert.equal(env.document.body.dataset.appearanceDock, "right");
  const field = make("field", ui);
  env.music.revealSettingsTarget(field);
  assert.equal(ui.hidden, false);
  assert.equal(env.gesture("pointerdown", field).stopped, false);
  const canvas = env.document.createElement("canvas");
  assert.equal(env.gesture("pointerdown", canvas).stopped, true);
  assert.equal(env.music.settingsAppearanceActive(), false);
  assert.equal(env.ids.get("appearance-stage").hidden, true);
  assert.equal(routes[0][0], "command");
  assert.equal(routes[0][1].preserveSelection, true);
  assert.equal(ui.hidden, false, "normal Settings restores all panels for search");
  env.music.activateSettings("appearance");
  close.click();
  assert.equal(env.music.settingsAppearanceActive(), false);
});

test("appearance controls and view buttons stay interactive, and canceled dismissal does not eat a later click", () => {
  const env = environment({ preview: true, previewRegistered: true });
  env.music.openPreview();
  for (const id of ["music-node-style-halo", "music-tree-view-2d", "music-tree-fit"]) assert.equal(env.gesture("pointerdown", env.ids.get(id)).stopped, false, id);
  assert.equal(env.ids.get("music-overlay").hidden, false);
  const target = env.document.createElement("button");
  env.gesture("pointerdown", target);
  env.gesture("pointercancel", target);
  assert.equal(env.gesture("click", target).stopped, false);
  env.music.openPreview();
  env.gesture("pointerdown", target);
  assert.equal(env.gesture("pointerdown", target, { pointerId: 2 }).stopped, false, "a new press clears an interrupted gesture");
});

test("search reveals custom color fields without applying or saving a different theme", () => {
  const env = environment({ saved: { theme: "aurora" } });
  const field = env.ids.get("music-color-accent-hex");
  const palette = env.ids.get("music-custom-palette");
  const writes = env.writes.length, events = env.events.length, tokens = [...env.styles];
  assert.equal(palette.hidden, true);
  assert.equal(env.music.revealSettingsTarget(field), true);
  assert.equal(palette.hidden, false);
  assert.equal(env.music.status().theme, "aurora");
  assert.equal(env.writes.length, writes); assert.equal(env.events.length, events);
  assert.deepEqual([...env.styles], tokens);
  env.music.activateSettings("appearance");
  assert.equal(palette.hidden, false, "the field remains exposed while editing this category");
  env.music.activateSettings("audio");
  assert.equal(palette.hidden, true, "leaving restores the normal conditional section");
  assert.equal(env.music.status().theme, "aurora");
});

test("search reveals the Links field while local playback and saved source continue unchanged", async () => {
  const env = environment();
  env.music.addFiles([file("Focus.mp3")]); env.ids.get("music-play").click(); await flush();
  env.audio.currentTime = 34;
  const status = JSON.stringify(env.music.status()), source = env.audio.src;
  const writes = env.writes.length, events = env.events.length;
  const field = env.ids.get("music-link-url");
  assert.equal(env.ids.get("music-link-panel").hidden, true);
  assert.equal(env.music.revealSettingsTarget(field), true);
  env.music.setRecommender(null); // An ordinary repaint must not hide the result.
  assert.equal(env.ids.get("music-link-panel").hidden, false);
  assert.equal(env.ids.get("music-local-panel").hidden, true);
  assert.equal(env.ids.get("music-link-tab").attrs["aria-selected"], "true");
  assert.match(env.ids.get("music-source-preview").textContent, /Local music remains the active source/);
  assert.equal(JSON.stringify(env.music.status()), status);
  assert.equal(env.audio.src, source); assert.equal(env.audio.currentTime, 34); assert.equal(env.audio.paused, false);
  assert.equal(env.writes.length, writes); assert.equal(env.events.length, events);
  env.music.activateSettings("general");
  assert.equal(env.ids.get("music-local-panel").hidden, false);
  assert.equal(env.ids.get("music-source-preview").hidden, true);
  assert.equal(env.audio.paused, false);
});

test("revealing local controls preserves a live radio stream until Play explicitly changes source", async () => {
  const env = environment();
  env.music.addFiles([file("Focus.mp3")]);
  env.music.tune("groovesalad"); await flush();
  const deck = env.music.getAudioElement(), stream = deck.src, writes = env.writes.length, events = env.events.length;
  env.music.revealSettingsTarget(env.ids.get("music-play"));
  assert.equal(env.ids.get("music-local-panel").hidden, false);
  assert.equal(env.music.status().source, "radio");
  assert.equal(deck.src, stream); assert.equal(deck.paused, false);
  assert.equal(env.ids.get("music-seek").disabled, true, "local seeking cannot change the borrowed radio deck");
  assert.equal(env.writes.length, writes); assert.equal(env.events.length, events);
  env.ids.get("music-play").click(); await flush();
  assert.equal(env.music.status().source, "local");
  assert.equal(env.music.status().playing, true);
  assert.match(env.music.getAudioElement().src, /^blob:/);
  assert.equal(env.ids.get("music-source-preview").hidden, true);
});

test("revealing radio controls leaves the existing link player mounted and saved source unchanged", () => {
  const env = environment();
  env.music.loadSpotify("https://open.spotify.com/album/37i9dQZF1DX7zqr9q1MPG7");
  const frames = () => env.ids.get("music-link-panel").children.flatMap((child) => child.children).filter((child) => child.tagName === "iframe");
  const player = frames()[0], writes = env.writes.length, events = env.events.length;
  env.music.revealSettingsTarget(env.ids.get("music-radio-volume"));
  assert.equal(env.ids.get("music-radio-panel").hidden, false);
  assert.equal(env.music.status().source, "link");
  assert.equal(frames()[0], player);
  assert.equal(env.writes.length, writes); assert.equal(env.events.length, events);
  env.ids.get("music-radio-tab").parentElement.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(env.document.activeElement, env.ids.get("music-link-tab"), "keyboard navigation follows the displayed panel");
});
// ---- Links: any pasted link as an official embed, a plain file or a hand-off.
const findAll = (node, test, found = []) => { if (test(node)) found.push(node); for (const child of node.children || []) findAll(child, test, found); return found; };
const noticeOf = (env) => findAll(env.document.body, (node) => node.className === "music-notice")[0];
const linkFrames = (env) => findAll(env.ids.get("music-link-panel"), (node) => node.tagName === "iframe" || node.tagName === "video");
const YT = "jNQXAC9IVRw";

test("Pasted links become official embeds, plain files or hand-offs, and nothing else", () => {
  const video = helpers.mediaLink(`https://www.youtube.com/watch?v=${YT}&t=1m30s&si=tracking#comments`);
  assert.equal(video.kind, "embed"); assert.equal(video.provider, "youtube"); assert.equal(video.label, "YouTube video");
  assert.equal(video.url, `https://www.youtube.com/watch?v=${YT}&t=90s`);
  assert.equal(video.embed, `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&enablejsapi=1&start=90`, "the privacy-enhanced player, rebuilt from the id");
  for (const form of [`https://youtu.be/${YT}?si=x`, `https://m.youtube.com/watch?v=${YT}`, `https://www.youtube.com/shorts/${YT}`, `https://www.youtube.com/live/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`]) {
    assert.equal(helpers.mediaLink(form).embed, `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&enablejsapi=1`, form);
  }
  const list = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";
  assert.equal(helpers.mediaLink(`https://www.youtube.com/playlist?list=${list}`).embed, `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&rel=0&playsinline=1&enablejsapi=1`);
  assert.equal(helpers.mediaLink(`https://www.youtube.com/watch?v=${YT}&list=${list}`).label, "YouTube playlist");
  assert.equal(helpers.mediaLink(`https://music.youtube.com/watch?v=${YT}`).label, "YouTube Music track");
  assert.equal(helpers.startSeconds("1h2m3s"), 3723); assert.equal(helpers.startSeconds("45"), 45); assert.equal(helpers.startSeconds("soon"), 0);
  assert.equal(helpers.mediaLink("https://vimeo.com/76979871").embed, "https://player.vimeo.com/video/76979871?dnt=1");
  assert.equal(helpers.mediaLink("https://vimeo.com/76979871/abcdef1234").embed, "https://player.vimeo.com/video/76979871?dnt=1&h=abcdef1234", "an unlisted video keeps its hash");
  assert.equal(helpers.mediaLink("https://soundcloud.com/forss/flickermood?in=x").embed, "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood&visual=true&show_comments=false");
  assert.equal(helpers.mediaLink("https://soundcloud.com/forss/sets/soulhack").label, "SoundCloud playlist");
  assert.equal(helpers.mediaLink("https://open.spotify.com/episode/37i9dQZF1DX7zqr9q1MPG7").label, "Spotify episode");

  const attachment = "https://cdn.discordapp.com/attachments/1/2/Jam%20clip.mp4?ex=66&is=65&hm=abc";
  const clip = helpers.mediaLink(attachment);
  assert.equal(clip.kind, "media"); assert.equal(clip.provider, "discord"); assert.equal(clip.media, "video");
  assert.equal(clip.url, attachment, "a Discord link's signature is its query, kept whole");
  assert.equal(clip.label, "Discord attachment · Jam clip.mp4");
  assert.equal(helpers.mediaLink("https://example.com/sets/song.flac").media, "audio");

  const jam = helpers.mediaLink("https://open.spotify.com/socialsession/5Ab3xYz09kLmNoPq?si=abc");
  assert.equal(jam.kind, "external"); assert.equal(jam.jam, true); assert.equal(jam.label, "Spotify Jam");
  assert.equal(helpers.mediaLink("https://spotify.link/AbCdEf123").kind, "external");
  assert.equal(helpers.mediaLink("https://www.twitch.tv/somechannel").provider, "twitch");
  assert.equal(helpers.mediaLink("https://www.youtube.com/@somechannel").kind, "external");
  assert.equal(helpers.mediaLink("https://soundcloud.com/forss").kind, "external");
  const page = helpers.mediaLink("https://evil.test/playlist/not-spotify");
  assert.equal(page.kind, "external"); assert.equal(page.provider, "web"); assert.equal(helpers.playableLink(page), null);
  for (const bad of ["", "not a link", `http://www.youtube.com/watch?v=${YT}`, `https://user@youtube.com/watch?v=${YT}`, `https://www.youtube.com:444/watch?v=${YT}`,
    "https://www.youtube.com/watch?v=short", "javascript:alert(1)", "data:audio/mp3;base64,AAAA", "file:///C:/music/song.mp3", "blob:private", `https://youtu.be/${YT}/extra`, `https://x.test/${"a".repeat(2100)}.mp3`]) {
    assert.equal(helpers.mediaLink(bad), null, bad);
  }
});

test("Every player the Links tab can build is one the booklet's CSP frames", async () => {
  const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(template)[1];
  const directive = (name) => policy.split(";").map((part) => part.trim().split(/\s+/)).find(([key]) => key === name).slice(1);
  const frames = directive("frame-src");
  for (const raw of [`https://youtu.be/${YT}`, "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI", "https://vimeo.com/76979871", "https://soundcloud.com/forss/flickermood", "https://open.spotify.com/playlist/37i9dQZF1DX7zqr9q1MPG7"]) {
    assert.ok(frames.includes(new URL(helpers.mediaLink(raw).embed).origin), raw);
  }
  assert.ok(directive("media-src").includes("https:"), "plain https files and the radio mirrors are both allowed media");
});

test("A YouTube link autoplays when chosen, and comes back after a relaunch without playing", async () => {
  const env = environment();
  env.music.addFiles([file("Focus.mp3")]); env.ids.get("music-play").click(); await flush();
  assert.equal(env.music.playLink(`https://youtu.be/${YT}?t=12`), true);
  assert.equal(env.audio.paused, true, "the local track stops for the link");
  const status = env.music.status();
  assert.equal(status.source, "link"); assert.equal(status.provider, "YouTube"); assert.equal(status.title, "YouTube video");
  assert.equal(status.playing, false, "an embed's playback is never guessed"); assert.equal(status.externalPlayback, true);
  assert.equal(linkFrames(env).length, 1);
  assert.equal(linkFrames(env)[0].src, `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&enablejsapi=1&start=12&autoplay=1`);
  assert.equal(linkFrames(env)[0].referrerPolicy, "strict-origin-when-cross-origin");
  assert.equal(env.ids.get("music-link-url").value, `https://www.youtube.com/watch?v=${YT}&t=12s`);
  const player = linkFrames(env)[0];
  assert.equal(env.music.playLink(`https://www.youtube.com/watch?v=${YT}&t=12`), true);
  assert.equal(linkFrames(env)[0], player, "choosing the loaded link again keeps its player");
  const saved = JSON.parse(env.storage.get("mefiStudio.music.v1"));
  assert.deepEqual(saved.links, [`https://www.youtube.com/watch?v=${YT}&t=12s`]);
  const relaunched = environment({ saved }); await flush();
  assert.equal(relaunched.music.status().source, "link");
  assert.equal(linkFrames(relaunched).length, 0, "nothing loads from YouTube until the sheet opens");
  relaunched.music.openAudio();
  assert.equal(linkFrames(relaunched)[0].src, `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&enablejsapi=1&start=12`, "a restore never autoplays");
  const recent = findAll(relaunched.ids.get("music-link-panel"), (node) => node.className === "ghost music-recent-link");
  assert.equal(recent.length, 1); assert.equal(recent[0].attrs["aria-current"], "true");
});

test("A plain file or Discord attachment plays in Studio's own element and reports real playback", async () => {
  const env = environment();
  const audios = env.audios.length;
  const attachment = "https://media.discordapp.net/attachments/1/2/demo.mp4?ex=1&is=2&hm=3";
  assert.equal(env.music.playLink(attachment), true);
  assert.equal(env.audios.length, audios, "the analyser's audio decks are untouched");
  const [player] = linkFrames(env);
  assert.equal(player.tagName, "video"); assert.equal(player.src, attachment); assert.equal(player.controls, true);
  assert.equal(env.music.status().playing, false);
  player.paused = false; player.dispatch("play");
  assert.equal(env.music.status().playing, true, "a file's playback is known, unlike an embed's");
  assert.equal(env.music.status().title, "Discord attachment · demo.mp4");
  player.dispatch("error");
  assert.equal(env.music.status().playing, false);
  assert.match(noticeOf(env).textContent, /Attachment links expire/);
  assert.equal(noticeOf(env).dataset.error, "true");
  env.music.setSource("radio");
  assert.equal(linkFrames(env).length, 0, "leaving Links unloads the file");
  assert.equal(player.src, "");
});

test("A Spotify Jam is handed to Spotify and the radio keeps playing", async () => {
  const env = environment();
  env.music.tune("groovesalad"); await flush();
  const deck = env.music.getAudioElement();
  const jam = "https://open.spotify.com/socialsession/5Ab3xYz09kLmNoPq?si=abc";
  assert.equal(env.music.playLink(jam), false);
  assert.equal(env.music.status().source, "radio"); assert.equal(deck.paused, false, "a hand-off never stops what is playing");
  assert.equal(linkFrames(env).length, 0);
  const handoff = env.ids.get("music-link-handoff");
  assert.equal(handoff.hidden, false); assert.equal(env.ids.get("music-link-panel").hidden, false);
  assert.match(handoff.textContent, /Spotify Jam/); assert.match(handoff.textContent, /Premium/);
  assert.match(env.ids.get("music-source-preview").textContent, /Radio remains the active source/);
  env.ids.get("music-link-handoff-open").click(); await flush();
  assert.deepEqual(env.opened, [jam]);
  assert.deepEqual(JSON.parse(env.storage.get("mefiStudio.music.v1")).links, [], "a Jam is not saved as a playable link");
  assert.deepEqual({ ...env.music.linkInfo(jam) }, { provider: "spotify", providerName: "Spotify", kind: "external", label: "Spotify Jam", url: jam, playable: false });
  assert.equal(env.music.playLink("https://evil.test/playlist/not-spotify"), false);
  assert.equal(noticeOf(env).dataset.error, "true", "a page Studio cannot play is refused visibly");
  assert.equal(env.music.linkInfo("nonsense"), null);
});

test("A link dropped from Discord or a browser plays, and a stray text drop does nothing", () => {
  const env = environment();
  const panel = env.ids.get("music-link-panel");
  const transfer = (data) => ({ types: Object.keys(data), getData: (type) => data[type] || "" });
  let prevented = false;
  panel.dispatch("dragover", { dataTransfer: transfer({ "text/uri-list": "x" }), preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, "a link may be dropped here");
  prevented = false;
  panel.dispatch("dragover", { dataTransfer: { types: ["Files"] }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, "files keep going to the local queue");
  panel.dispatch("drop", { dataTransfer: transfer({ "text/uri-list": `# dragged from Discord\r\nhttps://youtu.be/${YT}\r\n` }) });
  assert.equal(env.music.status().provider, "YouTube");
  assert.equal(linkFrames(env).length, 1);
  panel.dispatch("drop", { dataTransfer: transfer({}) });
  assert.equal(env.music.status().provider, "YouTube");
});
