import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/music.js", import.meta.url), "utf8");
const pure = vm.createContext({ URL });
vm.runInContext(`${source.slice(source.indexOf("  const THEMES"), source.indexOf("  let stored;"))}\nthis.api = {spotifyLink, mediaLink, playableLink, startSeconds, safePreferences, audioFile, nextIndex, timeLabel, hexColor, resolvePalette, contrast, THEMES, DEFAULT_THEME, isVoidTheme, isLightTheme, FONTS, LOOKS, safePack};`, pure);
const helpers = pure.api;
const flush = async () => { for (let index = 0; index < 15; index += 1) await Promise.resolve(); };

// mediaWindow: true stands in for renderer/media-window.js (env.player records
// what the menu asks of it); intersection: true gives the feed an
// IntersectionObserver that env.reach() fires, so paging needs no scrolling.
// appearance: true (or a stored appearance) gives the window a MefiAppearance
// that merges presets the way renderer/studio-ui.js does; env.appearance
// holds what it shows and what it last saved.
// shop: a Set of the Shop item ids this PC owns (window.MefiShop.owns, as renderer/friends-shop.js answers it).
function environment({ menuSaved = null, queueSaved = null, mediaVolumeSaved = null, resume = null, saved = null, recommend, preview = false, previewRegistered = false, workspaceActive = false, audioLink = null, search = "", premiumSaved = null, hint = null, community = null, bridge = null, mediaWindow = false, intersection = false, appearance = null, shop = null } = {}) {
  const ids = new Map();
  const events = [];
  const revoked = [];
  const opened = [];
  const styles = new Map();
  const storage = new Map(saved ? [["mefiStudio.music.v1", JSON.stringify(saved)]] : []);
  if (resume) storage.set("mefiStudio.mediaResume.v1", JSON.stringify(resume));
  if (mediaVolumeSaved) storage.set("mefiStudio.mediaVolume.v1", JSON.stringify(mediaVolumeSaved));
  if (queueSaved) storage.set("mefiStudio.mediaQueue.v1", JSON.stringify(queueSaved));
  if (menuSaved) storage.set("mefiStudio.mediaMenu.v1", JSON.stringify(menuSaved));
  // The Void collection: a saved premium choice and the community boot hint.
  if (premiumSaved) storage.set("mefiStudio.music.premium.v1", JSON.stringify(premiumSaved));
  if (hint) storage.set("mefiStudio.community.v1", JSON.stringify(hint));
  const writes = [];
  const toasts = [];
  const lifecycle = [];
  const typeScopes = [];
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
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.style = { setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) }; const classes = new Set(); this.classList = { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value) }; this.hidden = false; this.disabled = false; this.value = ""; }
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
    // Only the two selectors the menu asks: a tag name, or "[hidden]".
    closest(selector) { for (let node = this; node; node = node.parentElement) if (selector === "[hidden]" ? node.hidden : node.tagName === selector) return node; return null; }
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
    createElement: (tag) => { if (tag === "audio") { audios.push(audio = new Audio()); return audio; } const node = new Element(tag); if (tag === "iframe") { node.messages = []; node.contentWindow = { postMessage: (data, origin) => node.messages.push([JSON.parse(data), origin]) }; } return node; },
  };
  for (const id of ["settings-audio-open"]) {
    const anchor = document.createElement("button"); anchor.id = id;
    anchor.getBoundingClientRect = () => ({ width: 150, height: 36, top: 84, bottom: 120, right: 950 });
    document.body.append(anchor);
  }
  // studio-ui.js's applyAppearance: a preset brings its values, the patch wins over them.
  const PRESETS = { focus: { glass: 0, glow: 0, density: "compact" }, studio: { glass: 45, glow: 35, density: "comfortable" }, atmosphere: { glass: 85, glow: 80, density: "comfortable" } };
  const appearanceState = { now: { preset: "studio", density: "comfortable", glass: 45, glow: 35, ...(appearance && typeof appearance === "object" ? appearance : {}) }, saved: appearance && typeof appearance === "object" ? { ...appearance } : null, applies: [] };
  const appearanceApi = {
    get: () => ({ ...appearanceState.now }),
    apply: (patch = {}, save = true) => {
      appearanceState.now = { ...appearanceState.now, ...(patch.preset ? PRESETS[patch.preset] : {}), ...patch };
      appearanceState.applies.push([{ ...patch }, save]);
      if (save) appearanceState.saved = { ...appearanceState.now };
    },
  };
  const context = vm.createContext({
    URL: RuntimeURL, document,
    localStorage: { removeItem: key => storage.delete(key), getItem: (key) => storage.get(key), setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); } },
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
      // typeScope: nav.js sends typing in the menu to the box a resolver names.
      MefiNav: { get: (id) => (previewRegistered && id === "appearancePreview") || ["help", "palette", "profiler"].includes(id) ? { id, kind: "overlay" } : null, claim: (id) => lifecycle.push(`claim:${id}`), release: (id) => lifecycle.push(`release:${id}`), typeScope: (node, resolve) => typeScopes.push([node, resolve]) },
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
      ...(appearance ? { MefiAppearance: appearanceApi } : {}),
      ...(shop ? { MefiShop: { owns: (id) => shop.has(id), open: (view) => opened.push(`shop:${view}`) } } : {}),
    },
  });
  context.window.MefiMediaBrowser = { create: () => ({
    active: false, state: {},
    async open(url) { const result = await context.window.mefiStudio.mediaBrowserOpen(url); if (result?.ok) { this.active = true; this.state = result.state || { url, title: "Media browser" }; } return result; },
    close() { this.active = false; },
  }) };
  // What music.js asks of the player window, recorded; the placement it
  // reports back follows the same rules as media-window.js (docked only while
  // shown, not minimized and not a backdrop).
  const player = { calls: [], options: null, host: null, shown: null, inset: null, aside: null, minimized: false, background: false, docked: false, refuseDock: false };
  const publish = () => {
    const visible = Boolean(player.shown), backdrop = visible && player.background && !player.minimized && player.shown.shape !== "browser";
    player.docked = Boolean(player.host) && visible && !player.minimized && !backdrop;
    player.options.onPlacement?.({ background: backdrop, minimized: player.minimized, docked: player.docked, visible });
  };
  if (mediaWindow) context.window.MefiMediaWindow = { create: (options) => {
    player.options = options;
    return {
      show: (link) => { player.calls.push(["show", link.label ?? null]); player.shown = link; publish(); },
      hide: () => { player.calls.push(["hide"]); player.shown = null; player.minimized = false; publish(); },
      reveal: () => player.calls.push(["reveal"]),
      dock: (host) => { player.calls.push(["dock", host ? host.id : null]); if (host && player.refuseDock) return false; player.host = host || null; publish(); return player.docked; },
      clip: (inset) => { player.calls.push(["clip", inset]); player.inset = inset; },
      avoid: (rect) => { player.calls.push(["avoid", rect ? { ...rect } : null]); player.aside = rect || null; },
      rename: (label) => player.calls.push(["rename", label]),
      setBackground: (value) => { player.calls.push(["background", Boolean(value)]); player.background = Boolean(value); publish(); },
      snapshot: () => ({ minimized: player.minimized }),
      restore: (value) => { player.calls.push(["restore", value ?? null]); if (value && Boolean(value.minimized) !== player.minimized) { player.minimized = Boolean(value.minimized); publish(); } },
      minimize: () => { player.minimized = !player.minimized; publish(); },
      beginMove: () => {}, moveKey: () => {},
    };
  } };
  const observers = [];
  if (intersection) context.window.IntersectionObserver = class { constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observers.push(this); } observe(target) { this.targets.push(target); } disconnect() { this.targets = []; } };
  vm.runInContext(source, context);
  const music = context.window.MefiMusic;
  music.init();
  return { music, window: context.window, ids, events, revoked, opened, styles, storage, document, audio, audios, refused, lifecycle, writes, toasts, player, observers, typeScopes, appearance: appearanceState,
    // The list's end scrolls into view: every observer that watches something is told so.
    reach: () => { for (const observer of observers) if (observer.targets.length) observer.callback(observer.targets.map((target) => ({ target, isIntersecting: true }))); },
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
    message: (event) => listeners.get("message")?.(event),
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
  assert.equal(value.theme, "chrome", "an unknown theme falls back to the default, Chrome"); assert.equal(value.volume, 1);
  assert.deepEqual(Array.from(value.links), [link], "the list saved before the Links tab is read into links");
  assert.deepEqual(Object.keys(value).sort(), ["customColors", "extraGlow", "font", "links", "nodeLayout", "nodeStyle", "orbitTrails", "pack", "radioOn", "source", "station", "theme", "volume"]);
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

// Chrome (renderer/chrome.css) is listed first and is what a new install
// opens in, with the website's exact palette; a theme already saved, Aurora
// (the default before it) among them, is kept, and every other theme stays.
test("Chrome is the first theme and a new install's default, and a saved theme still wins", () => {
  const themes = JSON.parse(JSON.stringify(helpers.THEMES));
  assert.equal(Object.keys(themes)[0], "chrome", "listed first");
  assert.deepEqual(themes.chrome, { name: "Chrome", accent: "#c3c8d0", bright: "#eef1f5", rgb: "195,200,208", bg: "#0a0a0c", panel: "#141418", muted: "#a4a9b2", text: "#edeff2" }, "the website's palette, solo, outside the Void collection");
  assert.equal(helpers.isVoidTheme("chrome"), false);
  assert.deepEqual(Object.keys(themes), ["chrome", "gold", "midnight", "forest", "violet", "ember", "aurora", "rose", "daylight", "paper", "void", "eclipse", "abyss", "dusk"], "fourteen themes");
  assert.equal(helpers.DEFAULT_THEME, "chrome");
  assert.equal(helpers.safePreferences(null).theme, "chrome");
  const fresh = environment();
  assert.equal(fresh.music.status().theme, "chrome", "nothing saved: Chrome");
  assert.equal(fresh.document.documentElement.dataset.studioTheme, "chrome");
  assert.equal(fresh.document.documentElement.dataset.studioThemeTier, "solo");
  assert.equal(fresh.document.documentElement.dataset.studioThemeTone, "dark");
  assert.equal(fresh.styles.get("--gold"), "#c3c8d0");
  assert.equal(fresh.styles.get("--bg"), "#0a0a0c");
  assert.equal(fresh.styles.get("--panel-solid"), "#141418");
  assert.deepEqual(Array.from(fresh.music.themes(), (theme) => theme.key), Object.keys(themes), "the pickers list every theme, Chrome first");
  for (const key of ["aurora", "gold", "dusk", "custom"]) {
    const kept = environment({ saved: { theme: key } });
    assert.equal(kept.music.status().theme, key, `a saved ${key} is kept`);
    assert.equal(kept.document.documentElement.dataset.studioTheme, key);
  }
  fresh.music.applyTheme("aurora");
  assert.equal(environment({ saved: JSON.parse(fresh.storage.get("mefiStudio.music.v1")) }).music.status().theme, "aurora", "Aurora stays selectable");
});

test("every theme and the custom palette read at 4.5:1: text, muted, dim and bright on panels, the canvas, and the ink on the accent", () => {
  const palettes = [...Object.keys(helpers.THEMES).map((key) => [key, helpers.resolvePalette(key, {})]), ["custom", helpers.resolvePalette("custom", {})]];
  assert.equal(palettes.length, 15, "fourteen themes and the custom palette");
  for (const [key, palette] of palettes) {
    for (const ink of ["text", "muted", "dim", "bright"]) assert.ok(helpers.contrast(palette[ink], palette.surface) >= 4.5, `${key}: ${ink} on the panel`);
    for (const ink of ["text", "muted"]) assert.ok(helpers.contrast(palette[ink], palette.readingBackground) >= 4.5, `${key}: ${ink} on the page`);
    assert.ok(helpers.contrast(palette.border, palette.surface) >= 3, `${key}: the strong hairline`);
    for (const ink of ["text", "muted"]) assert.ok(helpers.contrast(palette.canvas[ink], palette.canvas.background) >= 4.5, `${key}: canvas ${ink}`);
    for (const fill of ["accent", "actionEnd"]) assert.ok(helpers.contrast(palette.onAccent, palette[fill]) >= 4.5, `${key}: the ink on ${fill}`);
  }
  const chrome = helpers.resolvePalette("chrome", {});
  assert.deepEqual([chrome.text, chrome.muted, chrome.background, chrome.surface, chrome.onAccent], ["#edeff2", "#a4a9b2", "#0a0a0c", "#141418", "#000000"], "Chrome's own colours need no correction");
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
  assert.deepEqual(saved, { theme: "violet", pack: null, font: "studio", customColors: { ...env.music.customColors() }, volume: .35, links: [link], station: null, source: "local", radioOn: false, nodeStyle: "minimal", nodeLayout: "tree", orbitTrails: false, extraGlow: false });
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
  assert.deepEqual(saved, { theme: "forest", pack: null, font: "studio", customColors: { ...env.music.customColors() }, volume: .35, links: [link], station: null, source: "local", radioOn: false, nodeStyle: "minimal", nodeLayout: "radial", orbitTrails: true, extraGlow: true });
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
    // The ink on the accent's fills reads on the accent and on bright, which fills the other end of many of them:
    // the ink whose worse fill reads better, which is one at 4.5 on both whenever either ink gets there.
    const worst = (ink) => Math.min(helpers.contrast(ink, palette.accent), helpers.contrast(ink, palette.bright));
    const other = palette.onAccent === "#FFFFFF" ? "#000000" : "#FFFFFF";
    assert.ok(worst(palette.onAccent) >= worst(other), `${colors.accent}: the ink with the better worst case`);
    if (colors.accent === "#BA2460") assert.ok(worst(palette.onAccent) >= 4.5, "a light panel's deeper bright takes the same ink as its accent");
    assert.ok(helpers.contrast(palette.onAccent, palette.actionEnd) >= 4.5);
    assert.equal(env.styles.get("--studio-reading-bg"), palette.readingBackground);
    assert.equal(env.styles.get("--studio-action-end"), palette.actionEnd);
    assert.equal(env.styles.get("--cmd-bg"), colors.background, "canvas preserves the selected background");
    assert.equal(env.music.customColors().surface, colors.surface, "contrast protection does not rewrite saved colours");
  }
});

// The rail and the Command view read the palette every frame (the rail once
// per node), so it is resolved once per theme and custom palette and shared.
test("themePalette is resolved once per theme and custom palette, frozen, and follows every change", () => {
  const env = environment({ saved: { theme: "aurora" } });
  const first = env.music.themePalette();
  assert.equal(env.music.themePalette(), first, "an unchanged theme hands back the same palette");
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.canvas), "readers share it, so nobody can edit it");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify({ theme: "aurora", ...helpers.resolvePalette("aurora", {}) })));
  env.music.applyTheme("rose");
  const rose = env.music.themePalette();
  assert.notEqual(rose, first);
  assert.equal(rose.theme, "rose");
  assert.equal(rose.canvas.background, helpers.resolvePalette("rose", {}).canvas.background);
  env.music.applyCustomColors({ accent: "#777777", background: "#FFFFFF", surface: "#000000", text: "#222222" });
  const custom = env.music.themePalette();
  assert.equal(custom.theme, "custom");
  assert.equal(custom.background, "#FFFFFF");
  assert.equal(env.music.themePalette(), custom);
  env.music.applyCustomColors({ background: "#101010" });
  const edited = env.music.themePalette();
  assert.notEqual(edited, custom, "a custom colour change resolves a new palette");
  assert.equal(edited.background, "#101010");
  assert.deepEqual(JSON.parse(JSON.stringify(edited)), JSON.parse(JSON.stringify({ theme: "custom", ...helpers.resolvePalette("custom", env.music.customColors()) })));
  env.music.applyTheme("aurora");
  assert.equal(env.music.themePalette().theme, "aurora");
  assert.equal(env.music.themePalette().background, first.background);
});

// ---- Light themes, looks and style packs ----
const LIGHT_THEMES = ["daylight", "paper"];
const musicSaves = (env) => env.writes.filter(([key]) => key === "mefiStudio.music.v1").map(([, value]) => JSON.parse(value));
const SAKURA = { id: "studio:pack-sakura", name: "Sakura (light)", palette: { accent: "#D6457A", accent2: "#8a6bd1", background: "#fbf6f4", surface: "#ffffff", text: "#2b1f24" }, nodeStyle: "minimal", material: "focus", font: "serif" };
const SYNTHWAVE = { id: "studio:pack-synthwave", name: "Synthwave", palette: { accent: "#ff4fa3", accent2: "#8b5cff", background: "#0d0b1f", surface: "#17132e", text: "#f3ecff" }, nodeStyle: "halo", material: "atmosphere", font: "display" };
const DEEP_SEA = { id: "studio:pack-deep-sea", name: "Deep sea", palette: { accent: "#2fd6c3", accent2: "#3a7bff", background: "#04131c", surface: "#0a2230", text: "#e2f6f7" }, nodeStyle: "glass" };

test("Daylight and Paper are light themes whose every ink reads at 4.5:1 on the page and on the panels", () => {
  assert.deepEqual(Object.keys(helpers.THEMES).filter((key) => helpers.isLightTheme(key)), LIGHT_THEMES);
  for (const key of Object.keys(helpers.THEMES)) {
    const palette = helpers.resolvePalette(key, {});
    // Text, muted and dim are the reading inks; bright marks links and chosen tabs; the accent titles eyebrows.
    for (const ink of ["text", "muted", "dim", "bright"]) {
      for (const surface of ["surface", "readingBackground"]) assert.ok(helpers.contrast(palette[ink], palette[surface]) >= 4.5, `${key}: ${ink} on ${surface} at ${helpers.contrast(palette[ink], palette[surface]).toFixed(2)}`);
    }
    if (!helpers.isLightTheme(key)) continue;
    assert.equal(palette.readingBackground, palette.background, `${key}: the page itself is a reading surface`);
    for (const ink of ["text", "muted", "dim", "bright", "accent"]) {
      for (const surface of ["surface", "background"]) assert.ok(helpers.contrast(palette[ink], palette[surface]) >= 4.5, `${key}: ${ink} on ${surface} at ${helpers.contrast(palette[ink], palette[surface]).toFixed(2)}`);
    }
    assert.ok(helpers.contrast(palette.text, palette.background) >= 7, `${key}: body text at AAA on the page`);
    // Accent words sit on accent-tinted rows and chips too (the sweep found them under 4.5 at a lighter accent).
    const tint = (base, amount) => `#${[1, 3, 5].map((at) => { const from = parseInt(base.slice(at, at + 2), 16), to = parseInt(palette.accent.slice(at, at + 2), 16); return Math.round(from + (to - from) * amount).toString(16).padStart(2, "0"); }).join("")}`;
    assert.ok(helpers.contrast(palette.accent, tint(palette.background, .14)) >= 4.5, `${key}: the accent on its own 14% tint`);
    assert.ok(helpers.contrast(palette.bright, tint(palette.surface, .3)) >= 4.5, `${key}: bright on a 30% accent tint`);
    for (const fill of ["accent", "actionEnd"]) assert.ok(helpers.contrast(palette.onAccent, palette[fill]) >= 4.5, `${key}: the ink on ${fill}`);
    assert.ok(helpers.contrast(palette.border, palette.surface) >= 3, `${key}: the strong hairline`);
    for (const ink of ["text", "muted"]) assert.ok(helpers.contrast(palette.canvas[ink], palette.canvas.background) >= 4.5, `${key}: the Map's ${ink}`);
    const env = environment({ saved: { theme: key } });
    assert.equal(env.document.documentElement.dataset.studioThemeTone, "light", `${key}: the stylesheets' light tone`);
    assert.equal(env.document.documentElement.dataset.studioThemeTier, "solo");
    assert.equal(env.music.themes().find((theme) => theme.key === key).tone, "light");
  }
  assert.equal(environment().music.themes().find((theme) => theme.key === "chrome").tone, "dark");
  // A light custom palette's deeper accent ink lets its own page be the reading surface.
  const custom = helpers.resolvePalette("custom", { accent: "#8A5A00", background: "#F4F0E6", surface: "#FFFFFF", text: "#1D1B17" });
  assert.equal(custom.readingBackground, "#F4F0E6");
  for (const ink of ["text", "muted", "dim", "bright"]) assert.ok(helpers.contrast(custom[ink], custom.readingBackground) >= 4.5, `custom: ${ink} on its page`);
});

