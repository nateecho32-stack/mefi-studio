import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/together.js (Listen together and the now-playing share) in a vm,
// against a fake window.mefiStudio hub bridge, a fake MefiMusic Links player,
// hand-turned timers and clock, and a tiny DOM. Nothing here talks to a hub.

const source = await readFile(new URL("../renderer/together.js", import.meta.url), "utf8");
const T0 = 1_800_000_000_000;
const ME = { id: "111111111111111111", name: "Mefi" };
const AKSANA = { id: "222222222222222222", name: "Aksana" };
const YT = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const FILE = "https://cdn.discordapp.com/attachments/1/2/demo.mp4?ex=1";
const ROOMS = [
  { id: "room_lofi", name: "Lo-fi corner", status: "active", you: "member", ownerId: AKSANA.id },
  { id: "room_mine", name: "My room", status: "active", you: "owner", ownerId: ME.id },
  { id: "room_asked", name: "Asked to join", status: "active", you: "requested", ownerId: AKSANA.id },
  { id: "room_shut", name: "Closed", status: "closed", you: "member", ownerId: AKSANA.id },
];
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function session(overrides = {}) {
  return { id: "lis_1", url: YT, label: "YouTube video", title: null, provider: "youtube", host: AKSANA, playing: true, positionMs: 30_000, startedAt: T0, updatedAt: T0, ...overrides };
}

function environment({ status = {}, saved = null, search = "", bridge: bridgeOn = true, listen = () => ({ ok: true }) } = {}) {
  let now = T0;
  let seq = 0;
  const timers = new Map();
  const listeners = new Map();
  const storage = new Map(saved ? [["mefiStudio.together.v1", JSON.stringify(saved)]] : []);
  const calls = [];
  let hubStatus = { configured: true, communityConfigured: true, linked: true, state: "off", error: null, user: null, readOnly: false, paused: false, rooms: [], ...status };
  let onHub = null;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.className = ""; this.value = ""; }
    set id(value) { this._id = value; }
    get id() { return this._id; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
    dispatch(key, payload = {}) { for (const fn of this.listeners[key] || []) fn({ target: this, ...payload }); }
    click() { if (!this.disabled) this.dispatch("click"); }
  }
  const find = (id, node = host) => { if (node.id === id) return node; for (const child of node.children) { const hit = find(id, child); if (hit) return hit; } return null; };
  const host = new Element("section"); host.hidden = true;
  const player = { source: "local", link: null, title: "", playing: false, stationName: null, loaded: null, played: [] };
  function loadedFor(url) {
    if (url.endsWith(".mp4?ex=1")) {
      const media = new Element("video");
      Object.assign(media, { currentTime: 0, paused: true, play() { this.paused = false; calls.push(["video", "play"]); return Promise.resolve(); }, pause() { this.paused = true; calls.push(["video", "pause"]); } });
      return { url, kind: "media", provider: "discord", element: media };
    }
    const frame = new Element("iframe");
    frame.src = "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?rel=0&playsinline=1&enablejsapi=1";
    frame.contentWindow = { postMessage: (message, origin) => calls.push(["post", JSON.parse(message), origin]) };
    return { url, kind: "embed", provider: "youtube", element: frame };
  }
  const MefiMusic = {
    togetherHost: () => host,
    status: () => ({ source: player.source, link: player.link, title: player.title, playing: player.playing, stationName: player.stationName }),
    linkInfo: (raw) => raw === YT ? { provider: "youtube", providerName: "YouTube", kind: "embed", label: "YouTube video", url: YT, playable: true }
      : raw === FILE ? { provider: "discord", providerName: "Discord", kind: "media", label: "Discord attachment · demo.mp4", url: FILE, playable: true } : null,
    linkElement: () => player.loaded,
    playLink: (url, options) => { player.played.push([url, { ...options }]); player.source = "link"; player.link = url; player.title = MefiMusic.linkInfo(url).label; player.loaded = loadedFor(url); return true; },
  };
  const bridge = {
    hubStatus: async () => ({ ok: true, status: hubStatus }),
    hubConnect: async () => { calls.push(["connect"]); hubStatus = { ...hubStatus, state: "connecting" }; return { ok: true, status: hubStatus }; },
    hubDisconnect: async () => { calls.push(["disconnect"]); hubStatus = { ...hubStatus, state: "off" }; return { ok: true, status: hubStatus }; },
    hubRooms: async () => ({ ok: true, rooms: ROOMS }),
    hubSubscribe: async (roomId, on) => { calls.push(["subscribe", roomId, on]); return { ok: true }; },
    hubListen: async (payload) => { calls.push(["listen", { ...payload }]); return listen(payload); },
    hubNowPlaying: async (track) => { calls.push(["nowPlaying", track ? { ...track } : null]); return { ok: true }; },
    onHubEvent: (fn) => { onHub = fn; },
  };
  const context = vm.createContext({
    URL, JSON, Promise, Math, Number, String, Boolean, Array, Object,
    Date: { now: () => now },
    document: { readyState: "complete", createElement: (tag) => new Element(tag), addEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: {
      ...(bridgeOn ? { mefiStudio: bridge } : {}), MefiMusic, location: { search },
      addEventListener: (type, fn) => listeners.set(type, fn),
      setTimeout: (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
      clearInterval: (id) => timers.delete(id),
    },
  });
  vm.runInContext(source, context);
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      if (timer.every) timer.at += timer.every; else timers.delete(id);
      timer.fn();
      await flush();
    }
    now = end;
    await flush();
  };
  return {
    host, find, calls, player, storage, advance, context,
    hub: async (event) => { onHub?.(event); await flush(); },
    ready: async (user = ME) => { hubStatus = { ...hubStatus, state: "ready", user }; onHub?.({ type: "status", status: { ...hubStatus } }); await flush(); },
    emit: (type) => listeners.get(type)?.({}),
    together: context.window.MefiTogether,
    get now() { return now; }, set now(value) { now = value; },
    saved: () => JSON.parse(storage.get("mefiStudio.together.v1") || "null"),
  };
}
const kinds = (env, kind) => env.calls.filter((call) => call[0] === kind);

