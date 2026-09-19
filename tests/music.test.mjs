import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/music.js", import.meta.url), "utf8");
const pure = vm.createContext({ URL });
vm.runInContext(`${source.slice(source.indexOf("  const THEMES"), source.indexOf("  let stored;"))}\nthis.api = {spotifyLink, safePreferences, audioFile, nextIndex, timeLabel};`, pure);
const helpers = pure.api;
const flush = async () => { for (let index = 0; index < 15; index += 1) await Promise.resolve(); };

function environment({ saved = null, recommend } = {}) {
  const ids = new Map();
  const events = [];
  const revoked = [];
  const opened = [];
  const styles = new Map();
  const storage = new Map(saved ? [["mefiStudio.music.v1", JSON.stringify(saved)]] : []);
  let audio;
  let blob = 0;
  let document;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.style = { setProperty: (key, value) => styles.set(key, value) }; this.classList = { add() {}, remove() {} }; this.hidden = false; this.disabled = false; this.value = ""; }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    removeAttribute(key) { delete this.attrs[key]; if (key === "src") this.src = ""; }
    addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
    dispatch(key, payload = {}) { for (const fn of this.listeners[key] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...payload }); }
    click() { if (!this.disabled) this.dispatch("click"); }
    focus() { document.activeElement = this; }
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
    window: { dispatchEvent: (event) => events.push(event), addEventListener() {}, open: (url) => opened.push(url), MefiNav: { claim() {}, release() {} }, mefiStudio: { ...(recommend ? { musicRecommend: recommend } : {}), openExternal: (url) => { opened.push(url); return Promise.resolve(); } } },
  });
  vm.runInContext(source, context);
  const music = context.window.MefiMusic;
  music.init();
  return { music, ids, events, revoked, opened, styles, storage, document, audio };
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
  assert.deepEqual(Object.keys(value).sort(), ["spotify", "theme", "volume"]);
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