test("a light tone switches the native controls to light, and the status hues deepen to read on it", async () => {
  const styles = (await readFile(new URL("../renderer/styles.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const block = styles.match(/\n:root\[data-studio-theme-tone="light"\] \{\n([\s\S]*?)\n\}/);
  assert.ok(block, "styles.css has the light tone's own token block");
  const tokens = Object.fromEntries(block[1].split(";").map((line) => line.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter(Boolean).map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]));
  assert.equal(tokens["color-scheme"], "light");
  assert.match(styles, /^ {2}color-scheme: dark;$/m, "dark stays the default");
  for (const key of LIGHT_THEMES) {
    const palette = helpers.resolvePalette(key, {});
    for (const hue of ["--bad", "--warn", "--good", "--live", "--info", "--idea"]) {
      for (const surface of [palette.background, palette.surface]) assert.ok(helpers.contrast(tokens[hue], surface) >= 4.5, `${key}: ${hue} ${tokens[hue]} on ${surface}`);
    }
  }
});

test("looks: Light, Dark and Stylized share every built-in theme out once, Chrome first in Dark, Stylized with its own extras", () => {
  const env = environment();
  // Plain copies across the vm boundary, so deepEqual compares values.
  const looks = JSON.parse(JSON.stringify(env.music.looks()));
  assert.deepEqual(looks.map((look) => look.id), ["light", "dark", "stylized"]);
  assert.deepEqual(looks.map((look) => look.name), ["Light", "Dark", "Stylized"]);
  assert.deepEqual(looks[0].themes, LIGHT_THEMES);
  assert.equal(looks[1].themes[0], "chrome", "Dark opens on Chrome");
  assert.deepEqual(looks[2].themes, ["aurora", "void", "eclipse", "abyss", "dusk"]);
  const all = looks.flatMap((look) => look.themes);
  assert.deepEqual([...all].sort(), Object.keys(helpers.THEMES).sort(), "each theme is in one look, once");
  assert.ok(looks[1].themes.every((key) => !helpers.isLightTheme(key)), "Dark holds no light theme");
  assert.deepEqual(looks.map((look) => [look.material, look.font]), [["studio", "studio"], ["studio", "studio"], ["atmosphere", "display"]]);
  env.music.looks()[0].themes.push("chrome");
  assert.deepEqual([...env.music.looks()[0].themes], LIGHT_THEMES, "callers get copies");
});

test("applyLook puts on the theme with its material and heading face, resets them for Light and Dark, and a restart brings it all back", () => {
  const env = environment({ appearance: { preset: "studio", glass: 60, glow: 20, density: "compact" } });
  const root = env.document.documentElement;
  assert.equal(root.dataset.studioFont, "studio", "a new install keeps each theme's own headings");
  assert.equal(env.styles.has("--font-display"), false);
  assert.equal(env.music.applyLook("stylized", "void"), "void");
  assert.equal(env.music.status().theme, "void");
  assert.equal(env.music.look(), "stylized");
  assert.equal(root.dataset.studioThemeTier, "duo");
  assert.equal(root.dataset.studioFont, "display");
  assert.equal(env.styles.get("--font-display"), helpers.FONTS.display.stack);
  assert.deepEqual(env.window.MefiAppearance.get(), { preset: "atmosphere", glass: 85, glow: 80, density: "compact" }, "the material, and the person's own density");
  assert.deepEqual([musicSaves(env).at(-1).theme, musicSaves(env).at(-1).font], ["void", "display"]);
  // A restart: both stores come back as they were saved.
  const restarted = environment({ saved: musicSaves(env).at(-1), appearance: env.appearance.saved });
  assert.equal(restarted.music.status().theme, "void");
  assert.equal(restarted.document.documentElement.dataset.studioFont, "display");
  assert.equal(restarted.styles.get("--font-display"), helpers.FONTS.display.stack);
  assert.equal(restarted.window.MefiAppearance.get().preset, "atmosphere");
  assert.equal(restarted.music.look(), "stylized");
  // Dark with a theme it does not list: its first theme, and the plain extras back.
  assert.equal(restarted.music.applyLook("dark", "abyss"), "chrome");
  assert.equal(restarted.document.documentElement.dataset.studioFont, "studio");
  assert.equal(restarted.styles.has("--font-display"), false, "the theme's own face again");
  assert.deepEqual(restarted.window.MefiAppearance.get(), { preset: "studio", glass: 45, glow: 35, density: "compact" });
  assert.equal(restarted.music.applyLook("light", "paper"), "paper");
  assert.equal(restarted.document.documentElement.dataset.studioThemeTone, "light");
  assert.equal(restarted.music.look(), "light");
  const before = restarted.storage.get("mefiStudio.music.v1");
  assert.equal(restarted.music.applyLook("neon", "chrome"), null, "no such look");
  assert.equal(restarted.music.applyLook("dark", "midnight", false), "midnight", "a look can be shown without saving");
  assert.equal(restarted.storage.get("mefiStudio.music.v1"), before);
  assert.equal(restarted.appearance.applies.at(-1)[1], false);
  // Custom is in no look.
  restarted.music.applyCustomColors({ accent: "#22bbaa" });
  assert.equal(restarted.music.look(), null);
});

test("the heading faces are one table of system faces; Settings offers them, and a choice saves", async () => {
  const fonts = helpers.FONTS;
  assert.deepEqual(Object.keys(fonts), ["studio", "display", "serif", "mono"]);
  assert.equal(fonts.studio.stack, null, "Studio keeps each theme's own face");
  for (const key of ["display", "serif", "mono"]) {
    assert.match(fonts[key].stack, /, (sans-serif|serif|monospace)$/, `${key} ends in a generic family`);
    assert.doesNotMatch(fonts[key].stack, /url\(|https?:|@import/i, `${key}: no web font`);
  }
  for (const name of ["music.css", "studio-ui.css", "styles.css"]) assert.doesNotMatch(await readFile(new URL(`../renderer/${name}`, import.meta.url), "utf8"), /@font-face/, `${name} loads no font`);
  const env = environment({ saved: { theme: "gold" } });
  assert.deepEqual(env.ids.get("music-fonts").children.map((choice) => choice.dataset.font), Object.keys(fonts));
  assert.equal(env.ids.get("music-font-label").textContent, "Headings");
  assert.equal(env.ids.get("music-font-studio").attrs["aria-pressed"], "true");
  env.ids.get("music-font-mono").click();
  assert.equal(env.music.font(), "mono");
  assert.equal(env.document.documentElement.dataset.studioFont, "mono");
  assert.equal(env.styles.get("--font-display"), fonts.mono.stack);
  assert.equal(env.styles.get("--studio-title-tracking"), fonts.mono.tracking);
  assert.equal(env.ids.get("music-font-mono").attrs["aria-pressed"], "true");
  assert.equal(env.ids.get("music-font-studio").attrs["aria-pressed"], "false");
  assert.equal(musicSaves(env).at(-1).font, "mono");
  assert.equal(env.music.status().theme, "gold", "a face changes no colour");
  assert.deepEqual(Array.from(env.music.fonts(), (font) => font.key), Object.keys(fonts));
  assert.equal(env.music.applyFont("comic-sans"), "studio", "an unknown face is the theme's own");
  assert.equal(env.styles.has("--font-display"), false);
  assert.equal(helpers.safePreferences({ font: "papyrus" }).font, "studio");
});

test("Settings lists the light themes under a heading of their own, apart from the dark ones", () => {
  const env = environment();
  assert.deepEqual(env.ids.get("music-light-themes").children.map((choice) => choice.dataset.theme), LIGHT_THEMES);
  assert.equal(env.ids.get("music-light-theme-label").textContent, "Light");
  const section = env.ids.get("music-light-themes").parentElement;
  const main = section.children.find((child) => child.className === "music-themes" && !child.id);
  assert.deepEqual(main.children.map((choice) => choice.dataset.theme), [...Object.keys(helpers.THEMES).filter((key) => !helpers.isVoidTheme(key) && !helpers.isLightTheme(key)), "custom"], "the first group keeps the dark themes and Custom");
  assert.ok(section.children.indexOf(env.ids.get("music-light-themes")) < section.children.indexOf(env.ids.get("music-void-themes")), "Light sits above the Void collection");
  env.ids.get("music-theme-paper").click();
  assert.equal(env.music.status().theme, "paper");
  assert.equal(env.ids.get("music-theme-paper").attrs["aria-pressed"], "true");
  assert.equal(musicSaves(env).at(-1).theme, "paper");
  assert.equal(env.document.documentElement.dataset.studioThemeTone, "light");
  env.ids.get("music-theme-void").click();
  assert.equal(env.ids.get("music-theme-paper").attrs["aria-pressed"], "false");
  assert.equal(env.document.documentElement.dataset.studioThemeTone, "dark");
});

test("applyPack paints a pack the way Custom is painted, two-tone with its second hue, keeps it and brings it back at boot", () => {
  const env = environment({ appearance: { preset: "studio", glass: 45, glow: 35, density: "spacious" } });
  const root = env.document.documentElement;
  assert.equal(env.music.packInfo(), null);
  assert.equal(env.music.applyPack(SAKURA), true);
  assert.equal(env.music.status().theme, "pack");
  assert.equal(root.dataset.studioTheme, "pack");
  assert.equal(root.dataset.studioThemeTier, "duo", "a second hue makes it two-tone");
  assert.equal(root.dataset.studioThemeTone, "light");
  assert.equal(env.styles.get("--accent-2"), "#8a6bd1");
  assert.equal(env.styles.get("--gold"), "#d6457a", "colours are kept lower-case");
  const palette = env.music.themePalette();
  assert.equal(palette.theme, "pack");
  assert.deepEqual(JSON.parse(JSON.stringify(palette)), JSON.parse(JSON.stringify({ theme: "pack", ...helpers.resolvePalette("pack", {}, helpers.safePack(SAKURA)) })));
  for (const ink of ["text", "muted", "dim", "bright"]) assert.ok(helpers.contrast(palette[ink], palette.surface) >= 4.5, `the pack's ${ink}`);
  // A light pack's bright is deeper than its accent, so the ink on its fills is white, and its second hue moves until white reads on it.
  assert.equal(palette.onAccent, "#FFFFFF");
  assert.equal(env.styles.get("--accent-2-fill"), palette.accent2Fill);
  assert.ok(helpers.contrast("#FFFFFF", palette.accent2Fill) >= 4.5);
  assert.equal(env.music.graphPreferences().nodeStyle, "minimal");
  assert.equal(root.dataset.studioFont, "serif");
  assert.deepEqual(env.window.MefiAppearance.get(), { preset: "focus", glass: 0, glow: 0, density: "spacious" });
  const info = env.music.packInfo();
  assert.deepEqual(JSON.parse(JSON.stringify(info)), { id: "studio:pack-sakura", name: "Sakura (light)", palette: { accent: "#d6457a", background: "#fbf6f4", surface: "#ffffff", text: "#2b1f24", accent2: "#8a6bd1" }, nodeStyle: "minimal", material: "focus", font: "serif" });
  info.palette.accent = "#000000";
  assert.equal(env.music.packInfo().palette.accent, "#d6457a", "callers get a copy");
  const saved = musicSaves(env).at(-1);
  assert.equal(saved.theme, "pack");
  assert.deepEqual(saved.pack, JSON.parse(JSON.stringify(env.music.packInfo())));
  // Boot: the pack, its face and its two hues come back with it.
  const booted = environment({ saved, appearance: env.appearance.saved });
  assert.equal(booted.music.status().theme, "pack");
  assert.deepEqual(JSON.stringify(booted.music.packInfo()), JSON.stringify(env.music.packInfo()));
  assert.equal(booted.document.documentElement.dataset.studioThemeTier, "duo");
  assert.equal(booted.styles.get("--accent-2"), "#8a6bd1");
  assert.equal(booted.document.documentElement.dataset.studioFont, "serif");
  assert.equal(booted.music.graphPreferences().nodeStyle, "minimal");
  assert.equal(booted.window.MefiAppearance.get().preset, "focus");
  // Only data from the tables is painted or kept.
  const writes = env.writes.length;
  for (const bad of [
    { ...SAKURA, palette: { ...SAKURA.palette, text: "red" } },
    { ...SAKURA, palette: { ...SAKURA.palette, accent2: "url(x)" } },
    { ...SAKURA, palette: { accent: "#ffffff" } },
    { ...SAKURA, nodeStyle: "dragon" }, { ...SAKURA, material: "neon" }, { ...SAKURA, font: "papyrus" },
    { name: "No palette" }, null, "studio:pack-sakura",
  ]) assert.equal(env.music.applyPack(bad), false, JSON.stringify(bad));
  assert.equal(env.writes.length, writes, "a refused pack changes nothing");
  assert.equal(env.music.packInfo().name, "Sakura (light)");
  assert.equal(env.music.applyPack({ ...DEEP_SEA, css: "body{display:none}", palette: { ...DEEP_SEA.palette, extra: "#123456" } }), true);
  assert.deepEqual(Object.keys(env.music.packInfo()).sort(), ["id", "name", "nodeStyle", "palette"]);
  assert.deepEqual(Object.keys(env.music.packInfo().palette).sort(), ["accent", "accent2", "background", "surface", "text"]);
  assert.equal(root.dataset.studioFont, "studio", "a pack that names no face has the theme's own");
  assert.equal(env.music.applyPack({ ...DEEP_SEA, palette: { ...DEEP_SEA.palette, accent2: undefined } }), true);
  assert.equal(root.dataset.studioThemeTier, "solo", "no second hue, no two tones");
  // Another theme puts the pack away.
  env.music.applyTheme("chrome");
  assert.equal(env.music.packInfo(), null);
  assert.equal(musicSaves(env).at(-1).pack, null);
  assert.equal(helpers.safePreferences({ theme: "pack" }).theme, "chrome", "no pack, no pack theme");
  assert.equal(helpers.safePreferences({ theme: "chrome", pack: helpers.safePack(SAKURA) }).pack, null);
  assert.equal(env.music.applyTheme("pack"), "chrome", "the pack theme needs a pack");
});

test("previewPack shows a pack for the Shop's Try without saving, and endPreview puts back exactly what was there", () => {
  const appearance = { preset: "studio", glass: 60, glow: 20, density: "compact" };
  const env = environment({ saved: { theme: "midnight", nodeStyle: "glass", font: "mono" }, appearance });
  const root = env.document.documentElement;
  const storedMusic = env.storage.get("mefiStudio.music.v1");
  const before = { theme: root.dataset.studioTheme, tier: root.dataset.studioThemeTier, tone: root.dataset.studioThemeTone, font: root.dataset.studioFont, display: env.styles.get("--font-display"), gold: env.styles.get("--gold"), palette: env.music.themePalette(), nodeStyle: env.music.graphPreferences().nodeStyle, appearance: env.window.MefiAppearance.get() };
  assert.equal(env.music.endPreview(), false, "nothing to end");
  assert.equal(env.music.previewPack(SYNTHWAVE), true);
  assert.equal(root.dataset.studioTheme, "pack");
  assert.equal(root.dataset.studioThemeTier, "duo");
  assert.equal(env.styles.get("--gold"), "#ff4fa3");
  assert.equal(env.music.themePalette().theme, "pack", "the Map shows the try too");
  assert.equal(env.music.graphPreferences().nodeStyle, "halo");
  assert.equal(root.dataset.studioFont, "display");
  assert.equal(env.window.MefiAppearance.get().preset, "atmosphere");
  assert.equal(env.events.filter((event) => event.type === "mefi-theme-change").at(-1).detail.preview, true, "Workspace keeps its saved accent");
  assert.equal(env.music.status().theme, "midnight", "the applied theme is still Midnight");
  assert.equal(env.music.packInfo(), null, "nothing is applied");
  // Trying another: a pack without a material puts the material back.
  assert.equal(env.music.previewPack(DEEP_SEA), true);
  assert.equal(env.styles.get("--gold"), "#2fd6c3");
  assert.equal(env.music.graphPreferences().nodeStyle, "glass");
  assert.equal(root.dataset.studioFont, "studio");
  assert.deepEqual(env.window.MefiAppearance.get(), appearance);
  assert.equal(env.music.previewPack({ palette: { accent: "nope" } }), false);
  assert.equal(env.music.endPreview(), true);
  assert.deepEqual({ theme: root.dataset.studioTheme, tier: root.dataset.studioThemeTier, tone: root.dataset.studioThemeTone, font: root.dataset.studioFont, display: env.styles.get("--font-display"), gold: env.styles.get("--gold"), palette: env.music.themePalette(), nodeStyle: env.music.graphPreferences().nodeStyle, appearance: env.window.MefiAppearance.get() }, before);
  assert.equal(env.storage.get("mefiStudio.music.v1"), storedMusic, "a try writes nothing");
  assert.equal(env.appearance.saved.glass, 60, "nor the material");
  assert.ok(env.appearance.applies.every(([, save]) => save === false));
  assert.equal(env.music.endPreview(), false);
  // Choosing for real ends a try; a material chosen meanwhile in Settings stays.
  env.music.previewPack(SYNTHWAVE);
  env.window.MefiAppearance.apply({ preset: "focus" });
  env.music.applyTheme("forest");
  assert.equal(root.dataset.studioTheme, "forest");
  assert.equal(env.music.graphPreferences().nodeStyle, "glass");
  assert.equal(root.dataset.studioFont, "mono");
  assert.equal(env.window.MefiAppearance.get().preset, "focus");
  // Buying after a try: the pack goes on for real.
  env.music.previewPack(SAKURA);
  assert.equal(env.music.applyPack(SAKURA), true);
  assert.equal(env.music.endPreview(), false, "the try ended when the pack went on");
  assert.equal(env.music.packInfo().id, "studio:pack-sakura");
  assert.equal(musicSaves(env).at(-1).theme, "pack");
});

test("two-tone themes and packs paint under tier duo: the stylesheets answer duo, and no old tier name is left", async () => {
  for (const theme of ["void", "eclipse", "abyss", "dusk"]) assert.equal(environment({ saved: { theme } }).document.documentElement.dataset.studioThemeTier, "duo", theme);
  for (const theme of ["chrome", "aurora", ...LIGHT_THEMES]) assert.equal(environment({ saved: { theme } }).document.documentElement.dataset.studioThemeTier, "solo", theme);
  const css = Object.fromEntries(await Promise.all(["music.css", "styles.css", "studio-ui.css"].map(async (name) => [name, (await readFile(new URL(`../renderer/${name}`, import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "")])));
  for (const [name, text] of Object.entries(css)) {
    assert.doesNotMatch(text, /data-studio-theme-tier="?premium|music-theme-premium/, `${name} paints no tier that music.js never sets`);
    for (const tier of text.matchAll(/data-studio-theme-tier=["']?(\w+)/g)) assert.ok(["duo", "solo"].includes(tier[1]), `${name}: tier ${tier[1]}`);
  }
  // The two-tone primary outranks the shared one in studio-ui.css, at rest and under the pointer, and ends on the
  // second hue as a fill the ink reads on.
  assert.match(css["music.css"], /:root\[data-studio-theme\]\[data-studio-theme-tier="duo"\] :is\(\.primary:not\(#idle-hud \*, \.danger\), #workspace-layer \.primary, #idle-hud \.primary\) \{ background: linear-gradient\(120deg, var\(--gold-bright\), var\(--gold\) 52%, var\(--accent-2-fill, var\(--accent-2\)\)\); \}/);
  // Its three stops under the ink: bright, the accent and the fill, for the Void themes and the Studio packs alike.
  for (const [name, palette] of [...["void", "eclipse", "abyss", "dusk"].map((key) => [key, helpers.resolvePalette(key, {})]), ...[SAKURA, SYNTHWAVE, DEEP_SEA].map((pack) => [pack.name, helpers.resolvePalette("pack", {}, helpers.safePack(pack))])]) {
    for (const stop of ["bright", "actionEnd", "accent2Fill"]) assert.ok(helpers.contrast(palette.onAccent, palette[stop]) >= 4.5, `${name}: the ink on ${stop} at ${helpers.contrast(palette.onAccent, palette[stop]).toFixed(2)}`);
  }
  for (const key of ["void", "eclipse", "abyss", "dusk"]) assert.equal(helpers.resolvePalette(key, {}).accent2Fill, helpers.THEMES[key].accent2, `${key} keeps its own second hue`);
  assert.match(css["studio-ui.css"], /\.primary:not\(#idle-hud \*, \.danger\):not\(:disabled, \[aria-disabled=true\]\):is\(:hover, :focus-visible\),/, "the shared hover the two-tone fill must outrank");
  assert.match(css["music.css"], /\.music-theme-duo::before, \.void-swatch \{/);
  assert.match(css["styles.css"], /:root\[data-studio-theme-tier="duo"\] #workspace-layer \.ws-main \{/);
  assert.match(css["styles.css"], /:root\[data-studio-theme-tier="duo"\] :is\(\.community-invitation, #settings-community\) \{/);
  const env = environment();
  assert.ok(env.ids.get("music-void-themes").children.every((choice) => choice.className === "music-theme music-theme-duo"));
});

test("every theme has a sky on the Map, and the light ones draw theirs in ink", async () => {
  const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
  const table = idle.match(/const THEME_BACKDROP = (\{[\s\S]*?\});/);
  assert.ok(table, "idle.js has the theme-to-sky table");
  const skies = vm.runInNewContext(`(${table[1]})`);
  for (const key of [...Object.keys(helpers.THEMES), "custom"]) assert.ok(Object.hasOwn(skies, key), `${key} has a sky`);
  // Aurora ribbons and soft bokeh add light, which a pale sky cannot show.
  for (const key of LIGHT_THEMES) assert.ok(!["aurora", "bokeh", "fireflies"].includes(skies[key]), `${key}: ${skies[key]}`);
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
  // The card's one slider (0 to 100) is the master level for radio and local
  // music alike; it replaced the radio panel's own 0 to 1 slider.
  env.ids.get("music-volume").value = "40"; env.ids.get("music-volume").dispatch("input");
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
const VOID_THEMES = ["void", "eclipse", "abyss", "dusk"];
const VOID_STYLES = ["singularity", "prism", "sigil"];
const musicWrites = (env) => env.writes.filter(([key]) => key === "mefiStudio.music.v1").map(([, value]) => JSON.parse(value));

test("The Void collection is free: its themes and styles apply and save like any other", () => {
  const env = environment({ saved: { theme: "forest", nodeStyle: "glass" } });
  assert.deepEqual(env.ids.get("music-void-themes").children.map((choice) => choice.dataset.theme), VOID_THEMES);
  assert.deepEqual(env.ids.get("music-void-styles").children.map((choice) => choice.dataset.nodeStyle), VOID_STYLES);
  assert.deepEqual(env.ids.get("music-node-styles").children.map((choice) => choice.dataset.nodeStyle), ["orbs", "glass", "minimal", "halo", "crystal"], "the other styles keep their own group");
  env.ids.get("music-theme-void").click();
  assert.equal(env.music.status().theme, "void");
  assert.equal(env.music.themePalette().theme, "void");
  assert.equal(env.ids.get("music-theme-void").attrs["aria-pressed"], "true");
  assert.equal(musicWrites(env).at(-1).theme, "void", "a Void theme saves with the other preferences");
  env.ids.get("music-node-style-prism").click();
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  assert.equal(env.ids.get("music-node-style-prism").attrs["aria-pressed"], "true");
  assert.equal(env.ids.get("music-node-style-glass").attrs["aria-pressed"], "false");
  assert.equal(musicWrites(env).at(-1).nodeStyle, "prism");
  for (const theme of VOID_THEMES) assert.equal(helpers.safePreferences({ theme }).theme, theme, theme);
  for (const nodeStyle of VOID_STYLES) assert.equal(helpers.safePreferences({ nodeStyle }).nodeStyle, nodeStyle, nodeStyle);
});

test("A Void choice saved apart while the collection was for members moves into the preferences", () => {
  const env = environment({ saved: { theme: "forest", nodeStyle: "glass" }, premiumSaved: { theme: "abyss", nodeStyle: "sigil" } });
  assert.equal(env.music.status().theme, "abyss");
  assert.equal(env.music.graphPreferences().nodeStyle, "sigil");
  assert.equal(env.storage.get("mefiStudio.music.premium.v1") ?? null, null, "the old store is cleared");
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
  assert.equal(after("music-node-styles"), env.ids.get("music-void-style-label"), "the Void styles sit right under the others");
  assert.equal(env.ids.get("music-node-layouts").parentElement.dataset.appearancePanel, "layout", "arrangements have their own section");
  const dropdown = env.ids.get("music-dropdown");
  for (const id of ["music-sound", "music-audio-source", "music-audio-toggle", "music-audio-response", "music-recommend", "music-link-url", "music-files"]) {
    assert.equal(dropdown.contains(env.ids.get(id)), true, id);
    assert.equal(sheet.contains(env.ids.get(id)), false, id);
  }
  assert.equal(dropdown.hidden, true);
  // The mini player moved the source tabs out of the card and up into the
  // menu's header (Music, Radio, Video), ahead of the card; the card starts
  // with the video stage.
  const header = env.ids.get("music-dropdown-heading").parentElement, tabs = env.ids.get("music-local-tab").parentElement;
  assert.equal(tabs.parentElement, header, "the source tabs sit in the menu's header");
  assert.equal(header.parentElement, dropdown);
  assert.deepEqual(tabs.children.map((tab) => tab.id), ["music-local-tab", "music-radio-tab", "music-link-tab"]);
  assert.equal(sound.contains(tabs), false, "the card no longer carries the source tabs");
  assert.equal(sound.parentElement.parentElement, dropdown, "the card is the body's first part, under the header");
  env.music.open(); env.frames();
  assert.equal(dropdown.hidden, true, "Appearance never opens the media menu");
});

test("The audio dropdown stays beneath its opener, dismisses without stopping playback and restores keyboard focus", async () => {
  const env = environment();
  const anchor = env.document.createElement("button");
  anchor.id = "shell-player";
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

test("Hover opens current media without taking focus and lets the pointer cross into the dropdown", async () => {
  const env = environment();
  const anchor = env.ids.get("settings-audio-open"), dropdown = env.ids.get("music-dropdown");
  const editor = env.document.createElement("textarea"); editor.focus();
  env.music.addFiles([file("Hover.mp3")]); env.ids.get("music-play").click(); await flush();
  env.audio.currentTime = 32;
  anchor.dispatch("pointerenter", { pointerType: "mouse" }); env.advance(100);
  assert.equal(dropdown.hidden, true, "passing over the button is not enough");
  anchor.dispatch("pointerleave"); env.advance(500);
  assert.equal(dropdown.hidden, true);
  anchor.dispatch("pointerenter", { pointerType: "mouse" }); env.advance(200);
  assert.equal(dropdown.hidden, false);
  assert.equal(env.document.activeElement, editor, "hover must not interrupt typing");
  assert.equal(env.ids.get("music-local-panel").hidden, false);
  anchor.dispatch("pointerleave"); env.advance(300);
  dropdown.dispatch("pointerenter"); env.advance(1000);
  assert.equal(dropdown.hidden, false, "the gap between button and menu is safe to cross");
  dropdown.dispatch("pointerleave"); env.advance(450);
  assert.equal(dropdown.hidden, true);
  assert.equal(anchor.attrs["aria-expanded"], "false");
  assert.equal(env.document.activeElement, editor);
  assert.equal(env.audio.paused, false);
  assert.equal(env.audio.currentTime, 32);
});

test("Clicking a hovered opener or using a setting holds the menu open for adjustments", () => {
  for (const interaction of ["click", "pointerdown", "focusin"]) {
    const env = environment({ saved: { source: "radio", station: "groovesalad" } });
    const anchor = env.ids.get("settings-audio-open"), dropdown = env.ids.get("music-dropdown");
    anchor.dispatch("pointerenter", { pointerType: "mouse" }); env.advance(200);
    assert.equal(env.ids.get("music-radio-panel").hidden, false);
    assert.equal(dropdown.dataset.source, "radio", "the card shows the saved source");
    // The volume slider is the setting being adjusted (it is the card's, for every source).
    if (interaction === "click") env.music.toggleAudio(anchor);
    else dropdown.dispatch(interaction, { target: env.ids.get("music-volume") });
    anchor.dispatch("pointerleave"); dropdown.dispatch("pointerleave"); env.advance(1000);
    assert.equal(dropdown.hidden, false, interaction);
    dropdown.dispatch("keydown", { key: "Escape" });
    assert.equal(dropdown.hidden, true);
    assert.equal(env.document.activeElement, anchor);
  }
});

test("Opening video controls on hover keeps the video visible and entering its frame holds the menu open", () => {
  const env = environment({ mediaWindow: true });
  env.music.playLink("https://youtu.be/dQw4w9WgXcQ");
  const anchor = env.ids.get("settings-audio-open"), dropdown = env.ids.get("music-dropdown");
  const stage = env.ids.get("music-video-stage"), card = env.ids.get("music-sound"), body = card.parentElement;
  // The menu was last left scrolled; every visit starts at the top of the card.
  body.scrollTop = 300; card.scrollTop = 200;
  anchor.dispatch("pointerenter", { pointerType: "mouse" }); env.advance(200);
  assert.equal(dropdown.hidden, false);
  // The old menu scrolled 142 px to bring the video into view. The mini player
  // holds the video in the card's own stage, at the top, so nothing scrolls.
  assert.equal(body.scrollTop, 0); assert.equal(card.scrollTop, 0);
  assert.equal(dropdown.scrollTop, undefined, "the menu itself is not a scroller any more");
  assert.equal(stage.hidden, false, "the stage shows the loaded video");
  assert.equal(stage.dataset.docked, "true"); assert.equal(env.player.host, stage, "the player window is carried into the stage");
  assert.equal(env.player.docked, true);
  const frame = env.music.linkElement().element;
  dropdown.dispatch("pointerleave");
  frame.parentElement.dispatch("pointerenter");
  frame.parentElement.dispatch("pointerleave"); env.advance(1000);
  assert.equal(dropdown.hidden, false, "cross-origin playback controls cannot dismiss their own menu");
  assert.equal(env.music.linkElement().element, frame);
});

test("The floating toolbar belongs to the media panel and Float player keeps the loaded frame", () => {
  const env = environment();
  env.music.playLink("https://youtu.be/dQw4w9WgXcQ");
  env.music.openAudio();
  const dropdown = env.ids.get("music-dropdown"), frame = env.music.linkElement().element;
  const surface = env.document.createElement("section"); surface.id = "media-window";
  const control = env.document.createElement("button"); surface.append(control);
  dropdown.dispatch("focusout", { relatedTarget: control }); env.pointer(control);
  assert.equal(dropdown.hidden, false, "moving or closing the player is an inside interaction");
  env.ids.get("music-video-float").click();
  assert.equal(dropdown.hidden, true);
  assert.equal(env.music.linkElement().element, frame, "floating does not reload or restart playback");
});

test("Hover respects touch, dismissal, navigation, window blur and Zen", () => {
  const env = environment();
  const anchor = env.ids.get("settings-audio-open"), dropdown = env.ids.get("music-dropdown");
  anchor.dispatch("pointerenter", { pointerType: "touch" }); env.advance(500);
  assert.equal(dropdown.hidden, true);
  const editor = env.document.createElement("textarea"); editor.focus();
  anchor.dispatch("pointerenter", { pointerType: "mouse" }); env.advance(200);
  dropdown.dispatch("keydown", { key: "Escape" }); env.advance(1000);
  assert.equal(dropdown.hidden, true);
  assert.equal(env.document.activeElement, editor, "Escape from an untouched hover keeps typing focus");
  for (const dismiss of [() => env.music.closeAudio(), () => env.emit("mefi:nav", { id: "workspace", action: "open" }), () => env.emit("blur")]) {
    anchor.dispatch("pointerleave"); anchor.dispatch("pointerenter", { pointerType: "mouse" });
    dismiss(); env.advance(1000);
    assert.equal(dropdown.hidden, true, "dismissal cancels pending hover opening");
  }
  anchor.dispatch("pointerenter", { pointerType: "mouse" });
  env.document.body.classList.add("command-zen"); env.advance(1000);
  assert.equal(dropdown.hidden, true);
  env.music.openAudio(anchor);
  assert.equal(dropdown.hidden, true, "explicit opens also respect Zen");
  env.document.body.classList.remove("command-zen");
  env.music.toggleAudio(anchor);
  assert.equal(dropdown.hidden, false, "click remains available after Zen");
});

test("Copied media links offer play or queue actions without autoplay and do not nag after dismissal", async () => {
  let clipboard = "https://youtu.be/dQw4w9WgXcQ", reads = 0;
  const env = environment({ bridge: { mediaClipboardLink: async () => { reads++; return { ok: true, url: clipboard }; } } });
  const offer = env.ids.get("music-clipboard-offer");
  assert.equal(reads, 0, "the clipboard is not read at startup");
  env.music.openAudio(); await flush();
  assert.equal(offer.hidden, false);
  assert.equal(env.music.status().source, "local", "an offer cannot change playback");
  env.ids.get("music-clipboard-queue").click();
  assert.equal(offer.hidden, true);
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1"))[0].url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  clipboard = "https://vimeo.com/12345678"; env.advance(2000); await flush();
  env.ids.get("music-clipboard-next").click();
  assert.match(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1"))[0].url, /vimeo/);
  clipboard = "https://example.com/new.mp4"; env.advance(2000); await flush();
  env.ids.get("music-clipboard-dismiss").click(); env.advance(4000); await flush();
  assert.equal(offer.hidden, true, "an unchanged dismissed link stays dismissed");
  clipboard = "https://example.com/another.mp4"; env.advance(2000); await flush();
  env.ids.get("music-clipboard-play").click();
  assert.equal(env.music.status().source, "link");
  assert.equal(env.music.linkElement().url, clipboard);
  assert.equal(offer.hidden, true);
  env.music.closeAudio(); const before = reads; env.advance(10000); await flush();
  assert.equal(reads, before, "closed menus stop clipboard polling");
});

test("Copied-link detection respects its saved toggle, focus, invalid links and late clipboard responses", async () => {
  let resolve, reads = 0, clipboard = "https://example.com/movie.mp4";
  const env = environment({ menuSaved: { copiedLinks: false }, bridge: { mediaClipboardLink: () => { reads++; return new Promise(done => { resolve = done; }); } } });
  env.music.openAudio(); await flush(); assert.equal(reads, 0);
  const toggle = env.ids.get("music-copied-links"); toggle.checked = true; toggle.dispatch("change");
  assert.equal(reads, 1);
  env.music.closeAudio(); resolve({ ok: true, url: clipboard }); await flush();
  assert.equal(env.ids.get("music-clipboard-offer").hidden, true, "late reads cannot reopen a dismissed menu");
  env.window.mefiStudio.mediaClipboardLink = async () => { reads++; return { ok: true, url: clipboard }; };
  env.document.hasFocus = () => false; env.music.openAudio(); await flush();
  assert.equal(reads, 1);
  env.document.hasFocus = () => true;
  for (clipboard of ["not a link", "javascript:alert(1)", "https://example.com/article", "https://user:pass@example.com/video.mp4"]) {
    env.advance(2000); await flush(); assert.equal(env.ids.get("music-clipboard-offer").hidden, true);
  }
  clipboard = "https://example.com/movie.mp4"; env.advance(2000); await flush();
  assert.equal(env.ids.get("music-clipboard-offer").hidden, false);
  toggle.checked = false; toggle.dispatch("change"); const before = reads; env.advance(4000); await flush();
  assert.equal(reads, before); assert.equal(env.ids.get("music-clipboard-offer").hidden, true);
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaMenu.v1")).copiedLinks, false);
});

test("Show links masks pasted URLs and hides queue and clipboard URLs without changing playback, and survives reload", async () => {
  const env = environment({ queueSaved: [{ url: "https://example.com/queued.mp4", title: "Queued video" }], bridge: { mediaClipboardLink: async () => ({ ok: true, url: "https://vimeo.com/12345678" }) } });
  env.music.playLink("https://youtu.be/dQw4w9WgXcQ"); const player = env.music.linkElement().element;
  env.music.openAudio(); await flush();
  const input = env.ids.get("music-link-url"), show = env.ids.get("music-show-links");
  input.value = "https://example.com/pasted.mp4";
  show.click();
  assert.equal(show.attrs["aria-pressed"], "false"); assert.equal(input.type, "password");
  assert.equal(env.ids.get("music-link-queue-list").children[0].children[0].children[1].hidden, true);
  assert.equal(env.ids.get("music-clipboard-offer").children[1].hidden, true);
  assert.equal(env.music.linkElement().element, player);
  const restored = environment({ menuSaved: JSON.parse(env.storage.get("mefiStudio.mediaMenu.v1")) });
  assert.equal(restored.ids.get("music-link-url").type, "password");
  show.click();
  assert.equal(input.type, "text"); assert.equal(input.value, "https://example.com/pasted.mp4");
  assert.equal(env.ids.get("music-link-queue-list").children[0].children[0].children[1].hidden, false);
  assert.equal(env.ids.get("music-clipboard-offer").children[1].hidden, false);
});

test("Audio setting option menus keep their owner open and consume Escape before the media dropdown", () => {
  const env = environment();
  const dropdown = env.ids.get("music-dropdown"), option = env.document.createElement("button");
  let expanded = true;
  env.window.MefiSelect = { owns: owner => expanded && owner === dropdown, contains: target => expanded && target === option, close: () => { expanded = false; } };
  env.music.openAudio();
  dropdown.dispatch("focusout", { relatedTarget: option }); env.pointer(option);
  assert.equal(dropdown.hidden, false, "the portaled source selector belongs to this menu");
  dropdown.dispatch("keydown", { key: "Escape" });
  assert.equal(expanded, false);
  assert.equal(dropdown.hidden, false);
  dropdown.dispatch("keydown", { key: "Escape" });
  assert.equal(dropdown.hidden, true);
  env.music.openAudio(); expanded = true;
  env.music.closeAudio();
  assert.equal(expanded, false, "closing the parent cannot leave an orphan settings popup");
});

test("MefiMusic exports what other modules read: isNodeStyle for the tree painters and the Void catalog", () => {
  const env = environment();
  for (const name of ["isPremiumTheme", "isPremiumNodeStyle", "premiumAllowed", "premiumChoice"]) assert.equal(env.music[name], undefined, name);
  assert.equal(env.music.isNodeStyle("prism"), true);
  assert.equal(env.music.isNodeStyle("orbs"), true);
  assert.equal(env.music.isNodeStyle("__proto__"), false);
  const catalog = env.music.premiumCatalog();
  assert.deepEqual([...catalog.themes.map((theme) => theme.key)], VOID_THEMES);
  assert.deepEqual([...catalog.nodeStyles.map((style) => style.key)], VOID_STYLES);
  assert.ok(catalog.themes.every((theme) => /^#[0-9a-f]{6}$/i.test(theme.accent) && /^#[0-9a-f]{6}$/i.test(theme.accent2)), "both hues of every two-tone swatch");
  assert.match(source.slice(0, 400), /^\/\/ Style & sound: Studio's color themes, node styles and layouts \(the two-tone\r?\n\/\/ Void collection among them, free like the rest\)/);
});

// The two node styles the Shop sells (renderer/node-styles.js paints them; relay/src/shop.mjs sells them).
const SHOP_STYLES = { dragonscale: "studio:style-dragonscale", constellation: "studio:style-constellation" };
const treeEvents = (env) => env.events.filter((event) => event.type === "mefi-tree-preferences");

test("the Shop's node styles are listed in Settings, said to be in the Shop and off until owned; every other style stays free", () => {
  const env = environment({ shop: new Set() });
  const group = env.ids.get("music-shop-styles");
  assert.equal(env.ids.get("music-shop-style-label").text, "From the Shop");
  assert.deepEqual(group.children.map((choice) => choice.dataset.nodeStyle), ["dragonscale", "constellation"]);
  assert.deepEqual(group.children.map((choice) => [choice.disabled, choice.children[1].text]), [[true, "Dragon scales (in the Shop)"], [true, "Constellation (in the Shop)"]]);
  assert.deepEqual(env.ids.get("music-node-styles").children.map((choice) => choice.dataset.nodeStyle), ["orbs", "glass", "minimal", "halo", "crystal"], "the free styles keep their own group");
  assert.ok([...env.ids.get("music-node-styles").children, ...env.ids.get("music-void-styles").children].every((choice) => !choice.disabled), "every other style stays free to choose");
  assert.equal(env.ids.get("music-shop-line").hidden, false, "a way to the Shop while one is still there to get");
  env.ids.get("music-shop-open").click();
  assert.deepEqual(env.opened.at(-1), "shop:studio");
  // A disabled choice does nothing; asked for in code, an unowned style is refused and nothing changes.
  env.ids.get("music-node-style-dragonscale").click();
  const before = treeEvents(env).length, saves = musicWrites(env).length;
  assert.equal(env.music.applyNodeStyle("dragonscale"), "orbs", "refused: the style still worn comes back");
  assert.equal(env.music.graphPreferences().nodeStyle, "orbs");
  assert.equal(treeEvents(env).length, before, "the tree is not told anything");
  assert.equal(musicWrites(env).length, saves, "nothing is saved");
  assert.deepEqual([...env.music.nodeStyles().map((style) => style.key)], ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"], "the setup helper is offered only what this PC can wear");
  assert.deepEqual(JSON.parse(JSON.stringify(env.music.shopStyles())), [
    { key: "dragonscale", item: "studio:style-dragonscale", name: "Dragon scales", detail: "Scaled gems with ember sparks", owned: false },
    { key: "constellation", item: "studio:style-constellation", name: "Constellation", detail: "Stars on star-chart lines", owned: false },
  ]);
  assert.equal(env.music.isNodeStyle("dragonscale"), true, "the tree painters know both");
  // A style pack never carries a Shop style (the relay's pack check allows the free ones only).
  assert.equal(helpers.safePack({ palette: SYNTHWAVE.palette, nodeStyle: "dragonscale" }), null);
  assert.equal(helpers.safePack({ palette: SYNTHWAVE.palette, nodeStyle: "sigil" }).nodeStyle, "sigil");
});

test("an owned Shop style is chosen and saved like any other, and the Shop hearing of one later puts it on", () => {
  const owned = new Set([SHOP_STYLES.constellation]);
  const env = environment({ shop: owned });
  assert.deepEqual(env.ids.get("music-shop-styles").children.map((choice) => [choice.disabled, choice.children[1].text]), [[true, "Dragon scales (in the Shop)"], [false, "Constellation"]]);
  env.ids.get("music-node-style-constellation").click();
  assert.equal(env.music.graphPreferences().nodeStyle, "constellation");
  assert.equal(env.music.nodeStyle(), "constellation");
  assert.equal(env.ids.get("music-node-style-constellation").attrs["aria-pressed"], "true");
  assert.equal(musicWrites(env).at(-1).nodeStyle, "constellation");
  assert.equal(treeEvents(env).at(-1).detail.nodeStyle, "constellation");
  assert.deepEqual([...env.music.nodeStyles().map((style) => style.key).slice(-1)], ["constellation"], "an owned one is offered everywhere");
  // Bought later (friends-shop.js fires mefi-shop-owned): the pickers follow at once.
  owned.add(SHOP_STYLES.dragonscale);
  env.emit("mefi-shop-owned", { ids: [...owned] });
  assert.equal(env.ids.get("music-node-style-dragonscale").disabled, false);
  assert.equal(env.ids.get("music-node-style-dragonscale").children[1].text, "Dragon scales");
  assert.equal(env.ids.get("music-shop-line").hidden, true, "nothing left to get");
  assert.equal(env.music.applyNodeStyle("dragonscale"), "dragonscale");
  // No longer owned (the Shop says so): Classic orbs, quietly, and the choice stays saved for when it comes back.
  owned.clear();
  env.emit("mefi-shop-owned", { ids: [] });
  assert.equal(env.music.graphPreferences().nodeStyle, "orbs");
  assert.equal(JSON.parse(env.storage.get("mefiStudio.music.v1")).nodeStyle, "dragonscale");
  owned.add(SHOP_STYLES.dragonscale);
  env.emit("mefi-shop-owned", { ids: [...owned] });
  assert.equal(env.music.graphPreferences().nodeStyle, "dragonscale");
});

test("a saved Shop style this PC does not own falls back to Classic orbs at boot, quietly, and comes back once it is owned", () => {
  const saved = { theme: "forest", nodeStyle: "dragonscale" };
  const lost = environment({ saved, shop: new Set() });
  assert.equal(lost.music.graphPreferences().nodeStyle, "orbs");
  assert.equal(lost.document.documentElement.dataset.nodeStyle, "orbs");
  assert.equal(lost.ids.get("music-node-style-orbs").attrs["aria-pressed"], "true");
  assert.equal(lost.toasts.length, 0, "quietly");
  assert.equal(treeEvents(lost).length, 1, "the tree hears orbs once, at boot");
  assert.equal(treeEvents(lost)[0].detail.nodeStyle, "orbs");
  assert.equal(lost.storage.get("mefiStudio.music.v1"), JSON.stringify(saved), "the choice stays as it was saved");
  // No Shop in this build at all: the same.
  assert.equal(environment({ saved }).music.graphPreferences().nodeStyle, "orbs");
  const kept = environment({ saved, shop: new Set([SHOP_STYLES.dragonscale]) });
  assert.equal(kept.music.graphPreferences().nodeStyle, "dragonscale", "an owned style comes back with the rest");
  const restored = environment({ saved, shop: new Set() });
  restored.emit("mefi-shop-owned", { ids: [] });
  assert.equal(restored.music.graphPreferences().nodeStyle, "orbs");
});

test("previewNodeStyle shows a Shop style on the tree for the Shop's Try, saves nothing, and endPreview or a real choice ends it", () => {
  const env = environment({ saved: { theme: "midnight", nodeStyle: "glass" }, shop: new Set() });
  const stored = env.storage.get("mefiStudio.music.v1");
  const palette = env.music.themePalette();
  assert.equal(env.music.previewNodeStyle("nope"), false);
  assert.equal(env.music.previewNodeStyle("dragonscale"), true, "a style not owned may be tried");
  assert.equal(env.music.graphPreferences().nodeStyle, "dragonscale");
  assert.equal(treeEvents(env).at(-1).detail.nodeStyle, "dragonscale", "the tree shows it");
  assert.equal(env.document.documentElement.dataset.nodeStyle, "dragonscale");
  assert.equal(env.music.nodeStyle(), "glass", "the style worn is still Glass");
  assert.equal(env.music.themePalette(), palette, "a style's try leaves the colours alone");
  assert.equal(env.music.status().theme, "midnight");
  assert.equal(env.music.previewNodeStyle("constellation"), true, "one try at a time: the next replaces it");
  assert.equal(env.music.graphPreferences().nodeStyle, "constellation");
  assert.equal(env.music.endPreview(), true);
  assert.equal(env.music.graphPreferences().nodeStyle, "glass");
  assert.equal(treeEvents(env).at(-1).detail.nodeStyle, "glass");
  assert.equal(env.music.endPreview(), false, "nothing left to end");
  assert.equal(env.storage.get("mefiStudio.music.v1"), stored, "a try writes nothing");
  // A pack's try and a style's try take turns.
  env.music.previewNodeStyle("constellation");
  assert.equal(env.music.previewPack(SYNTHWAVE), true);
  assert.equal(env.music.graphPreferences().nodeStyle, "halo", "the pack's own style");
  assert.equal(env.music.themePalette().theme, "pack");
  assert.equal(env.music.previewNodeStyle("dragonscale"), true);
  assert.equal(env.music.themePalette().theme, "midnight", "the pack's try ended first");
  assert.equal(env.music.graphPreferences().nodeStyle, "dragonscale");
  // Choosing for real ends the try (a refused choice does not).
  assert.equal(env.music.applyNodeStyle("constellation"), "glass");
  assert.equal(env.music.graphPreferences().nodeStyle, "dragonscale", "a refused choice leaves the try on");
  env.music.applyNodeStyle("minimal");
  assert.equal(env.music.graphPreferences().nodeStyle, "minimal");
  assert.equal(env.music.endPreview(), false);
});

test("Settings shows the Shop's styles with their own thumbnails, which move only when motion is allowed", async () => {
  const css = await readFile(new URL("../renderer/music.css", import.meta.url), "utf8");
  for (const key of Object.keys(SHOP_STYLES)) {
    assert.ok(css.includes(`/* node style: ${key} */`), `${key}: a carved block of its own`);
    assert.ok(css.includes(`.music-preview-${key} i:first-child`), `${key}: its own gem`);
  }
  // The Constellation layout's tile carries the same class as the style's: every rule for it names its tile.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]*\.music-preview-constellation[^{}]*(?=\{)/g) ?? [];
  assert.ok(rules.length >= 10, "the style's and the layout's rules");
  for (const part of rules.flatMap((selector) => selector.split(",")).filter((part) => part.includes(".music-preview-constellation"))) {
    assert.match(part.trim(), /^\.music-node-(style|layout)[[ ]/, `${part.trim()} names the tile it is for`);
  }
  assert.match(css, /\.music-node-choice:disabled \{[^}]*cursor: default/, "a style still in the Shop looks off");
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

test("Void selections in Settings stay on the canvas and are saved", () => {
  const env = environment({ preview: true, saved: { theme: "forest", nodeStyle: "glass" } });
  env.document.getElementById = (id) => env.ids.get(id) ?? null;
  const hosts = { look: env.document.createElement("section"), sound: env.document.createElement("section"), effects: env.document.createElement("section") };
  env.music.mountSettings(hosts);
  env.ids.get("music-theme-abyss").click();
  env.ids.get("music-node-style-prism").click();
  env.ids.get("settings-canvas-preview").click();
  assert.equal(env.music.status().theme, "abyss", "opening the canvas keeps the chosen look visible");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  env.music.close();
  assert.equal(env.music.status().theme, "abyss", "closing keeps it too");
  assert.equal(env.music.graphPreferences().nodeStyle, "prism");
  assert.equal(musicWrites(env).at(-1).theme, "abyss");
  assert.equal(musicWrites(env).at(-1).nodeStyle, "prism");
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

test("Media side controls remain usable while the Appearance preview menu is open", () => {
  const env = environment({ preview: true, previewRegistered: true });
  env.music.openPreview();
  const control = env.document.createElement("button");
  control.closest = selector => selector === "#media-window" ? control : null;
  for (const type of ["pointerdown", "pointerup", "click"]) {
    assert.equal(env.gesture(type, control).stopped, false);
  }
  assert.equal(env.ids.get("music-overlay").hidden, false);
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
  // Play is the card's transport for every source now, so it belongs to no
  // source panel; the local panel's own control is Add audio files.
  env.music.revealSettingsTarget(env.ids.get("music-add-files"));
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
  // The radio panel keeps its state line and stop button; its volume moved to the card.
  env.music.revealSettingsTarget(env.ids.get("music-radio-state"));
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
  for (const url of [`http://www.youtube.com/watch?v=${YT}`, `https://www.youtube.com:444/watch?v=${YT}`, "https://example.com/#listen", "example.com/radio"]) assert.equal(helpers.mediaLink(url).kind, "external");
  assert.equal(helpers.mediaLink("https://example.com/#listen").url, "https://example.com/#listen");
  for (const bad of ["", "not a link", `https://user@youtube.com/watch?v=${YT}`,
    "https://www.youtube.com/watch?v=short", "javascript:alert(1)", "data:audio/mp3;base64,AAAA", "file:///C:/music/song.mp3", "blob:private", `https://youtu.be/${YT}/extra`, `https://x.test/${"a".repeat(8200)}.mp3`]) {
    assert.equal(helpers.mediaLink(bad), null, bad);
  }
});

test("Web links open the mini browser and stop Studio audio only after a successful handoff", async () => {
  const requests = []; let resolve;
  const env = environment({ bridge: { mediaBrowserOpen: url => { requests.push(url); return new Promise(done => { resolve = done; }); } } });
  await env.music.tune("groovesalad"); await flush();
  assert.equal(env.music.status().playing, true);
  assert.equal(env.music.playLink("https://example.com/live#player"), true);
  assert.deepEqual(requests, ["https://example.com/live#player"]);
  assert.equal(env.music.status().playing, true);
  resolve({ ok: false, error: "Unavailable" }); await flush();
  assert.equal(env.music.status().playing, true);
  assert.match(noticeOf(env).textContent, /Unavailable/);
  env.ids.get("music-link-handoff-browser").click(); resolve({ ok: true }); await flush();
  assert.equal(env.music.status().playing, false);
});

test("Opening the built-in browser replaces music; browsing an embed stops its old frame", async () => {
  const requests = [];
  const env = environment({ bridge: { mediaBrowserOpen: async url => { requests.push(url); return { ok: true }; } } });
  await env.music.tune("groovesalad"); await flush();
  env.ids.get("music-browser-launch").click(); await flush();
  assert.equal(env.music.status().playing, false); assert.deepEqual(requests, [""]);
  env.music.playLink(`https://youtu.be/${YT}`); assert.equal(linkFrames(env).length, 1);
  env.ids.get("music-link-popout").click(); await flush();
  assert.equal(linkFrames(env).length, 0); assert.equal(env.music.status().playing, false);
  assert.equal(requests[1], `https://www.youtube.com/watch?v=${YT}`);
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
  assert.equal(noticeOf(env).dataset.error, "false", "ordinary pages offer the browser without claiming a playback failure");
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

// ---- The node-style picker thumbnails (renderer/music.css .music-preview-*) ----
// Every thumbnail animation sits in a rule inside
// @media (prefers-reduced-motion: no-preference), so the html[data-motion]
// rules and reduced motion leave the designed still pose; its period scales
// with --node-tempo (the chosen tile plays at working tempo); and the
// music-node-* keyframes only move, turn, scale or fade.
test("the node-style thumbnails animate only when motion is allowed, at the node tempo, and only move or fade", async () => {
  const css = await readFile(new URL("../renderer/music.css", import.meta.url), "utf8");
  const start = css.indexOf("/* node style: orbs */");
  const last = css.lastIndexOf("@keyframes music-node-");
  assert.ok(start >= 0 && last > start, "the carved thumbnail blocks and their keyframes");
  const carve = css.slice(start, css.indexOf("\n", last)).replace(/\/\*[\s\S]*?\*\//g, "");
  // Walk the braces: an animation must sit in a rule inside
  // @media (prefers-reduced-motion: no-preference), never at the top level.
  const animations = [];
  const keyframes = new Map();
  let depth = 0;
  let media = null;
  let prelude = "";
  for (let i = 0; i < carve.length; i += 1) {
    const ch = carve[i];
    if (ch === "{") {
      const head = prelude.trim();
      if (depth === 0 && head.startsWith("@keyframes ")) {
        const close = carve.indexOf("} }", i);
        keyframes.set(head.slice(11).trim(), carve.slice(i + 1, close + 1));
        i = close + 2;
        prelude = "";
        continue;
      }
      if (depth === 0 && head.startsWith("@media")) media = head;
      depth += 1;
      prelude = "";
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) media = null;
      prelude = "";
    } else if (ch === ";" && depth > 0) {
      const declaration = prelude.trim();
      if (/^animation\s*:/.test(declaration)) animations.push({ value: declaration.replace(/^animation\s*:\s*/, ""), media, depth });
      prelude = "";
    } else {
      prelude += ch;
    }
  }
  assert.equal(depth, 0, "balanced braces");
  assert.ok(animations.length >= 30, `the thumbnails animate (${animations.length} declarations)`);
  for (const { value, media: where, depth: level } of animations) {
    assert.equal(where, "@media (prefers-reduced-motion: no-preference)", `${value} runs only when motion is allowed`);
    assert.equal(level, 2, `${value} sits in a rule inside the motion block`);
    assert.match(value, /^music-node-[a-z-]+ calc\([\d.]+s \* var\(--node-tempo\)\) /, `${value} lasts its period times --node-tempo`);
  }
  assert.ok(keyframes.size >= 10, "the thumbnails' own keyframes");
  const used = new Set(animations.map(({ value }) => value.split(" ")[0]));
  for (const [name, body] of keyframes) {
    assert.match(name, /^music-node-[a-z-]+$/);
    assert.ok(used.has(name), `${name} is used by a thumbnail`);
    const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    assert.ok(properties.length > 0, `${name} sets something`);
    for (const property of properties) assert.ok(["rotate", "scale", "translate", "opacity"].includes(property), `${name} only moves or fades (${property})`);
  }
  for (const name of used) assert.ok(keyframes.has(name), `${name} is defined next to the thumbnails`);
});


test("video queue adds without interrupting playback, reorders, removes and survives reload without autoplay", async () => {
  const env = environment(); env.music.playLink(`https://youtu.be/${YT}`);
  const current = env.music.linkElement().element;
  const add = (url, next = false) => { env.ids.get("music-link-url").value = url; env.ids.get(next ? "music-link-queue-first" : "music-link-queue-add").click(); };
  add("https://vimeo.com/12345678"); add("https://example.com/second.mp4"); add("https://example.com/first.mp4", true);
  assert.equal(env.ids.get("music-link-url").value, "", "a queued link leaves the box empty and ready for the next one");
  assert.equal(env.music.linkElement().element, current);
  const list = env.ids.get("music-link-queue-list"); assert.equal(list.children.length, 3);
  list.children[2].children[1].children[1].click();
  let queue = JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1")); assert.equal(queue[0].url, "https://example.com/second.mp4");
  list.children[1].children[1].children[2].click();
  queue = JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1")); assert.equal(queue.length, 2); assert.match(queue[1].url, /vimeo/);
  assert.equal(env.music.linkElement().element, current);
  const restored = environment({ queueSaved: queue }); await flush();
  assert.equal(restored.music.linkElement(), null); assert.equal(restored.ids.get("music-link-queue-list").children.length, 2);
  restored.ids.get("music-link-queue-next").click();
  assert.equal(restored.music.linkElement().url, queue[0].url); assert.equal(restored.ids.get("music-link-queue-list").children.length, 1);
  // Next is the card's one transport button now; with a queue it plays the queue.
  restored.ids.get("music-next").click(); assert.equal(restored.music.linkElement().url, queue[1].url);
  assert.equal(restored.ids.get("music-link-queue-next").disabled, true);
});

test("queued end events advance once, ignore stale or foreign frames and restart repeated URLs", () => {
  const urls = [`https://www.youtube.com/watch?v=${YT}`, "https://vimeo.com/12345678", "https://example.com/movie.mp4"];
  const env = environment({ queueSaved: urls.map(url => ({ url, title: "Queued video" })) });
  env.music.playLink(urls[0]); const first = env.music.linkElement().element;
  const yt = (value, overrides = {}) => env.message({ source: first.contentWindow, origin: "https://www.youtube-nocookie.com", data: { event: "onStateChange", info: value }, ...overrides });
  yt(0); assert.equal(env.ids.get("music-link-queue-list").children.length, 3, "unstarted metadata must not skip the queue");
  yt(1); yt(0, { origin: "https://evil.test" }); assert.equal(env.music.linkElement().element, first);
  yt(0); const repeated = env.music.linkElement().element;
  assert.notEqual(repeated, first); assert.equal(env.music.linkElement().url, urls[0]);
  yt(0); assert.equal(env.ids.get("music-link-queue-list").children.length, 2, "late old-frame end cannot consume another item");
  env.ids.get("music-next").click(); const vimeo = env.music.linkElement().element;
  const vm = event => env.message({ source: vimeo.contentWindow, origin: "https://player.vimeo.com", data: { event, data: { seconds: 9 } } });
  vm("play"); vm("ended"); assert.equal(env.music.linkElement().url, urls[2]);
  assert.equal(env.ids.get("music-link-queue-list").children.length, 0);
  env.ids.get("music-link-url").value = urls[0]; env.ids.get("music-link-queue-add").click();
  const native = env.music.linkElement().element; native.ended = true; native.dispatch("ended");
  assert.equal(env.music.linkElement().url, urls[0]); native.dispatch("ended"); assert.equal(env.ids.get("music-link-queue-list").children.length, 0);
});

test("queue validates persisted entries, bounds storage and keeps manual queue ahead of explorer results", async () => {
  const env = environment({ queueSaved: [{ url: "javascript:alert(1)" }, { url: "https://www.twitch.tv/example" }, { url: "https://example.com/queued.mp4", title: "Queued" }], bridge: { youtubeSearch: async () => ({ ok: true, results: [{ id: YT, title: "First" }, { id: "M7lc1UVf-VE", title: "Second" }] }) } });
  assert.equal(env.ids.get("music-link-queue-list").children.length, 1);
  // One box now searches (words) or plays (a link); Go with words searches YouTube.
  env.ids.get("music-link-url").value = "music"; env.ids.get("music-link-load").click(); await flush();
  const results = env.ids.get("music-youtube-results");
  results.children[0].children[1].click(); results.children[1].children[2].click();
  assert.equal(env.ids.get("music-link-queue-list").children.length, 2);
  env.ids.get("music-next").click(); assert.equal(env.music.linkElement().url, "https://example.com/queued.mp4");
  results.children[0].children[3].click();
  assert.match(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1"))[0].url, new RegExp(YT));
  // A queued link empties the box, so every one of the 55 attempts types its link again.
  for (let index = 0; index < 55; index++) { env.ids.get("music-link-url").value = "https://example.com/repeat.mp4"; env.ids.get("music-link-queue-add").click(); }
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1")).length, 50);
  assert.equal(env.ids.get("music-link-queue-list").children.length, 50);
});

test("video volume and mute control YouTube, Vimeo and native files and survive reload", async () => {
  const env = environment(); env.music.playLink(`https://www.youtube.com/watch?v=${YT}`);
  let frame = env.music.linkElement().element;
  // One slider (0 to 100) and one mute button drive whichever video is on.
  env.ids.get("music-volume").value = "35"; env.ids.get("music-volume").dispatch("input");
  assert.equal(frame.messages.at(-2)[0].func, "setVolume"); assert.equal(frame.messages.at(-2)[0].args[0], 35);
  env.ids.get("music-mute").click(); assert.equal(frame.messages.at(-1)[0].func, "mute");
  const restored = environment({ mediaVolumeSaved: JSON.parse(env.storage.get("mefiStudio.mediaVolume.v1")) });
  restored.music.playLink(`https://www.youtube.com/watch?v=${YT}`); frame = restored.music.linkElement().element;
  restored.message({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: { event: "onReady" } });
  assert.equal(frame.messages.at(-2)[0].args[0], 35); assert.equal(frame.messages.at(-1)[0].func, "mute");
  // Studio has just asked the player for 35 and mute, so a report of another
  // level right after is the player echoing an older one: ignored for 1.5 s.
  const report = { source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: { event: "infoDelivery", info: { volume: 60, muted: false } } };
  restored.message(report);
  assert.equal(restored.ids.get("music-mute").attrs["aria-pressed"], "true", "the echo does not unmute");
  assert.deepEqual(JSON.parse(restored.storage.get("mefiStudio.mediaVolume.v1")), { volume: .35, muted: true }, "the echo is not saved");
  // Later, the same report is a change made in the player itself, and Studio follows it.
  restored.advance(1600); restored.message(report);
  assert.equal(restored.ids.get("music-volume").value, "60"); assert.equal(restored.ids.get("music-mute").attrs["aria-pressed"], "false");
  assert.deepEqual(JSON.parse(restored.storage.get("mefiStudio.mediaVolume.v1")), { volume: .6, muted: false });
  env.music.playLink("https://vimeo.com/12345678"); frame = env.music.linkElement().element;
  env.ids.get("music-volume").value = "20"; env.ids.get("music-volume").dispatch("input");
  assert.deepEqual(frame.messages.at(-2)[0], { method: "setVolume", value: .2 });
  env.music.playLink("https://example.com/video.mp4"); frame = env.music.linkElement().element;
  assert.equal(frame.volume, .2); assert.equal(frame.muted, false);
  env.ids.get("music-mute").click(); assert.equal(frame.muted, true);
});

test("YouTube explorer plays results, advances to the next result and supports playlist Next", async () => {
  const env = environment({ bridge: { youtubeSearch: async query => { assert.equal(query, "quiet music"); return { ok: true, results: [{ id: YT, title: "First", channel: "One" }, { id: "M7lc1UVf-VE", title: "Second" }] }; } } });
  // The box takes words; Go searches YouTube, and the words stay for the next look.
  env.ids.get("music-link-url").value = "quiet music"; env.ids.get("music-link-load").click(); await flush();
  const results = env.ids.get("music-youtube-results"); assert.equal(results.children.length, 2);
  results.children[0].children[1].click(); assert.match(env.music.linkElement().url, new RegExp(YT));
  assert.equal(env.ids.get("music-link-url").value, "quiet music", "playing a result keeps the search in the box");
  env.ids.get("music-next").click(); assert.match(env.music.linkElement().url, /M7lc1UVf-VE/);
  // A playlist plays its own order, even when its video is also one of the
  // results on screen (the first result is this playlist's video).
  env.music.playLink(`https://www.youtube.com/watch?v=${YT}&list=PLabcdefghijk`);
  const frame = env.music.linkElement().element; env.ids.get("music-next").click();
  assert.equal(frame.messages.at(-1)[0].func, "nextVideo");
  assert.equal(env.music.linkElement().element, frame, "Next inside a playlist does not leave it for the results");
});

test("YouTube restores observed position and playback, ignores foreign messages and follows playlist changes", async () => {
  const env = environment(); env.music.playLink(`https://www.youtube.com/watch?v=${YT}`);
  const frame = env.music.linkElement().element;
  frame.dispatch("load");
  assert.equal(frame.messages.at(-1)[0].event, "listening");
  const delivery = (info, overrides = {}) => env.message({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: JSON.stringify({ event: "infoDelivery", info }), ...overrides });
  delivery({ currentTime: 999, playerState: 1 }, { origin: "https://evil.test" });
  delivery({ currentTime: 999, playerState: 1 }, { source: {} });
  env.emit("pagehide");
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaResume.v1")).startMs, 0);
  delivery({ currentTime: 123.75, playerState: 1, videoData: { video_id: "M7lc1UVf-VE" } }); env.emit("pagehide");
  let saved = JSON.parse(env.storage.get("mefiStudio.mediaResume.v1"));
  assert.equal(saved.startMs, 123750); assert.equal(saved.autoplay, true); assert.match(saved.url, /v=M7lc1UVf-VE/);
  const restored = environment({ resume: saved }); await flush();
  assert.match(restored.music.linkElement().element.src, /start=123/); assert.match(restored.music.linkElement().element.src, /autoplay=1/);
  delivery({ currentTime: 48.5, playerState: 2 });
  saved = JSON.parse(env.storage.get("mefiStudio.mediaResume.v1"));
  assert.equal(saved.startMs, 48500); assert.equal(saved.autoplay, false);
  const paused = environment({ resume: saved }); await flush();
  assert.match(paused.music.linkElement().element.src, /start=48/); assert.doesNotMatch(paused.music.linkElement().element.src, /autoplay=1/);
  env.music.setSource("local"); delivery({ currentTime: 123, playerState: 1 });
  assert.equal(env.storage.has("mefiStudio.mediaResume.v1"), false);
});

test("Vimeo subscribes to playback updates and restores a paused seek", async () => {
  const env = environment(); env.music.playLink("https://vimeo.com/12345678");
  const frame = env.music.linkElement().element; frame.dispatch("load");
  assert.deepEqual(frame.messages.map(([data]) => data.value), ["timeupdate", "play", "pause", "ended", "volumechange"]);
  env.message({ source: frame.contentWindow, origin: "https://player.vimeo.com", data: { event: "pause", data: { seconds: 67.25 } } });
  const saved = JSON.parse(env.storage.get("mefiStudio.mediaResume.v1"));
  assert.equal(saved.startMs, 67250); assert.equal(saved.autoplay, false);
  const restored = environment({ resume: saved }); await flush();
  assert.match(restored.music.linkElement().element.src, /#t=67s$/);
});

test("A recent open link returns within ten minutes, while closed, expired and diagnostic players stay closed", async () => {
  const url = "https://youtu.be/dQw4w9WgXcQ";
  const env = environment(); env.music.playLink(url, { autoplay: false });
  env.emit("beforeunload");
  const saved = JSON.parse(env.storage.get("mefiStudio.mediaResume.v1"));
  const restored = environment({ resume: saved }); await flush();
  assert.equal(restored.music.linkElement()?.provider, "youtube");
  for (const resume of [{ ...saved, at: Date.now() - 600001 }, { ...saved, at: Date.now() + 60000 }, { ...saved, url: "javascript:alert(1)" }]) {
    const old = environment({ resume }); await flush(); assert.equal(old.music.linkElement(), null);
  }
  const diagnostic = environment({ resume: saved, search: "?capture=1" }); await flush();
  assert.equal(diagnostic.music.linkElement(), null);
  env.music.setSource("local"); env.emit("beforeunload");
  assert.equal(env.storage.has("mefiStudio.mediaResume.v1"), false);
  const closed = environment({ saved: { source: "link", links: [url] } }); await flush();
  assert.equal(closed.music.linkElement(), null, "link history alone does not reopen a dismissed player");
});

// ---- The mini player (2026-09 redesign): one card, one transport, quick tree
// switches, sections, the YouTube feed and the drops onto Up next.
const wordsOf = (env) => Object.fromEntries(["kicker", "title", "detail"].map((part) => [part, findAll(env.document.body, (node) => node.className === `music-now-${part}`)[0].textContent]));
const timesOf = (env) => findAll(env.document.body, (node) => node.className === "music-now-time").map((node) => node.textContent);
const thumbOf = (env) => findAll(env.document.body, (node) => node.className === "music-now-thumb")[0];
const OTHER = "M7lc1UVf-VE";

test("A loaded YouTube video asks for its thumbnail only while the menu is open and the video is not in the card", () => {
  const env = environment({ mediaWindow: true });
  const address = `https://i.ytimg.com/vi/${YT}/mqdefault.jpg`, thumb = thumbOf(env);
  env.music.playLink(`https://youtu.be/${YT}`);
  assert.ok(!thumb.src, "a closed menu shows nobody a picture, so a loaded link reaches no image host");
  const restored = environment({ saved: { source: "link", links: [`https://youtu.be/${YT}`] } });
  assert.ok(!thumbOf(restored).src, "nor does a link remembered from the last session, before the menu opens");
  // The video plays behind the work: the card is left with its picture.
  env.ids.get("music-video-background").click();
  env.music.openAudio();
  assert.equal(thumb.src, address, "the thumbnail is rebuilt from the validated video id");
  assert.equal(thumb.hidden, false);
  // The video comes back into the card's stage: it needs no picture.
  env.ids.get("music-video-background").click(); env.frames();
  assert.equal(env.player.docked, true);
  assert.ok(!thumb.src); assert.equal(thumb.hidden, true);
  env.music.closeAudio(); env.music.playLink(`https://youtu.be/${OTHER}`);
  assert.ok(!thumb.src, "changing video while the menu is closed asks for nothing either");
});

test("The Content Security Policy lets the menu show YouTube thumbnails from that one host and no other image host", async () => {
  const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(template)[1];
  const images = policy.split(";").map((part) => part.trim().split(/\s+/)).find(([key]) => key === "img-src").slice(1);
  assert.ok(images.includes("https://i.ytimg.com"));
  assert.ok(!images.includes("https:") && !images.includes("*"), "thumbnails do not open every https image host");
});

test("The card's transport plays, pauses, steps and seeks local music, and each button says what it can do", async () => {
  const env = environment();
  const [previous, toggle, next, seek, volume, mute] = ["music-previous", "music-play", "music-next", "music-seek", "music-volume", "music-mute"].map((id) => env.ids.get(id));
  let picker = 0; env.ids.get("music-files").addEventListener("click", () => { picker++; });
  assert.deepEqual([previous.disabled, next.disabled, seek.disabled], [true, true, true], "nothing to step through or seek before a track is added");
  assert.deepEqual(wordsOf(env), { kicker: "Your soundtrack", title: "Your own soundtrack", detail: "Add music from your computer to get started." });
  toggle.click(); assert.equal(picker, 1, "with nothing loaded, Play opens the file picker");
  env.music.addFiles([file("One.mp3"), file("Two.mp3")]);
  assert.deepEqual(wordsOf(env), { kicker: "Ready to play", title: "One", detail: "Track 1 of 2 · Local audio" });
  assert.deepEqual([previous.disabled, next.disabled, seek.disabled], [false, false, false]);
  assert.equal(seek.max, "120"); assert.deepEqual(timesOf(env), ["0:00", "2:00"]);
  toggle.click(); await flush();
  assert.equal(toggle.dataset.playing, "true"); assert.equal(toggle.attrs["aria-label"], "Pause"); assert.equal(wordsOf(env).kicker, "Now playing");
  seek.value = "42"; seek.dispatch("input");
  assert.equal(env.audio.currentTime, 42); assert.equal(timesOf(env)[0], "0:42");
  previous.click(); await flush();
  assert.equal(env.audio.currentTime, 0, "Back restarts a track that is well under way"); assert.equal(wordsOf(env).title, "One");
  previous.click(); await flush();
  assert.equal(wordsOf(env).title, "Two", "Back at the start steps to the previous track, wrapping round");
  assert.equal(env.audio.paused, false, "and plays it");
  next.click(); await flush(); assert.equal(wordsOf(env).title, "One", "Next wraps round as well");
  toggle.click();
  assert.equal(env.audio.paused, true); assert.equal(toggle.dataset.playing, "false"); assert.equal(toggle.attrs["aria-label"], "Play");
  // One slider (0 to 100) is the level; Mute holds the sound at zero without saving silence.
  volume.value = "35"; volume.dispatch("input");
  assert.equal(env.audio.volume, .35); assert.equal(JSON.parse(env.storage.get("mefiStudio.music.v1")).volume, .35);
  mute.click();
  assert.equal(env.audio.volume, 0); assert.equal(mute.attrs["aria-pressed"], "true"); assert.equal(mute.attrs["aria-label"], "Unmute");
  assert.equal(volume.value, "0", "a muted slider rests at zero");
  assert.equal(JSON.parse(env.storage.get("mefiStudio.music.v1")).volume, .35, "Mute is for now: the saved level is not zeroed");
  assert.equal(environment({ saved: JSON.parse(env.storage.get("mefiStudio.music.v1")) }).audio.volume, .35, "so the next launch is not silent");
  volume.value = "50"; volume.dispatch("input");
  assert.equal(env.audio.volume, .5); assert.equal(mute.attrs["aria-pressed"], "false", "raising the level is a request to hear it");
  volume.value = "250"; volume.dispatch("input"); assert.equal(env.audio.volume, 1, "the slider's value is clamped");
  volume.value = "oops"; volume.dispatch("input"); assert.equal(env.audio.volume, 0);
});

test("The transport steps through the radio stations and starts or stops the stream; the bar reads Live, not a time", async () => {
  const env = environment(); env.music.setSource("radio");
  const ids = env.music.stations().map((station) => station.id);
  const [previous, toggle, next, seek] = ["music-previous", "music-play", "music-next", "music-seek"].map((id) => env.ids.get(id));
  // A tune answers on a later tick; the card repaints on the next frame.
  const settled = async () => { await flush(); env.frames(); };
  assert.deepEqual(wordsOf(env), { kicker: "Ad-free radio", title: "Pick a station", detail: "Listener-funded stations. No ads, ever." });
  assert.deepEqual([previous.disabled, toggle.disabled, next.disabled, seek.disabled], [false, false, false, true]);
  assert.equal(toggle.attrs["aria-label"], "Play the radio"); assert.deepEqual(timesOf(env), ["Live", ""]);
  assert.equal(findAll(env.document.body, (node) => node.className === "music-now-seek")[0].dataset.live, "true");
  toggle.click(); await settled();
  assert.equal(env.music.status().station, ids[0], "Play with nothing tuned starts the first station");
  assert.deepEqual(wordsOf(env), { kicker: "Live radio", title: "Groove Salad", detail: "Chilled ambient beats · SomaFM" });
  assert.equal(toggle.dataset.playing, "true"); assert.equal(toggle.attrs["aria-label"], "Stop the radio");
  next.click(); await settled();
  assert.equal(env.music.status().station, ids[1], "Next tunes the station after this one");
  assert.equal(wordsOf(env).title, "Drone Zone");
  previous.click(); await settled(); previous.click(); await settled();
  assert.equal(env.music.status().station, ids.at(-1), "Back from the first station wraps to the last");
  next.click(); await settled(); assert.equal(env.music.status().station, ids[0], "and Next from the last wraps to the first");
  toggle.click(); env.frames();
  assert.equal(env.music.status().radioPhase, "idle", "Stop ends the stream"); assert.equal(toggle.dataset.playing, "false");
  assert.equal(env.music.status().station, ids[0], "but the station stays chosen");
  toggle.click(); await settled(); assert.equal(env.music.status().radioPhase, "playing"); assert.equal(env.music.status().station, ids[0], "Play tunes it again");
  const fresh = environment(); fresh.music.setSource("radio");
  fresh.ids.get("music-previous").click(); await flush();
  assert.equal(fresh.music.status().station, ids.at(-1), "Back with nothing tuned starts from the last station");
});

test("The card follows the stream's own trouble, not only the radio panel: holding the sound, then a station that is unavailable", async () => {
  const env = environment(); env.music.tune("groovesalad"); await flush(); env.frames();
  const toggle = env.ids.get("music-play");
  assert.equal(wordsOf(env).kicker, "Live radio");
  env.audio.dispatch("waiting"); env.frames();
  assert.equal(wordsOf(env).kicker, "Holding the sound…");
  assert.equal(toggle.dataset.playing, "true", "a buffering stream is still the source, so it can still be stopped");
  const spent = environment();
  for (const host of ["ice1", "ice2", "ice4"]) spent.refused.add(mirror("groovesalad", host));
  spent.music.tune("groovesalad"); await flush(); await flush(); spent.frames();
  assert.equal(spent.music.status().radioPhase, "error");
  assert.equal(wordsOf(spent).kicker, "Station unavailable");
  assert.equal(spent.ids.get("music-play").dataset.playing, "false"); assert.equal(spent.ids.get("music-play").attrs["aria-label"], "Play the radio", "Play tries the station again");
});

test("The transport drives a YouTube video: the embed names it and gives its length, Play and Pause show at once, a drag on the bar previews and release settles", () => {
  const env = environment(); env.music.playLink(`https://youtu.be/${YT}`);
  const frame = env.music.linkElement().element;
  const say = (data) => env.message({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data });
  const commands = () => frame.messages.map(([message]) => message).filter((message) => message.event === "command").map((message) => [message.func, ...message.args]);
  const [toggle, seek] = ["music-play", "music-seek"].map((id) => env.ids.get(id));
  // Before the embed reports, the card has only the link's own label.
  assert.deepEqual(wordsOf(env), { kicker: "YouTube", title: "YouTube video", detail: "YouTube" });
  assert.equal(seek.disabled, true, "no length is known yet"); assert.deepEqual(timesOf(env), ["0:00", "--:--"]);
  say({ event: "initialDelivery", info: { currentTime: 0, duration: 225, playerState: 1, volume: 70, muted: false, videoData: { video_id: YT, title: "Night Drive — Lo-fi mix", author: "Studio Test Channel" } } });
  env.frames();
  assert.deepEqual(commands().slice(0, 1), [["addEventListener", "onStateChange"]], "the first report subscribes to state changes");
  assert.deepEqual(wordsOf(env), { kicker: "Now playing", title: "Night Drive — Lo-fi mix", detail: "Studio Test Channel · YouTube" }, "the title and channel are the embed's own");
  assert.equal(seek.disabled, false); assert.equal(seek.max, "225"); assert.deepEqual(timesOf(env), ["0:00", "3:45"]);
  toggle.click();
  assert.deepEqual(commands().at(-1), ["pauseVideo"]);
  assert.equal(toggle.dataset.playing, "false", "the card shows the change at once; the player's next report confirms it");
  assert.equal(wordsOf(env).kicker, "Paused");
  toggle.click(); assert.deepEqual(commands().at(-1), ["playVideo"]); assert.equal(toggle.dataset.playing, "true");
  // A drag on the bar previews on the player a few times a second, and release settles it.
  seek.value = "60"; seek.dispatch("input");
  assert.deepEqual(commands().at(-1), ["seekTo", 60, false]);
  seek.value = "70"; seek.dispatch("input");
  assert.deepEqual(commands().at(-1), ["seekTo", 60, false], "a drag inside 180 ms sends nothing more");
  env.advance(200); seek.value = "80"; seek.dispatch("input");
  assert.deepEqual(commands().at(-1), ["seekTo", 80, false]);
  seek.dispatch("change"); assert.deepEqual(commands().at(-1), ["seekTo", 80, true], "release settles it");
  // Right after a seek, a report from the old place is not believed; later it is.
  say({ event: "infoDelivery", info: { currentTime: 3, playerState: 1 } }); env.frames();
  assert.equal(seek.value, "80");
  env.advance(1300); say({ event: "infoDelivery", info: { currentTime: 3, playerState: 1 } }); env.frames();
  assert.equal(seek.value, "3");
  // Between two reports a playing video keeps moving at its own pace, so the
  // bar does not stutter, but never more than two seconds past the last report.
  env.advance(1000); env.music.setRecommender(null); assert.equal(timesOf(env)[0], "0:04");
  env.advance(5000); env.music.setRecommender(null); assert.equal(timesOf(env)[0], "0:05", "a player that has gone quiet is not run on");
  say({ event: "onStateChange", info: 2 }); env.frames();
  assert.equal(wordsOf(env).kicker, "Paused", "the player's report is the last word");
  assert.equal(timesOf(env)[0], "0:03", "and the bar rests where the player last said it was");
  env.advance(1000); env.music.setRecommender(null); assert.equal(timesOf(env)[0], "0:03", "a paused video does not move");
});

test("The transport drives a Vimeo video through its message API: title and length on ready, then play, pause, seek and volume", () => {
  const env = environment(); env.music.playLink("https://vimeo.com/12345678");
  const frame = env.music.linkElement().element;
  const say = (data) => env.message({ source: frame.contentWindow, origin: "https://player.vimeo.com", data });
  const sent = () => frame.messages.map(([message]) => message);
  const [toggle, seek, volume, mute] = ["music-play", "music-seek", "music-volume", "music-mute"].map((id) => env.ids.get(id));
  frame.dispatch("load");
  assert.deepEqual(sent().map((message) => message.value), ["timeupdate", "play", "pause", "ended", "volumechange"], "it subscribes to the player's events");
  say({ event: "ready" });
  assert.deepEqual(sent().slice(-4), [{ method: "getVideoTitle" }, { method: "getDuration" }, { method: "setVolume", value: .7 }, { method: "setMuted", value: false }], "ready asks for the title and length and sets Studio's level");
  say({ method: "getVideoTitle", value: "A fixture film" }); say({ method: "getDuration", value: 300 });
  say({ event: "play", data: { seconds: 12, duration: 300 } }); env.frames();
  assert.deepEqual(wordsOf(env), { kicker: "Now playing", title: "A fixture film", detail: "Vimeo" });
  assert.equal(seek.max, "300"); assert.deepEqual(timesOf(env), ["0:12", "5:00"]);
  toggle.click(); assert.deepEqual(sent().at(-1), { method: "pause" }); assert.equal(toggle.dataset.playing, "false");
  toggle.click(); assert.deepEqual(sent().at(-1), { method: "play" });
  seek.value = "90"; seek.dispatch("input"); assert.deepEqual(sent().at(-1), { method: "setCurrentTime", value: 90 });
  volume.value = "50"; volume.dispatch("input"); assert.deepEqual(sent().slice(-2), [{ method: "setVolume", value: .5 }, { method: "setMuted", value: false }]);
  mute.click(); assert.deepEqual(sent().at(-1), { method: "setMuted", value: true });
  // The same echo rule as YouTube: the player's report of an older level, just after Studio's own, is ignored.
  say({ event: "volumechange", data: { volume: .9, muted: false } });
  assert.equal(mute.attrs["aria-pressed"], "true");
  env.advance(1600); say({ event: "volumechange", data: { volume: .9, muted: false } });
  assert.equal(volume.value, "90"); assert.equal(mute.attrs["aria-pressed"], "false");
});

test("The transport drives a plain video file through its own element, and the file's own controls move the card", async () => {
  const env = environment(); env.music.playLink("https://example.com/clip.mp4");
  const player = env.music.linkElement().element;
  // The fixture element gets the parts of a media element the transport uses.
  Object.assign(player, { paused: true, ended: false, currentTime: 0, duration: 90,
    play() { this.paused = false; this.dispatch("play"); return Promise.resolve(); }, pause() { this.paused = true; this.dispatch("pause"); } });
  const [previous, toggle, seek, volume, mute] = ["music-previous", "music-play", "music-seek", "music-volume", "music-mute"].map((id) => env.ids.get(id));
  player.dispatch("loadedmetadata"); env.frames();
  assert.equal(seek.disabled, false); assert.equal(seek.max, "90"); assert.deepEqual(timesOf(env), ["0:00", "1:30"]);
  assert.deepEqual(wordsOf(env), { kicker: "Paused", title: "Video file · clip.mp4", detail: "Web" }, "a file that has not started is a paused one: Studio can start it");
  toggle.click(); env.frames();
  assert.equal(player.paused, false); assert.equal(toggle.dataset.playing, "true", "the card follows the file's own play event");
  assert.equal(wordsOf(env).kicker, "Now playing");
  toggle.click(); env.frames();
  assert.equal(player.paused, true); assert.equal(toggle.dataset.playing, "false"); assert.equal(wordsOf(env).kicker, "Paused");
  seek.value = "30"; seek.dispatch("input"); assert.equal(player.currentTime, 30); assert.equal(timesOf(env)[0], "0:30");
  previous.click(); assert.equal(player.currentTime, 0, "Back restarts a file that is under way");
  volume.value = "40"; volume.dispatch("input");
  assert.equal(player.volume, .4); assert.deepEqual(JSON.parse(env.storage.get("mefiStudio.mediaVolume.v1")), { volume: .4, muted: false });
  mute.click(); assert.equal(player.muted, true);
  // Its own controls move the level (never Studio's music level), and the card follows at once.
  Object.assign(player, { volume: .25, muted: false }); player.dispatch("volumechange");
  assert.equal(volume.value, "25"); assert.equal(mute.attrs["aria-pressed"], "false");
  assert.deepEqual(JSON.parse(env.storage.get("mefiStudio.mediaVolume.v1")), { volume: .25, muted: false });
  assert.equal(env.music.status().source, "link"); assert.equal(env.audio.volume, .7, "the local music level is a separate saved level");
  player.error = { code: 4 }; toggle.click(); player.dispatch("error"); env.frames();
  assert.equal(toggle.dataset.playing, "false"); assert.match(noticeOf(env).textContent, /could not be played/);
});

test("A level the player reports right after Studio set one is ignored for 1.5 seconds, and never while Studio's slider is held", () => {
  const env = environment(); env.music.playLink(`https://youtu.be/${YT}`);
  const frame = env.music.linkElement().element, volume = env.ids.get("music-volume");
  const say = (level, muted = false) => env.message({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: { event: "infoDelivery", info: { volume: level, muted } } });
  const saved = () => JSON.parse(env.storage.get("mefiStudio.mediaVolume.v1") ?? "null");
  say(70); // the first report applies Studio's level (70) to the player
  assert.equal(frame.messages.filter(([message]) => message.func === "setVolume").length, 1);
  say(55); assert.equal(volume.value, "70", "a different level at once is the player echoing an older one");
  env.advance(1400); say(55); assert.equal(volume.value, "70", "still inside the 1.5 seconds");
  env.advance(200); say(55); assert.equal(volume.value, "55", "later, it is a change made in the player itself");
  assert.equal(saved().volume, .55);
  const volumeWrites = () => env.writes.filter(([key]) => key === "mefiStudio.mediaVolume.v1").length;
  const writes = volumeWrites(); say(55.4); assert.equal(volumeWrites(), writes, "a report of the level Studio already has changes nothing");
  // Studio's own change starts the guard again.
  volume.value = "80"; volume.dispatch("input"); env.advance(500); say(55); assert.equal(saved().volume, .8);
  // Holding the slider, no report moves it, however old Studio's last word is.
  env.advance(5000); volume.focus(); say(20); assert.equal(saved().volume, .8);
  env.document.activeElement = null; say(20); assert.equal(volume.value, "20");
  // The mute state is a report too.
  env.advance(2000); say(20, true); assert.equal(env.ids.get("music-mute").attrs["aria-pressed"], "true");
});

test("The floating player's bar carries the same transport, and both bars follow one state", () => {
  const env = environment({ mediaWindow: true }); env.music.playLink(`https://youtu.be/${YT}`);
  const frame = env.music.linkElement().element, bar = env.player.options.transport;
  const ids = ["previous", "play", "next", "mute", "volume"].map((name) => `media-window-${name}`);
  for (const id of ids) assert.equal(bar.contains(env.ids.get(id)), true, `${id} rides in the window's bar`);
  const say = (data) => env.message({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data });
  const commands = () => frame.messages.map(([message]) => message).filter((message) => message.event === "command").map((message) => [message.func, ...message.args]);
  say({ event: "infoDelivery", info: { currentTime: 10, duration: 200, playerState: 1, volume: 70, muted: false, videoData: { video_id: YT, title: "Bar", author: "A" } } }); env.frames();
  const [play, next, mute, volume] = ["play", "next", "mute", "volume"].map((name) => env.ids.get(`media-window-${name}`));
  assert.equal(play.dataset.playing, "true"); assert.equal(play.attrs["aria-label"], "Pause");
  play.click(); assert.deepEqual(commands().at(-1), ["pauseVideo"]);
  assert.equal(env.ids.get("music-play").dataset.playing, "false", "the card follows the bar");
  volume.value = "30"; volume.dispatch("input");
  assert.deepEqual(commands().slice(-2), [["setVolume", 30], ["unMute"]]);
  assert.equal(env.ids.get("music-volume").value, "30", "one level for both sliders");
  env.ids.get("music-mute").click(); assert.equal(mute.attrs["aria-pressed"], "true"); assert.equal(volume.value, "0");
  assert.equal(next.disabled, false);
  // The window's own buttons reach the menu and Studio: settings opens the media menu, Close stops the video.
  env.player.options.onSettings(); assert.equal(env.ids.get("music-dropdown").hidden, false);
  env.player.options.onClose(); assert.equal(env.music.linkElement(), null); assert.equal(env.music.status().provider, null);
});

test("Spotify, SoundCloud and a website keep their own controls: the card disables what Studio cannot drive", async () => {
  const env = environment({ bridge: { mediaBrowserOpen: async () => ({ ok: true, state: { url: "https://example.com/radio", title: "Fixture radio" } }) } });
  const [previous, toggle, next, seek, volume, mute] = ["music-previous", "music-play", "music-next", "music-seek", "music-volume", "music-mute"].map((id) => env.ids.get(id));
  env.music.loadSpotify("https://open.spotify.com/album/37i9dQZF1DX7zqr9q1MPG7");
  assert.deepEqual(wordsOf(env), { kicker: "Spotify", title: "Spotify album", detail: "Spotify · play and pause inside its player" });
  assert.equal(toggle.disabled, true); assert.equal(toggle.title, "Use the player’s own play button");
  assert.deepEqual([volume.disabled, mute.disabled, seek.disabled], [true, true, true], "no levels or time Studio can move");
  assert.deepEqual([previous.disabled, next.disabled], [false, false], "but the queue and history still step");
  env.music.playLink("https://soundcloud.com/forss/flickermood");
  assert.equal(wordsOf(env).kicker, "SoundCloud"); assert.equal(toggle.disabled, true);
  env.music.playLink("https://open.spotify.com/socialsession/5Ab3xYz09kLmNoPq");
  assert.equal(wordsOf(env).kicker, "SoundCloud", "a Spotify Jam is handed off and leaves the card alone");
  // The website: no transport of Studio's own, just a way on to what is queued.
  await env.music.playLink("https://example.com/radio"); await flush();
  assert.deepEqual(wordsOf(env), { kicker: "Browsing", title: "Fixture radio", detail: "Use the website’s own play controls." });
  assert.deepEqual([toggle.disabled, previous.disabled, next.disabled, volume.disabled], [true, true, true, true]);
  env.ids.get("music-link-url").value = "https://example.com/next.mp4"; env.ids.get("music-link-queue-add").click();
  assert.equal(next.disabled, false, "with something queued, Next is the way out of the website");
});

const feedNoteOf = (env) => findAll(env.document.body, (node) => node.className === "music-fineprint music-feed-note")[0];

test("Next takes the queue first, then the feed, and asks for a pick when nothing is lined up", async () => {
  const env = environment({ bridge: { youtubeSearch: async () => ({ ok: true, results: [{ id: YT, title: "First" }, { id: OTHER, title: "Second" }] }) } });
  env.music.setSource("link");
  const [previous, toggle, next] = ["music-previous", "music-play", "music-next"].map((id) => env.ids.get(id));
  const dropdown = env.ids.get("music-dropdown"), box = env.ids.get("music-link-url");
  assert.deepEqual(wordsOf(env), { kicker: "Video & links", title: "Nothing playing yet", detail: "Search YouTube or paste a link." });
  assert.deepEqual([previous.disabled, toggle.disabled, next.disabled], [true, true, false], "with nothing on and nothing queued, only Next (to look for something) is live");
  next.click();
  assert.equal(dropdown.hidden, false); assert.equal(dropdown.dataset.size, "full"); assert.equal(dropdown.dataset.section, "browse");
  assert.equal(feedNoteOf(env).textContent, "Pick what plays next: click a video to queue it, or drag it onto Up next.");
  // A queued video makes Play live, and starts it.
  box.value = "https://example.com/queued.mp4"; env.ids.get("music-link-queue-add").click();
  assert.equal(toggle.disabled, false); assert.equal(wordsOf(env).detail, "1 waiting in Up next");
  toggle.click(); assert.equal(env.music.linkElement().url, "https://example.com/queued.mp4");
  // Search, play the first result, and queue a link behind it: Next takes the queue, then the next result.
  box.value = "quiet"; env.ids.get("music-link-load").click(); await flush();
  const results = env.ids.get("music-youtube-results");
  results.children[0].children[1].click(); assert.match(env.music.linkElement().url, new RegExp(YT));
  box.value = "https://example.com/second.mp4"; env.ids.get("music-link-queue-add").click();
  next.click(); assert.equal(env.music.linkElement().url, "https://example.com/second.mp4", "a queued video comes before the feed");
  results.children[0].children[1].click();
  next.click(); assert.match(env.music.linkElement().url, new RegExp(OTHER), "with the queue empty, Next follows the feed");
  // The last result has nothing after it: the menu opens Browse and asks for a pick.
  dropdown.dataset.section = ""; env.music.openSection("picture"); feedNoteOf(env).textContent = "";
  next.click();
  assert.equal(dropdown.dataset.section, "browse"); assert.equal(feedNoteOf(env).textContent, "Pick what plays next: click a video to queue it, or drag it onto Up next.");
  // A link with a start time is still the video on the feed, so Next still finds its place.
  env.music.playLink(`https://youtu.be/${YT}?t=90`); next.click();
  assert.match(env.music.linkElement().url, new RegExp(OTHER), "the feed matches the video, not the exact link");
});

test("Back restarts a video that is under way, then goes back through the ones played, and a playlist steps its own way back", () => {
  const env = environment();
  const A = `https://www.youtube.com/watch?v=${YT}`, B = `https://www.youtube.com/watch?v=${OTHER}`, C = "https://vimeo.com/12345678";
  const previous = env.ids.get("music-previous");
  env.music.playLink(A); env.music.playLink(B); env.music.playLink(C);
  previous.click(); assert.equal(env.music.linkElement().url, B, "Back at the start of a video goes to the one played before");
  previous.click(); assert.equal(env.music.linkElement().url, A);
  previous.click(); assert.equal(env.music.linkElement().url, A, "with nothing before it there is nowhere further back");
  const frame = env.music.linkElement().element;
  const commands = () => frame.messages.map(([message]) => message).filter((message) => message.event === "command").map((message) => [message.func, ...message.args]);
  env.message({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: { event: "infoDelivery", info: { currentTime: 42, duration: 200, playerState: 1 } } });
  previous.click();
  assert.deepEqual(commands().at(-1), ["seekTo", 0, true], "a video well under way restarts rather than leaving");
  assert.equal(env.music.linkElement().element, frame);
  env.message({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: { event: "infoDelivery", info: { currentTime: 3, duration: 200, playerState: 1 } } });
  env.advance(1300);
  const playlist = environment();
  playlist.music.playLink(`https://www.youtube.com/watch?v=${YT}&list=PLabcdefghijk`);
  const list = playlist.music.linkElement().element;
  playlist.ids.get("music-previous").click();
  assert.deepEqual(list.messages.at(-1)[0], { event: "command", func: "previousVideo", args: [], id: "studio-media", channel: "widget" }, "inside a playlist, Back is the playlist's own");
});

test("The eight quick tree switches each flip one setting, mirror the Tree section, and stay dim while the tree is not listening", () => {
  const calls = [];
  let status = { selection: "auto", reactive: false, listening: false, pending: false, error: null, response: .35, label: "Audio link off", effects: { waves: true, splitBands: true, nodes: true, motion: true, percussion: false, background: false } };
  const env = environment({ audioLink: {
    audioStatus: () => status,
    setMusicReactive: (on) => { calls.push(["react", on]); status = { ...status, reactive: on, listening: on, label: on ? "Track linked" : "Audio link off" }; },
    setAudioEffects: (effects) => { calls.push(["effects", { ...effects }]); status = { ...status, effects: { ...status.effects, ...effects } }; },
    setAudioSource() {}, setAudioResponse() {},
  } });
  const keys = ["react", "waves", "nodes", "motion", "percussion", "background", "orbitTrails", "extraGlow"];
  const chip = (key) => env.ids.get(`music-quick-${key}`);
  const pressed = () => Object.fromEntries(keys.map((key) => [key, chip(key).attrs["aria-pressed"] === "true"]));
  assert.deepEqual(chip("react").parentElement.children.map((node) => node.dataset.quick), keys, "eight switches, in this order");
  assert.deepEqual(keys.map((key) => chip(key).children[1].textContent), ["React", "Waves", "Glow", "Motion", "Drums", "Aura", "Trails", "Halos"]);
  assert.ok(keys.every((key) => chip(key).title), "each says what it does");
  assert.deepEqual(pressed(), { react: false, waves: true, nodes: true, motion: true, percussion: false, background: false, orbitTrails: false, extraGlow: false });
  const quickState = () => findAll(env.document.body, (node) => node.className === "music-quick-state")[0].textContent;
  assert.equal(quickState(), "The tree is not listening");
  assert.deepEqual(keys.map((key) => chip(key).dataset.idle), ["false", "true", "true", "true", "true", "true", "false", "false"], "reactions rest dim until the tree listens; Trails and Halos never depend on it");
  chip("react").click();
  assert.deepEqual(calls.at(-1), ["react", true]); assert.equal(chip("react").attrs["aria-pressed"], "true"); assert.equal(quickState(), "Track linked");
  assert.deepEqual(keys.map((key) => chip(key).dataset.idle), keys.map(() => "false"));
  chip("waves").click(); assert.deepEqual(calls.at(-1), ["effects", { waves: false }]); assert.equal(chip("waves").attrs["aria-pressed"], "false");
  chip("percussion").click(); assert.deepEqual(calls.at(-1), ["effects", { percussion: true }]); assert.equal(chip("percussion").attrs["aria-pressed"], "true");
  assert.equal(calls.length, 3, "one setting per press, and nothing else moves");
  // The Tree section's own checkboxes drive the same chips.
  const input = env.ids.get("music-audio-motion"); status = { ...status, effects: { ...status.effects, motion: false } }; input.checked = false; input.dispatch("change");
  assert.equal(chip("motion").attrs["aria-pressed"], "false");
  // Trails and Halos are the tree's look, saved with the other preferences, and the Appearance checkboxes follow.
  const before = env.events.filter((event) => event.type === "mefi-tree-preferences").length;
  chip("orbitTrails").click();
  assert.equal(env.music.status().orbitTrails, true); assert.equal(chip("orbitTrails").attrs["aria-pressed"], "true"); assert.equal(env.ids.get("music-orbit-trails").checked, true);
  assert.equal(JSON.parse(env.storage.get("mefiStudio.music.v1")).orbitTrails, true);
  assert.equal(env.events.filter((event) => event.type === "mefi-tree-preferences").length, before + 1);
  chip("extraGlow").click(); chip("orbitTrails").click();
  assert.deepEqual({ ...env.music.graphPreferences() }, { nodeStyle: "orbs", nodeLayout: "constellation", orbitTrails: false, extraGlow: true });
  env.ids.get("music-extra-glow").checked = false; env.ids.get("music-extra-glow").dispatch("change");
  assert.equal(chip("extraGlow").attrs["aria-pressed"], "false", "the Appearance checkbox drives the chip too");
  chip("react").click(); assert.deepEqual(calls.at(-1), ["react", false]); assert.equal(chip("react").attrs["aria-pressed"], "false");
  // Without the Command audio API only the tree's look can be switched.
  const bare = environment();
  assert.deepEqual(keys.map((key) => bare.ids.get(`music-quick-${key}`).disabled), [true, true, true, true, true, true, false, false]);
});

test("The section chips unfold the mini player into one section at a time, and a second click or the unfold button folds it back", () => {
  const env = environment();
  const dropdown = env.ids.get("music-dropdown"), deck = env.ids.get("music-deck"), expand = env.ids.get("music-dropdown-expand");
  const strip = deck.parentElement.children.find((node) => node.className === "music-sections");
  const chips = () => strip.children;
  const shown = () => Object.fromEntries(["music-local-panel", "music-radio-panel", "music-link-panel", "music-audio-reactions", "music-more"].map((id) => [id.replace("music-", ""), !env.ids.get(id).hidden]));
  env.music.openAudio();
  assert.equal(strip.attrs.role, "tablist");
  assert.deepEqual(chips().map((chip) => chip.dataset.section), ["tracks", "tree", "more"], "Music: its own list first, then the two every source has");
  assert.deepEqual(chips().map((chip) => chip.children[1].textContent), ["Tracks", "Tree", "More"]);
  assert.equal(dropdown.dataset.size, "compact"); assert.equal(deck.hidden, true);
  assert.equal(expand.attrs["aria-expanded"], "false"); assert.equal(expand.attrs["aria-label"], "Show more");
  assert.deepEqual(chips().map((chip) => chip.attrs["aria-selected"]), ["false", "false", "false"]);
  assert.deepEqual(chips().map((chip) => chip.tabIndex), [0, -1, -1], "one keyboard stop while folded");
  env.ids.get("music-section-tree").click();
  assert.equal(dropdown.dataset.size, "full"); assert.equal(dropdown.dataset.section, "tree"); assert.equal(deck.hidden, false);
  assert.deepEqual(shown(), { "local-panel": false, "radio-panel": false, "link-panel": false, "audio-reactions": true, more: false });
  assert.deepEqual(chips().map((chip) => chip.attrs["aria-selected"]), ["false", "true", "false"]);
  assert.deepEqual(chips().map((chip) => chip.tabIndex), [-1, 0, -1]);
  assert.equal(expand.attrs["aria-expanded"], "true"); assert.equal(expand.attrs["aria-label"], "Show less"); assert.equal(expand.dataset.open, "true");
  env.ids.get("music-section-more").click();
  assert.equal(dropdown.dataset.section, "more"); assert.equal(dropdown.dataset.size, "full", "another chip changes the section without folding");
  assert.deepEqual(shown(), { "local-panel": false, "radio-panel": false, "link-panel": false, "audio-reactions": false, more: true });
  assert.equal(env.ids.get("music-more").contains(env.music.togetherHost()), true, "Listen together lives in More");
  env.ids.get("music-section-more").click();
  assert.equal(dropdown.dataset.size, "compact"); assert.equal(deck.hidden, true, "a second click on the open section folds it");
  expand.click(); assert.equal(dropdown.dataset.section, "more", "Unfold reopens the section last shown"); assert.equal(dropdown.dataset.size, "full");
  expand.click(); assert.equal(dropdown.dataset.size, "compact", "and folds it again");
  assert.equal(env.music.openSection("browse"), "more", "a section this source does not have opens the one it last showed");
  assert.equal(env.music.openSection("tracks"), "tracks"); assert.deepEqual(shown(), { "local-panel": true, "radio-panel": false, "link-panel": false, "audio-reactions": false, more: false });
  // Every visit starts folded, and the last section is saved without unfolding the next visit.
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaMenu.v1")).section, "tracks");
  env.music.closeAudio(); env.music.openAudio(); assert.equal(dropdown.dataset.size, "compact"); assert.equal(deck.hidden, true);
  const restored = environment({ menuSaved: { section: "more" } }); restored.music.openAudio();
  assert.equal(restored.ids.get("music-dropdown").dataset.size, "compact");
  // Each source has its own first section, and a source's list gives way to the next source's.
  env.music.setSource("radio");
  assert.deepEqual(chips().map((chip) => chip.dataset.section), ["stations", "tree", "more"]);
  env.ids.get("music-section-stations").click(); assert.deepEqual(shown(), { "local-panel": false, "radio-panel": true, "link-panel": false, "audio-reactions": false, more: false });
  env.music.setSource("link");
  assert.deepEqual(chips().map((chip) => chip.dataset.section), ["browse", "picture", "tree", "more"]);
  assert.equal(dropdown.dataset.section, "browse", "the unfolded list follows the source rather than staying on a list it no longer has");
  assert.deepEqual(shown(), { "local-panel": false, "radio-panel": false, "link-panel": true, "audio-reactions": false, more: false });
  env.ids.get("music-section-picture").click();
  assert.equal(env.ids.get("music-link-panel").hidden, false); assert.equal(strip.children[1].attrs["aria-selected"], "true");
  // A hidden menu is opened by asking for a section.
  env.music.closeAudio(); assert.equal(dropdown.hidden, true);
  env.music.openSection("more"); assert.equal(dropdown.hidden, false); assert.equal(dropdown.dataset.section, "more"); assert.equal(dropdown.dataset.size, "full");
});

test("The section chips move focus with the arrow keys, Home and End", () => {
  const env = environment(); env.music.setSource("link"); env.music.openAudio();
  const strip = env.ids.get("music-deck").parentElement.children.find((node) => node.className === "music-sections");
  const press = (key) => strip.dispatch("keydown", { key });
  const order = ["browse", "picture", "tree", "more"].map((key) => env.ids.get(`music-section-${key}`));
  order[0].focus(); press("ArrowRight"); assert.equal(env.document.activeElement, order[1]);
  press("End"); assert.equal(env.document.activeElement, order[3]);
  press("ArrowRight"); assert.equal(env.document.activeElement, order[0], "wraps round");
  press("ArrowLeft"); assert.equal(env.document.activeElement, order[3]);
  press("Home"); assert.equal(env.document.activeElement, order[0]);
  env.document.activeElement = env.document.body; press("ArrowRight"); assert.equal(env.document.activeElement, env.document.body, "a key press from elsewhere moves nothing");
});

test("Unfolding eases the menu from one size to the next and settles when the animation ends; reduced motion just switches", () => {
  const env = environment();
  const dropdown = env.ids.get("music-dropdown");
  const sizes = { compact: { width: 396, height: 520 }, full: { width: 900, height: 640 } };
  dropdown.getBoundingClientRect = () => sizes[dropdown.dataset.size];
  const runs = [];
  dropdown.animate = (frames, options) => { const run = { frames, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } }; runs.push(run); return run; };
  dropdown.getAnimations = () => runs.filter((run) => !run.cancelled && !run.finished);
  env.music.openAudio();
  env.ids.get("music-section-tree").click();
  assert.equal(runs.length, 1);
  const plain = (value) => JSON.parse(JSON.stringify(value)); // from the menu's own realm
  assert.deepEqual(plain(runs[0].frames), [{ width: "396px", height: "520px" }, { width: "900px", height: "640px" }]);
  assert.equal(runs[0].options.duration, 280); assert.equal(runs[0].id, "music-morph"); assert.equal(dropdown.dataset.morphing, "true");
  env.ids.get("music-section-more").click();
  assert.equal(runs.length, 1, "moving between sections of the same size animates nothing");
  runs[0].finished = true; runs[0].onfinish();
  assert.equal(dropdown.dataset.morphing, undefined, "the menu settles when the animation ends");
  env.ids.get("music-section-more").click();
  assert.equal(runs.length, 2); assert.deepEqual(plain(runs[1].frames), [{ width: "900px", height: "640px" }, { width: "396px", height: "520px" }], "folding eases back down");
  env.ids.get("music-section-tree").click();
  assert.equal(runs[1].cancelled, true, "a change while one is running takes over from it");
  assert.equal(runs.length, 3); assert.equal(dropdown.dataset.morphing, "true");
  env.window.matchMedia = () => ({ matches: true });
  env.ids.get("music-section-tree").click();
  assert.equal(dropdown.dataset.size, "compact"); assert.equal(runs.length, 3, "with reduced motion the menu just switches");
  env.window.matchMedia = undefined; env.window.MefiMotion = { off: () => true };
  env.ids.get("music-section-tree").click(); assert.equal(dropdown.dataset.size, "full"); assert.equal(runs.length, 3, "and so does Studio's own motion switch");
  env.music.closeAudio(); assert.equal(runs.at(-1).cancelled, true, "closing the menu stops an animation still running");
});

test("Typing in the menu goes to the Browse box while a video source shows, and to nothing on the others", () => {
  const env = environment(); env.music.openAudio();
  const dropdown = env.ids.get("music-dropdown"), box = env.ids.get("music-link-url");
  assert.equal(env.typeScopes.length, 1); const [scoped, resolve] = env.typeScopes[0];
  assert.equal(scoped, dropdown); assert.equal(dropdown.dataset.typeScope, "");
  assert.equal(box.dataset.typeHere, "", "the Browse box is where typing lands"); assert.equal(box.parentElement.parentElement.dataset.typeScope, "");
  assert.equal(resolve(), null, "on Music the card has no box to type into"); assert.equal(dropdown.dataset.size, "compact");
  env.music.setSource("link");
  assert.equal(resolve(), box, "on Video, typing on the folded card opens Browse and names its box");
  assert.equal(dropdown.dataset.size, "full"); assert.equal(dropdown.dataset.section, "browse");
  env.music.closeAudio(); env.music.openAudio(); assert.equal(env.typeScopes.length, 1, "the menu registers once, however often it opens");
});

test("Friends › Playground's Friends & listening rooms opens the media menu on More, where Listen together lives", async () => {
  const hub = await readFile(new URL("../renderer/companion-hub.js", import.meta.url), "utf8");
  const action = /button\("Friends & listening rooms", \(\) => \{([^}]*)\}, "ghost"\)/.exec(hub);
  assert.ok(action, "the Friends page keeps its Friends & listening rooms button");
  const calls = [...action[1].matchAll(/window\.MefiMusic\?\.(\w+)\?\.\(([^)]*)\)/g)].map((match) => [match[1], match[2] ? JSON.parse(match[2]) : undefined]);
  assert.deepEqual(calls, [["openAudio", undefined], ["setSource", "link"], ["openSection", "more"]], "it opens the menu on Video, then on More");
  // Those calls, made on the menu itself, land on More with Listen together inside it.
  const env = environment();
  for (const [name, argument] of calls) env.music[name](argument);
  assert.equal(env.ids.get("music-dropdown").hidden, false); assert.equal(env.ids.get("music-dropdown").dataset.section, "more");
  assert.equal(env.ids.get("music-more").hidden, false); assert.equal(env.ids.get("music-more").contains(env.music.togetherHost()), true);
  assert.doesNotMatch(hub, /togetherHost\(\)\?\.scrollIntoView/, "it no longer scrolls a host that lives in a section");
});

// ---- Browse: the YouTube feed. `page` builds a list of results with ids v0000000000, v0000000001, ...
const page = (from, count) => Array.from({ length: count }, (_, index) => ({ id: `v${String(from + index).padStart(10, "0")}`, title: `Video ${from + index}`, channel: "A channel", duration: "3:12" }));
const cardsOf = (env) => env.ids.get("music-youtube-results").children;
const feedTitleOf = (env) => findAll(env.document.body, (node) => node.className === "music-feed-head")[0].children[0].textContent;
const ideasOf = (env) => findAll(env.document.body, (node) => node.className === "ghost music-feed-idea");
const plain = (value) => JSON.parse(JSON.stringify(value)); // a value from the menu's own realm

test("Browse lists videos like the playing one, then pages on as the end scrolls into view, without repeats or overlapping requests", async () => {
  const asked = [];
  const env = environment({ intersection: true, bridge: { youtubeSearch: async (request) => {
    asked.push(request);
    if (request.related) return { ok: true, results: page(0, 3), more: "token-1" };
    if (request.more === "token-1") return { ok: true, results: page(2, 3), more: "token-2" };
    if (request.more === "token-2") return { ok: true, results: page(5, 1), more: null };
    return { ok: false, error: "unexpected" };
  } } });
  env.music.playLink(`https://youtu.be/${YT}`);
  env.music.openSection("browse"); await flush();
  assert.deepEqual(plain(asked), [{ related: YT }], "Browse opens on videos like the one that is playing");
  assert.equal(cardsOf(env).length, 3);
  assert.equal(feedTitleOf(env), "More like this video");
  assert.equal(feedNoteOf(env).textContent, "3 videos · click to add, drag onto Up next to place it · scroll for more.");
  const end = findAll(env.document.body, (node) => node.className === "music-feed-end")[0];
  assert.equal(end.hidden, false);
  assert.equal(env.observers.length, 1); assert.deepEqual(env.observers[0].targets, [end], "the list's end is what is watched");
  assert.equal(env.observers[0].options.root, env.ids.get("music-deck"), "against the deck that scrolls");
  env.reach(); env.reach(); await flush();
  assert.equal(asked.length, 2, "two nudges at once make one request");
  assert.deepEqual(plain(asked[1]), { more: "token-1" });
  assert.deepEqual(cardsOf(env).map((card) => card.dataset.key), [0, 1, 2, 3, 4].map((index) => page(index, 1)[0].id), "a video the next page repeats is listed once");
  assert.equal(feedNoteOf(env).textContent, "5 videos · click to add, drag onto Up next to place it · scroll for more.");
  env.reach(); await flush();
  assert.equal(cardsOf(env).length, 6); assert.equal(end.hidden, true, "no token, no more to wait for");
  assert.equal(feedNoteOf(env).textContent, "6 videos · click to add, drag onto Up next to place it.");
  env.reach(); await flush(); assert.equal(asked.length, 3, "the last page leaves nothing to ask for");
  assert.equal(feedTitleOf(env), "More like this video", "paging keeps the list's title");
});

test("Browse pages only while it is on show, and a new search starts a list of its own", async () => {
  const asked = [];
  const env = environment({ intersection: true, bridge: { youtubeSearch: async (request) => {
    asked.push(request);
    return typeof request === "string" ? { ok: true, results: page(request === "first" ? 0 : 50, 2), more: `more-${request}` } : { ok: true, results: page(80, 2), more: null };
  } } });
  const box = env.ids.get("music-link-url");
  env.music.setSource("link"); // the Browse box lives on the Video source
  box.value = "first"; env.ids.get("music-link-load").click(); await flush();
  assert.equal(feedTitleOf(env), "Results for “first”"); assert.equal(cardsOf(env).length, 2);
  env.ids.get("music-section-more").click(); env.reach(); await flush();
  assert.equal(asked.length, 1, "a section that is not Browse asks for nothing");
  env.ids.get("music-section-more").click(); env.ids.get("music-dropdown-expand").click();
  env.music.closeAudio(); env.reach(); await flush();
  assert.equal(asked.length, 1, "nor does a closed menu");
  env.music.openSection("browse"); env.reach(); await flush();
  assert.deepEqual(plain(asked.at(-1)), { more: "more-first" }); assert.equal(cardsOf(env).length, 4);
  box.value = "second"; env.ids.get("music-link-load").click(); await flush();
  assert.equal(feedTitleOf(env), "Results for “second”");
  assert.deepEqual(cardsOf(env).map((card) => card.dataset.key), [page(50, 1)[0].id, page(51, 1)[0].id], "a new search replaces the list instead of adding to it");
  env.reach(); await flush(); assert.deepEqual(plain(asked.at(-1)), { more: "more-second" }, "and pages on from its own token");
});

test("A new search replaces a slow one: the older answer, arriving late, is dropped", async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const pending = [];
    const env = environment({ bridge: { youtubeSearch: (request) => new Promise((resolve) => pending.push({ request, resolve })) } });
    const box = env.ids.get("music-link-url"), go = env.ids.get("music-link-load");
    env.music.setSource("link");
    box.value = "alpha"; go.click(); box.value = "beta"; go.click();
    assert.deepEqual(plain(pending.map((entry) => entry.request)), ["alpha", "beta"]);
    // alpha's answer has two videos, beta's three; each order of arrival ends on beta's.
    const answers = [() => pending[0].resolve({ ok: true, results: page(0, 2) }), () => pending[1].resolve({ ok: true, results: page(10, 3) })];
    for (const index of order) { answers[index](); await flush(); }
    assert.equal(feedTitleOf(env), "Results for “beta”", `answered ${order}`);
    assert.deepEqual(cardsOf(env).map((card) => card.dataset.key), [10, 11, 12].map((index) => page(index, 1)[0].id), `only the newest search's answer is shown (${order})`);
  }
  const failing = []; const env = environment({ bridge: { youtubeSearch: (request) => new Promise((resolve, reject) => failing.push({ request, resolve, reject })) } });
  env.music.setSource("link");
  env.ids.get("music-link-url").value = "alpha"; env.ids.get("music-link-load").click();
  env.ids.get("music-link-url").value = "beta"; env.ids.get("music-link-load").click();
  failing[1].resolve({ ok: true, results: page(0, 2) }); await flush();
  failing[0].reject(new Error("late trouble")); await flush();
  assert.equal(feedNoteOf(env).textContent.includes("late trouble"), false, "a superseded search that fails says nothing");
  assert.equal(cardsOf(env).length, 2);
});

test("Browse says so when YouTube cannot be reached, finds nothing, or is not part of this build, and only ever lists well-formed videos", async () => {
  const failing = environment({ bridge: { youtubeSearch: async () => ({ ok: false, error: "YouTube is unavailable right now. Try again, or paste a video link." }) } });
  failing.ids.get("music-link-url").value = "lofi"; failing.ids.get("music-link-load").click(); await flush();
  assert.equal(feedNoteOf(failing).textContent, "YouTube is unavailable right now. Try again, or paste a video link."); assert.equal(cardsOf(failing).length, 0);
  const empty = environment({ bridge: { youtubeSearch: async () => ({ ok: true, results: [] }) } });
  empty.ids.get("music-link-url").value = "nothing here"; empty.ids.get("music-link-load").click(); await flush();
  assert.equal(feedNoteOf(empty).textContent, "No videos found. Try another search.");
  const bare = environment();
  bare.ids.get("music-link-url").value = "lofi"; bare.ids.get("music-link-load").click(); await flush();
  assert.equal(feedNoteOf(bare).textContent, "Restart Studio to browse YouTube here.");
  const blank = environment({ bridge: { youtubeSearch: async () => { throw new Error("must not be asked"); } } });
  blank.ids.get("music-link-url").value = "   "; blank.ids.get("music-link-load").click(); await flush();
  assert.equal(blank.document.activeElement, blank.ids.get("music-link-url"), "an empty box only takes the caret");
  const rough = [...page(0, 45), { id: "short", title: "Bad id" }, { id: "v0000000900", title: 7 }, null, "text", { id: "v0000000901", title: "T".repeat(300), channel: "C".repeat(300), duration: "9".repeat(40) }, { id: "v0000000902" }];
  const tidy = environment({ bridge: { youtubeSearch: async () => ({ ok: true, results: rough, more: "x".repeat(9000) }) } });
  tidy.ids.get("music-link-url").value = "rough"; tidy.ids.get("music-link-load").click(); await flush();
  assert.equal(cardsOf(tidy).length, 40, "a page shows at most forty videos");
  assert.ok(cardsOf(tidy).every((card) => /^[\w-]{11}$/.test(card.dataset.key)));
  const long = environment({ bridge: { youtubeSearch: async () => ({ ok: true, results: [{ id: "v0000000901", title: "T".repeat(300), channel: "C".repeat(300), duration: "9".repeat(40) }], more: "x".repeat(9000) }) } });
  long.ids.get("music-link-url").value = "long"; long.ids.get("music-link-load").click(); await flush();
  const words = cardsOf(long)[0].children[0];
  assert.equal(words.children[1].textContent.length, 200, "a title is cut at 200 characters");
  assert.equal(words.children[2].textContent.length, 120, "a channel at 120");
  assert.equal(words.children[0].children[1].textContent.length, 20, "a length at 20");
  assert.equal(findAll(long.document.body, (node) => node.className === "music-feed-end")[0].hidden, true, "an oversize token is not kept");
});

test("Each video card shows a thumbnail from the validated id, plays or queues on a click, and marks what is playing and what waits", async () => {
  const env = environment({ bridge: { youtubeSearch: async () => ({ ok: true, results: page(0, 4) }) } });
  const box = env.ids.get("music-link-url");
  box.value = "cards"; env.ids.get("music-link-load").click(); await flush();
  const card = (index) => cardsOf(env)[index], id = (index) => page(index, 1)[0].id, mark = (index) => card(index).dataset.state || "";
  const picture = findAll(card(0), (node) => node.tagName === "img")[0];
  assert.equal(picture.src, `https://i.ytimg.com/vi/${id(0)}/mqdefault.jpg`); assert.equal(picture.loading, "lazy"); assert.equal(picture.draggable, false);
  assert.equal(findAll(card(0), (node) => node.className === "music-yt-time")[0].textContent, "3:12", "the length sits on the picture");
  picture.dispatch("error"); assert.equal(picture.hidden, true, "a picture that does not load leaves the quiet tile");
  assert.match(card(0).title, /click to play it; drag it onto Up next to place it$/);
  assert.equal(card(0).children.slice(1).map((node) => node.attrs["aria-label"]).join("|"), "Play Video 0 now|Add Video 0 to queue|Queue Video 0 next");
  // With nothing on, a click plays; the search stays in the box.
  card(0).dispatch("click", { target: card(0).children[0] });
  assert.equal(env.music.linkElement().url, `https://www.youtube.com/watch?v=${id(0)}`); assert.equal(box.value, "cards");
  assert.equal(mark(0), "playing"); assert.equal(mark(1), "");
  assert.match(card(1).title, /click to add it to Up next/);
  // With something on, a click lines the video up behind it, and the card says so.
  card(1).dispatch("click", { target: card(1).children[0] });
  assert.equal(env.music.linkElement().url, `https://www.youtube.com/watch?v=${id(0)}`, "the playing video is not interrupted");
  assert.equal(mark(1), "queued"); assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1"))[0].url, `https://www.youtube.com/watch?v=${id(1)}`);
  card(0).dispatch("click", { target: card(0).children[0] });
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1")).length, 1, "clicking the video that is playing adds nothing");
  // A click on a card's own buttons is theirs: it does not also pick the card.
  card(2).dispatch("click", { target: card(2).children[2] });
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1")).length, 1);
  card(2).children[2].click(); assert.equal(mark(2), "queued"); assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1")).length, 2);
  card(3).children[3].click(); assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1"))[0].url, `https://www.youtube.com/watch?v=${id(3)}`, "Queue next goes to the front");
  // Playing the queued video takes its mark from the queue and gives it to the player.
  env.ids.get("music-link-queue-next").click();
  assert.equal(mark(3), "playing"); assert.equal(mark(0), "", "the video that finished is no longer marked");
  // Removing a queued video takes its mark away.
  env.ids.get("music-link-queue-list").children[0].children[1].children[2].click();
  assert.equal(mark(1), "");
  // Closing the video makes the hint true again: with nothing on, a click plays.
  env.ids.get("music-link-close").click();
  assert.match(card(1).title, /click to play it; drag it onto Up next to place it$/); assert.equal(mark(3), "");
});

test("Browse's ideas start a search, and the playing YouTube video adds a way to more like it", async () => {
  const asked = [];
  const env = environment({ bridge: { youtubeSearch: async (request) => { asked.push(request); return { ok: true, results: page(0, 2) }; } } });
  env.music.openSection("browse");
  assert.deepEqual(ideasOf(env).map((idea) => idea.textContent), ["lofi beats", "synthwave", "jazz for work", "ambient focus", "piano covers", "nature 4K", "retro game music", "deep house"], "with nothing playing, ideas to start from");
  ideasOf(env)[2].click(); await flush();
  assert.equal(asked.at(-1), "jazz for work"); assert.equal(env.ids.get("music-link-url").value, "jazz for work");
  assert.equal(feedTitleOf(env), "Results for “jazz for work”");
  env.music.playLink(`https://youtu.be/${YT}`);
  assert.equal(ideasOf(env)[0].textContent, "More like this video"); assert.equal(ideasOf(env)[0].dataset.kind, "related");
  ideasOf(env)[0].click(); await flush();
  assert.deepEqual(plain(asked.at(-1)), { related: YT }); assert.equal(feedTitleOf(env), "More like this video");
  env.music.playLink("https://example.com/clip.mp4");
  assert.deepEqual(ideasOf(env).map((idea) => idea.dataset.kind), Array(8).fill(undefined), "a video file has no more like it to ask for");
  env.ids.get("music-link-close").click();
  assert.equal(ideasOf(env).length, 8, "closing the video leaves the ideas");
});

// ---- Drag and drop: a card onto Up next, a row within it, either onto the card.
// A stand-in for a DataTransfer, and a helper that fires one drag event and reports what the menu did with it.
const transfer = (data = {}) => {
  const store = new Map(Object.entries(data));
  const carrier = { types: [...store.keys()], effectAllowed: "", dropEffect: "", setData(type, value) { store.set(type, String(value)); carrier.types = [...store.keys()]; }, getData: (type) => store.get(type) ?? "" };
  return carrier;
};
const fire = (node, type, detail = {}) => { const result = { prevented: false, stopped: false }; node.dispatch(type, { ...detail, preventDefault: () => { result.prevented = true; }, stopPropagation: () => { result.stopped = true; } }); return result; };
// Rows have no layout here: each is 40 px tall, one under another, so a row's middle is at 20, 60, 100, ...
const layoutRows = (env) => env.ids.get("music-link-queue-list").children.forEach((row, index) => { row.getBoundingClientRect = () => ({ top: index * 40, height: 40 }); });
const queuedNames = (env) => JSON.parse(env.storage.get("mefiStudio.mediaQueue.v1")).map((item) => item.title);
const saved = (...names) => names.map((name) => ({ url: `https://example.com/${name.toLowerCase()}.mp4`, title: name }));

test("A card dragged onto Up next lands exactly where it is dropped, and the box shows where", async () => {
  const env = environment({ queueSaved: saved("A", "B", "C"), bridge: { youtubeSearch: async () => ({ ok: true, results: page(0, 3) }) } });
  env.music.setSource("link");
  env.ids.get("music-link-url").value = "cards"; env.ids.get("music-link-load").click(); await flush();
  const dropdown = env.ids.get("music-dropdown"), list = env.ids.get("music-link-queue-list"), box = list.parentElement, card = cardsOf(env)[1];
  const url = `https://www.youtube.com/watch?v=${page(1, 1)[0].id}`;
  layoutRows(env);
  const carried = transfer();
  fire(card, "dragstart", { dataTransfer: carried });
  assert.deepEqual(carried.types.toSorted(), ["application/x-mefi-media", "text/plain", "text/uri-list"], "a card carries its video, as a link too, and no place in the queue");
  assert.deepEqual(JSON.parse(carried.getData("application/x-mefi-media")), { url, title: "Video 1" });
  assert.equal(carried.getData("text/uri-list"), url); assert.equal(carried.effectAllowed, "copy"); assert.equal(dropdown.dataset.dragging, "media");
  assert.equal(card.draggable, true);
  const over = fire(box, "dragover", { dataTransfer: carried, clientY: 50 });
  assert.equal(over.prevented, true); assert.equal(carried.dropEffect, "copy");
  assert.equal(list.children[1].dataset.drop, "before", "the row the card would go before is marked"); assert.equal(box.dataset.drop, "row");
  fire(box, "dragover", { dataTransfer: carried, clientY: 500 });
  assert.equal(list.children[1].dataset.drop, undefined, "the mark follows the pointer"); assert.equal(box.dataset.drop, "end", "past the last row it goes to the end");
  fire(box, "dragleave", { relatedTarget: env.document.body }); assert.equal(box.dataset.drop, "", "leaving the box clears the mark");
  fire(box, "dragleave", { relatedTarget: list.children[0] }); // moving between rows is not leaving
  const dropped = fire(box, "drop", { dataTransfer: carried, clientY: 50 });
  assert.deepEqual(queuedNames(env), ["A", "Video 1", "B", "C"], "dropped between A and B");
  assert.equal(dropped.prevented, true); assert.equal(dropped.stopped, true); assert.equal(box.dataset.drop, "");
  assert.equal(noticeOf(env).textContent, "Video 1 is number 2 in Up next.");
  layoutRows(env);
  fire(box, "drop", { dataTransfer: carried, clientY: 5 });
  assert.equal(queuedNames(env)[0], "Video 1"); assert.equal(noticeOf(env).textContent, "Video 1 will play next.", "dropped at the top");
  layoutRows(env);
  fire(box, "drop", { dataTransfer: carried, clientY: 900 });
  assert.equal(queuedNames(env).at(-1), "Video 1", "dropped past the last row");
  assert.equal(queuedNames(env).length, 6);
  fire(card, "dragend", { dataTransfer: carried });
  assert.equal(dropdown.dataset.dragging, undefined, "the menu stops showing a drag"); assert.equal(box.dataset.drop, "");
  assert.equal(card.dataset.state, "queued", "the card is marked as waiting");
});

test("Up next takes a link dragged in from Discord or a browser, and ignores files, plain words and what cannot be queued", () => {
  const env = environment({ queueSaved: saved("A", "B") });
  const list = env.ids.get("music-link-queue-list"), box = list.parentElement;
  layoutRows(env);
  const foreign = transfer({ "text/uri-list": "# from Discord\r\nhttps://example.com/discord.mp4\r\n" });
  assert.equal(fire(box, "dragover", { dataTransfer: foreign, clientY: 30 }).prevented, true, "a link may be dropped here");
  fire(box, "drop", { dataTransfer: foreign, clientY: 30 });
  assert.deepEqual(queuedNames(env), ["A", "Video file · discord.mp4", "B"], "it is queued where it lands, under the name its link gives it");
  // A browser only sends the drop where the dragover was accepted, so what is refused there never arrives.
  for (const rejected of [transfer({ Files: "" }), transfer({ "text/plain": "just words" }), transfer({})]) {
    assert.equal(fire(box, "dragover", { dataTransfer: rejected, clientY: 30 }).prevented, false, JSON.stringify(rejected.types));
    fire(box, "drop", { dataTransfer: rejected, clientY: 30 });
  }
  assert.equal(queuedNames(env).length, 3, "and even a drop that did arrive queues nothing");
  fire(box, "drop", { dataTransfer: transfer({ "text/uri-list": "https://example.com/some-page" }), clientY: 30 });
  assert.equal(queuedNames(env).length, 3, "a page is not a video");
  assert.equal(noticeOf(env).dataset.error, "true"); assert.match(noticeOf(env).textContent, /playable media link/);
  const full = environment({ queueSaved: Array.from({ length: 50 }, (_, index) => ({ url: `https://example.com/${index}.mp4`, title: `N${index}` })) });
  fire(full.ids.get("music-link-queue-list").parentElement, "drop", { dataTransfer: transfer({ "text/uri-list": "https://example.com/extra.mp4" }), clientY: 0 });
  assert.equal(queuedNames(full).length, 50, "the queue holds fifty and no more"); assert.equal(noticeOf(full).dataset.error, "true");
});

test("Dragging a row of Up next reorders it, and dropping it where it is, or right after itself, changes nothing", () => {
  const env = environment({ queueSaved: [...saved("A", "B", "C"), { url: `https://www.youtube.com/watch?v=${YT}`, title: "D" }] });
  const list = env.ids.get("music-link-queue-list"), box = list.parentElement, dropdown = env.ids.get("music-dropdown");
  assert.deepEqual(list.children.map((row) => row.dataset.thumb), ["false", "false", "false", "true"], "a YouTube row shows its picture, the others a quiet tile");
  const move = (from, y) => {
    layoutRows(env);
    const carried = transfer(), row = list.children[from];
    fire(row, "dragstart", { dataTransfer: carried });
    assert.equal(carried.getData("application/x-mefi-queue"), String(from)); assert.equal(carried.effectAllowed, "move"); assert.equal(dropdown.dataset.dragging, "queue");
    assert.equal(fire(box, "dragover", { dataTransfer: carried, clientY: y }).prevented, true); assert.equal(carried.dropEffect, "move");
    fire(box, "drop", { dataTransfer: carried, clientY: y });
    fire(row, "dragend", { dataTransfer: carried });
    assert.equal(dropdown.dataset.dragging, undefined);
    return queuedNames(env).join("");
  };
  assert.equal(move(0, 900), "BCDA", "the first row dragged past the last goes to the end");
  assert.equal(move(3, 5), "ABCD", "and back to the top");
  assert.equal(move(1, 45), "ABCD", "dropped back where it was");
  assert.equal(move(1, 70), "ABCD", "or right after itself");
  assert.equal(move(1, 130), "ACBD", "dragged down over one row");
  assert.equal(move(2, 5), "BACD", "dragged up to the top");
  assert.equal(list.children.length, 4, "a move never adds or drops a row");
  // Its place was read when the drag began. If the queue changed since, the row is found again by its link.
  const shifted = environment({ queueSaved: saved("A", "B", "C", "D") });
  const carried = transfer(); layoutRows(shifted);
  const rows = shifted.ids.get("music-link-queue-list").children;
  fire(rows[2], "dragstart", { dataTransfer: carried });
  shifted.ids.get("music-link-queue-next").click(); // a video ends and takes the head while the drag is under way
  layoutRows(shifted);
  fire(shifted.ids.get("music-link-queue-list").parentElement, "drop", { dataTransfer: carried, clientY: 5 });
  assert.deepEqual(queuedNames(shifted), ["C", "B", "D"], "C, not the row that took its place, is the one that moves");
  const gone = environment({ queueSaved: saved("A", "B", "C") });
  const lost = transfer(); layoutRows(gone);
  fire(gone.ids.get("music-link-queue-list").children[0], "dragstart", { dataTransfer: lost });
  gone.ids.get("music-link-queue-next").click(); layoutRows(gone);
  fire(gone.ids.get("music-link-queue-list").parentElement, "drop", { dataTransfer: lost, clientY: 900 });
  assert.deepEqual(queuedNames(gone), ["B", "C"], "a row that has since left the queue is not copied back into it");
});

test("A video dropped on the card plays now, and a row dropped there leaves Up next as it plays", async () => {
  const env = environment({ queueSaved: saved("A", "B", "C"), bridge: { youtubeSearch: async () => ({ ok: true, results: page(0, 2) }) } });
  env.music.setSource("link");
  env.ids.get("music-link-url").value = "cards"; env.ids.get("music-link-load").click(); await flush();
  const nowCard = findAll(env.document.body, (node) => node.className === "music-now-card")[0], list = env.ids.get("music-link-queue-list");
  layoutRows(env);
  const carried = transfer(); fire(cardsOf(env)[0], "dragstart", { dataTransfer: carried });
  assert.equal(fire(nowCard, "dragover", { dataTransfer: carried }).prevented, true); assert.equal(carried.dropEffect, "copy"); assert.equal(nowCard.dataset.drop, "true");
  fire(nowCard, "dragleave", { relatedTarget: env.document.body }); assert.equal(nowCard.dataset.drop, undefined);
  for (const ignored of [transfer({ Files: "" }), transfer({ "text/uri-list": "https://example.com/x.mp4" })]) assert.equal(fire(nowCard, "dragover", { dataTransfer: ignored }).prevented, false, "only a video from the menu is dropped here");
  const played = fire(nowCard, "drop", { dataTransfer: carried });
  assert.equal(env.music.linkElement().url, `https://www.youtube.com/watch?v=${page(0, 1)[0].id}`); assert.equal(played.prevented, true);
  assert.equal(nowCard.dataset.drop, undefined); assert.deepEqual(queuedNames(env), ["A", "B", "C"], "playing a card does not touch Up next");
  assert.equal(env.ids.get("music-link-url").value, "cards", "and keeps the search in the box");
  const row = transfer(); fire(list.children[1], "dragstart", { dataTransfer: row });
  fire(nowCard, "drop", { dataTransfer: row });
  assert.equal(env.music.linkElement().url, "https://example.com/b.mp4"); assert.deepEqual(queuedNames(env), ["A", "C"], "the row that was dropped is taken out of the queue as it plays");
  const stale = transfer({ "application/x-mefi-media": JSON.stringify({ url: "https://example.com/c.mp4", title: "C" }), "application/x-mefi-queue": "0" });
  fire(nowCard, "drop", { dataTransfer: stale });
  assert.equal(env.music.linkElement().url, "https://example.com/c.mp4"); assert.deepEqual(queuedNames(env), ["A", "C"], "a row whose place has changed plays without a queue row being taken");
});

test("Playlists: its section and Save buttons appear once renderer/playlists.js registers, and a list plays and lines up through the player", async () => {
  const env = environment({ mediaWindow: true, queueSaved: [{ url: "https://example.com/waiting.mp4", title: "Waiting" }], bridge: { youtubeSearch: async () => ({ ok: true, results: [{ id: YT, title: "First", channel: "One", duration: "3:10" }, { id: "M7lc1UVf-VE", title: "Second" }] }) } });
  env.music.openAudio(env.ids.get("settings-audio-open"));
  assert.equal(env.ids.get("music-section-playlists"), undefined, "without playlists.js there is no section");
  assert.equal(env.ids.get("music-video-save").hidden, true);
  const saves = [], shown = [];
  let open = true;
  const hands = env.music.playlists({ save: (anchor, item) => saves.push({ ...item }), dismiss: () => { const was = open; open = false; return was; }, offer: () => false, shown: () => shown.push(true) });
  assert.equal(hands.host, env.ids.get("music-playlists"));
  assert.ok(env.ids.get("music-section-playlists"), "the section joins the tabs");
  env.music.openSection("playlists");
  assert.equal(env.ids.get("music-playlists").hidden, false); assert.ok(shown.length, "and is told when it shows");
  // A list starts at its first video; the rest go ahead of what was waiting,
  // and what the player can't take is left out.
  hands.play([{ url: `https://youtu.be/${YT}`, title: "One" }, { url: "https://example.com/two.mp4", title: "Two" }, { url: "javascript:alert(1)" }, { url: "https://example.com/three.mp4", title: "" }], "Mix");
  assert.equal(env.music.linkElement().url, `https://www.youtube.com/watch?v=${YT}`);
  assert.deepEqual(queuedNames(env), ["Two", "Video file · three.mp4", "Waiting"]);
  assert.equal(hands.queue([{ url: "https://example.com/four.mp4", title: "Four" }], "Mix"), 1);
  assert.equal(queuedNames(env).at(-1), "Four");
  const many = Array.from({ length: 60 }, (_, i) => ({ url: `https://example.com/v${i}.mp4`, title: `V${i}` }));
  assert.equal(hands.queue(many), 46, "Up next still holds fifty");
  assert.equal(queuedNames(env).length, 50);
  assert.equal(hands.queue(many), 0);
  // Save, on the playing card and on each Browse card.
  const saveNow = env.ids.get("music-video-save");
  assert.equal(saveNow.hidden, false);
  saveNow.click();
  assert.deepEqual(saves.at(-1), { url: `https://www.youtube.com/watch?v=${YT}`, title: "One", channel: "" });
  env.ids.get("music-link-url").value = "quiet"; env.ids.get("music-link-load").click(); await flush();
  const card = env.ids.get("music-youtube-results").children[0];
  assert.equal(card.children[4].attrs["aria-label"], "Save First to a playlist");
  card.children[4].click();
  assert.deepEqual(saves.at(-1), { url: `https://www.youtube.com/watch?v=${YT}`, title: "First", channel: "One", duration: "3:10" });
  // Escape closes the Save list first, then the menu.
  const dropdown = env.ids.get("music-dropdown");
  dropdown.dispatch("keydown", { key: "Escape" }); assert.equal(dropdown.hidden, false);
  dropdown.dispatch("keydown", { key: "Escape" }); assert.equal(dropdown.hidden, true);
});

test("Playlists: More › This menu turns the section, its Save buttons and the Browse hand-off off, and the choice is kept", async () => {
  const env = environment({ mediaWindow: true });
  env.music.openAudio(env.ids.get("settings-audio-open"));
  const switchBox = env.ids.get("music-playlists-switch");
  assert.equal(switchBox.parentElement.hidden, true, "no switch without playlists.js");
  const offered = [];
  env.music.playlists({ save() {}, dismiss: () => false, offer: (text) => offered.push(text) > 0, shown() {} });
  assert.equal(switchBox.parentElement.hidden, false); assert.equal(switchBox.checked, true);
  env.music.playLink(`https://www.youtube.com/watch?v=${YT}`);
  env.music.openSection("playlists");
  assert.equal(env.ids.get("music-dropdown").dataset.section, "playlists");
  switchBox.checked = false; switchBox.dispatch("change");
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaMenu.v1")).playlists, false);
  assert.notEqual(env.ids.get("music-dropdown").dataset.section, "playlists", "the deck leaves the section");
  assert.equal(env.ids.get("music-playlists").hidden, true);
  assert.equal(env.ids.get("music-video-save").hidden, true);
  assert.equal(env.ids.get("music-dropdown").dataset.playlists, "false");
  env.music.openSection("browse");
  env.ids.get("music-link-url").value = `Mefi Studio playlist: Mix 1. One <https://youtu.be/${YT}>`;
  env.ids.get("music-link-load").click();
  assert.equal(offered.length, 0, "Browse keeps what is typed in it");
  const restored = environment({ menuSaved: JSON.parse(env.storage.get("mefiStudio.mediaMenu.v1")) });
  restored.music.playlists({ save() {}, dismiss: () => false, offer: () => false, shown() {} });
  assert.equal(restored.ids.get("music-playlists-switch").checked, false, "off survives a restart");
  assert.equal(restored.music.openSection("playlists") === "playlists", false);
});

test("Playlists: a shared list typed into Browse goes to Playlists, and Find more searches without changing what plays", async () => {
  const asked = [];
  const env = environment({ bridge: { youtubeSearch: async (query) => { asked.push(query); return { ok: true, results: [{ id: YT, title: `About ${query}` }] }; } } });
  env.music.openAudio(env.ids.get("settings-audio-open"));
  const offered = [];
  const hands = env.music.playlists({ save() {}, dismiss: () => false, offer: (text) => { offered.push(text); return text.startsWith("Mefi Studio playlist:"); }, shown() {} });
  await hands.browse("2swap");
  assert.equal(env.music.status().source, "local", "the music source stays as it was");
  assert.equal(env.ids.get("music-dropdown").dataset.section, "browse");
  assert.deepEqual(asked, ["2swap"]);
  env.music.setSource("link"); env.music.openSection("browse");
  const box = env.ids.get("music-link-url");
  box.value = `Mefi Studio playlist: Mix 1. One <https://youtu.be/${YT}> 2. Two <https://youtu.be/M7lc1UVf-VE>`;
  env.ids.get("music-link-load").click(); await flush();
  assert.equal(offered.length, 1); assert.equal(box.value, "", "the box is handed over, not searched");
  assert.deepEqual(asked, ["2swap"]);
});