test("without the desktop bridge the section stays hidden", async () => {
  const env = environment({ bridge: false });
  await flush();
  assert.equal(env.host.hidden, true);
  assert.equal(env.host.children.length, 0);
});

test("it explains what is missing before anything connects", async () => {
  const unconfigured = environment({ status: { configured: false } });
  await flush();
  assert.equal(unconfigured.host.hidden, false);
  assert.match(unconfigured.find("music-together-connect").parentElement.parentElement.textContent, /isn't connected to one yet/);
  assert.equal(unconfigured.find("music-together-connect").hidden, true);
  assert.equal(unconfigured.find("music-share-nowplaying").disabled, true, "sharing needs the hub too");
  const unlinked = environment({ status: { linked: false } });
  await flush();
  assert.match(unlinked.host.textContent, /Link your Discord account/);
  assert.equal(kinds(unlinked, "connect").length, 0, "nothing connects on its own");
});

test("choosing a room connects, lists only rooms you are in, subscribes, and is remembered", async () => {
  const env = environment();
  await flush();
  env.find("music-together-connect").click(); await flush();
  assert.equal(kinds(env, "connect").length, 1);
  await env.ready();
  const select = env.find("music-together-room");
  assert.deepEqual(select.children.map((option) => option.value), ["", "room_lofi", "room_mine"], "requested and closed rooms are left out");
  select.value = "room_lofi"; select.dispatch("change"); await flush();
  assert.deepEqual(kinds(env, "subscribe").at(-1), ["subscribe", "room_lofi", true]);
  assert.deepEqual({ ...env.saved() }, { roomId: "room_lofi", following: false, share: false });
  assert.match(env.host.textContent, /Nothing is playing in Lo-fi corner/);
  select.value = "room_mine"; select.dispatch("change"); await flush();
  assert.deepEqual(kinds(env, "subscribe").slice(-2), [["subscribe", "room_lofi", false], ["subscribe", "room_mine", true]]);
});

test("a room's session shows who is playing, and Listen along joins it part-way through", async () => {
  const env = environment({ saved: { roomId: "room_lofi", following: false, share: false } });
  await flush();
  assert.equal(kinds(env, "connect").length, 1, "a saved room reconnects on launch");
  await env.ready();
  await env.hub({ type: "listen", roomId: "room_lofi", session: session(), sentAt: T0 + 1_000, receivedAt: env.now });
  const card = env.find("music-together-follow").parentElement.parentElement;
  assert.equal(card.hidden, false);
  assert.match(card.textContent, /Aksana is playing YouTube video/);
  assert.match(card.textContent, /On YouTube · playing at 0:31/);
  assert.equal(env.player.played.length, 0, "nothing plays until you listen along");
  assert.equal(env.find("music-together-toggle").hidden, true, "only the host or the room owner steers");
  env.now += 4_000;
  env.find("music-together-follow").click(); await flush();
  assert.deepEqual(env.player.played, [[YT, { autoplay: true, startMs: 35_000 }]], "30 s at the change, 1 s on the hub, 4 s here");
  assert.equal(env.saved().following, true);
  await env.hub({ type: "listen", roomId: "room_lofi", session: session({ playing: false, positionMs: 40_000, updatedAt: T0 + 10_000 }), sentAt: T0 + 10_000 });
  assert.deepEqual(kinds(env, "post").map((call) => call[1]), [
    { event: "command", func: "seekTo", args: [40, true] }, { event: "command", func: "pauseVideo", args: [] },
  ], "the loaded YouTube player is steered through its postMessage API");
  assert.equal(kinds(env, "post")[0][2], "https://www.youtube-nocookie.com");
  await env.hub({ type: "listen", roomId: "room_lofi", session: session({ playing: false, positionMs: 40_000, updatedAt: T0 + 10_000, title: "Me at the zoo" }), sentAt: T0 + 11_000 });
  assert.equal(kinds(env, "post").length, 2, "a title arriving moves nobody's player");
  assert.match(card.textContent, /Aksana is playing Me at the zoo/);
  await env.hub({ type: "listen", roomId: "room_lofi", session: null, sentAt: T0 + 12_000 });
  assert.equal(card.hidden, true);
  assert.match(env.host.textContent, /Aksana stopped the room's player/);
  await env.hub({ type: "listen", roomId: "room_other", session: session(), sentAt: T0 });
  assert.equal(card.hidden, true, "another room's frames are ignored");
});

test("starting a session sends the loaded link, follows it, and a refusal is explained", async () => {
  let answer = { ok: true };
  const env = environment({ saved: { roomId: "room_mine", following: false, share: false }, listen: () => answer });
  await flush(); await env.ready();
  const start = env.find("music-together-start");
  assert.equal(start.hidden, false);
  assert.equal(start.disabled, true, "nothing to play until a link is loaded");
  env.player.source = "link"; env.player.link = YT; env.player.title = "YouTube video";
  env.emit("mefi-music-change");
  assert.equal(start.disabled, false);
  start.click(); await flush();
  assert.deepEqual(kinds(env, "listen").at(-1)[1], { roomId: "room_mine", action: "start", url: YT, label: "YouTube video", provider: "youtube", positionMs: 0 });
  assert.equal(env.saved().following, true, "whoever starts it listens along");
  answer = { ok: false, reason: "links-not-allowed" };
  start.click(); await flush();
  assert.match(env.host.textContent, /New members can share links after their first day/);
});

test("the host steers: the card's buttons, and their own pause on a plain file", async () => {
  const env = environment({ saved: { roomId: "room_lofi", following: true, share: false } });
  await flush(); await env.ready();
  await env.hub({ type: "listen", roomId: "room_lofi", session: session({ url: FILE, provider: "discord", label: "Discord attachment · demo.mp4", host: ME, positionMs: 5_000 }), sentAt: T0 });
  assert.deepEqual(env.player.played, [[FILE, { autoplay: true, startMs: 5_000 }]]);
  assert.equal(env.find("music-together-toggle").hidden, false);
  const media = env.player.loaded.element;
  media.dispatch("pause");
  assert.equal(kinds(env, "listen").length, 0, "the player's own reaction to joining is not the host acting");
  env.now += 2_000;
  media.currentTime = 12.3; media.paused = true;
  media.dispatch("pause"); await flush();
  assert.deepEqual(kinds(env, "listen").at(-1)[1], { roomId: "room_lofi", action: "pause", positionMs: 12_300 });
  env.find("music-together-restart").click(); await flush();
  assert.deepEqual(kinds(env, "listen").at(-1)[1], { roomId: "room_lofi", action: "seek", positionMs: 0 });
  env.find("music-together-stop").click(); await flush();
  assert.deepEqual(kinds(env, "listen").at(-1)[1], { roomId: "room_lofi", action: "stop" });
});

test("Share what I'm playing is off until turned on, then sends only changes, and off sends null", async () => {
  const env = environment();
  await flush();
  const share = env.find("music-share-nowplaying");
  assert.equal(share.checked, false);
  env.player.source = "radio"; env.player.playing = true; env.player.stationName = "Groove Salad";
  env.emit("mefi-music-change"); await env.advance(5_000);
  assert.equal(kinds(env, "nowPlaying").length, 0, "nothing is shared by default");
  share.checked = true; share.dispatch("change"); await flush();
  assert.equal(kinds(env, "connect").length, 1, "sharing connects");
  assert.deepEqual(kinds(env, "nowPlaying"), [["nowPlaying", { label: "Groove Salad", provider: "radio" }]]);
  env.emit("mefi-music-change"); await env.advance(5_000);
  assert.equal(kinds(env, "nowPlaying").length, 1, "an unchanged track is not sent again");
  env.player.source = "local";
  env.emit("mefi-music-change"); await env.advance(5_000);
  assert.deepEqual(kinds(env, "nowPlaying").at(-1), ["nowPlaying", { label: "Local music", provider: "local" }], "a local file's name is never shared");
  env.player.source = "link"; env.player.link = YT; env.player.title = "YouTube video";
  env.emit("mefi-music-change"); await env.advance(5_000);
  assert.deepEqual(kinds(env, "nowPlaying").at(-1), ["nowPlaying", { label: "YouTube video", provider: "youtube", url: YT }]);
  share.checked = false; share.dispatch("change"); await flush();
  assert.deepEqual(kinds(env, "nowPlaying").at(-1), ["nowPlaying", null]);
  assert.equal(kinds(env, "disconnect").length, 1, "with no room chosen, turning sharing off closes the connection");
  assert.equal(env.saved().share, false);
});

test("a room's file on a private network address is never fetched by followers", async () => {
  const env = environment({ saved: { roomId: "room_lofi", following: true, share: false } });
  await flush(); await env.ready();
  const music = env.context.window.MefiMusic;
  const known = music.linkInfo;
  music.linkInfo = (raw) => /\.mp4$/.test(raw) ? { provider: "file", providerName: "Web", kind: "media", label: "Video file", url: raw, playable: true } : known(raw);
  for (const url of ["https://192.168.1.1/cam.mp4", "https://nas.local/a.mp4", "https://router/a.mp4", "https://[::1]/a.mp4"]) {
    await env.hub({ type: "listen", roomId: "room_lofi", session: session({ id: `lis_${url.length}`, url, provider: "file", label: "Video file" }), sentAt: T0 });
    assert.deepEqual(env.player.played, [], url);
  }
  assert.match(env.host.textContent, /private network address/);
  await env.hub({ type: "listen", roomId: "room_lofi", session: session({ id: "lis_public", url: "https://files.example.org/a.mp4", provider: "file", label: "Video file" }), sentAt: T0 });
  assert.deepEqual(env.player.played.map(([url]) => url), ["https://files.example.org/a.mp4"], "a public host plays");
});

test("smoke and capture runs never reconnect a saved room", async () => {
  const env = environment({ saved: { roomId: "room_lofi", following: true, share: true }, search: "?smoke=1" });
  await flush();
  assert.equal(kinds(env, "connect").length, 0);
});

test("the players' postMessage vocabularies, and none for Spotify", () => {
  const env = environment();
  assert.deepEqual(JSON.parse(JSON.stringify(env.together.embedCommands("vimeo", true, 61_500))), [{ method: "setCurrentTime", value: 61.5 }, { method: "play" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(env.together.embedCommands("soundcloud", false, 61_500))), [{ method: "seekTo", value: 61_500 }, { method: "pause" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(env.together.embedCommands("spotify", true, 1))), []);
});
