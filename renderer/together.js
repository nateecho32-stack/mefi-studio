// Listen together and the now-playing share: a room's shared player in the
// Links tab, and what the Void Engine bot's /nowplaying shows. Rooms live on
// the Void Engine rooms hub (main.cjs "Rooms hub", scripts/hub-client.cjs).
// This file draws its section inside the Links panel (MefiMusic.togetherHost),
// keeps the Links player in step with the chosen room's session, and, only
// when the member turns it on, tells the hub what Studio is playing. Nothing
// connects until the member picks a room or turns sharing on.
//
// Sync is best effort, and the section says so. A plain file plays in
// Studio's own <video>, so it follows the session to the second, and the
// host's own play, pause and seek on it are sent to the room. YouTube, Vimeo
// and SoundCloud take play, pause and seek through their players' postMessage
// APIs and join part-way through; their own buttons are not heard back, so the
// host steers them with the buttons here. Spotify's embed takes no commands:
// everyone loads the same thing and presses play in it.
(() => {
  "use strict";
  const STORE = "mefiStudio.together.v1";
  const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;
  // Closer than this and a follower is left alone: re-seeking costs a stutter.
  const DRIFT_MS = 2000;
  const SHARE_DELAY_MS = 1500;
  const EMBED_SETTLE_MS = 1500;
  // A change this file just made to the player is not the host acting.
  const APPLY_QUIET_MS = 1500;
  const PROVIDERS = { youtube: "YouTube", spotify: "Spotify", soundcloud: "SoundCloud", vimeo: "Vimeo", discord: "a Discord attachment", file: "a file" };
  const REASONS = {
    "not-yours": "Only whoever put this on, or the room's owner, can change it.",
    "links-not-allowed": "New members can share links after their first day in the server.",
    "bad-link": "Rooms play YouTube, Spotify, SoundCloud and Vimeo links, Discord attachments and audio or video files.",
    "rate-limited": "That was a lot of changes at once. Try again in a moment.",
    locked: "This room is locked.",
    "read-only": "You're timed out in the server, so you can listen along but not play.",
    paused: "The hub is paused for maintenance.",
    "not-member": "You're not in this room any more.",
    "not-found": "This room is gone.",
    "no-session": "Nothing is playing in this room.",
    offline: "The rooms hub is out of reach.",
    timeout: "The hub didn't answer in time.",
  };
  const ERRORS = {
    "not-member": "Only members of the Void Engine server can use rooms.",
    auth: "Discord asked Studio to link again: Settings › General › Community.",
    "not-linked": "Link your Discord account (Settings › General › Community) to listen with your rooms.",
    version: "The rooms hub has moved on. Update Studio to listen together.",
    "not-configured": "Listening together needs the Void Engine rooms hub, and this build isn't connected to one yet.",
    unsupported: "This Studio can't open the hub's connection.",
  };
  const bridge = () => window.mefiStudio;
  const music = () => window.MefiMusic;
  const available = () => typeof bridge()?.hubStatus === "function" && typeof music()?.togetherHost === "function";
  const headless = () => /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));

  function readPrefs() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch {}
    const roomId = typeof saved?.roomId === "string" && ROOM_ID.test(saved.roomId) ? saved.roomId : null;
    return { roomId, following: Boolean(roomId) && saved?.following === true, share: saved?.share === true };
  }
  const prefs = readPrefs();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch {} };
  const state = { hub: null, rooms: [], roomsLoaded: false, session: null, receivedAt: 0, sentAt: null, inStudio: [], note: "", noteError: false,
    applyingUntil: 0, shared: null, shareTimer: 0, watched: null, busy: false, ticker: 0 };
  const els = {};
  let built = false;

  function element(tag, className, text, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  function button(text, className, parent, action, id) {
    const node = element("button", className, text, parent);
    node.type = "button";
    if (id) node.id = id;
    node.addEventListener("click", action);
    return node;
  }
  const clock = (ms) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };
  function note(text, error = false) { state.note = String(text || ""); state.noteError = error; if (els.note) { els.note.textContent = state.note; els.note.dataset.error = String(error); } }

  // ---- the hub ---------------------------------------------------------------

  const ready = () => state.hub?.state === "ready";
  const canConnect = () => Boolean(state.hub?.configured && state.hub.communityConfigured && state.hub.linked);
  const me = () => state.hub?.user?.id ?? null;
  const room = () => state.rooms.find((item) => item.id === prefs.roomId) ?? null;
  const mine = () => Boolean(state.session && me() && state.session.host.id === me());
  const steer = () => mine() || Boolean(me() && room()?.ownerId === me());

  async function refreshStatus() {
    if (!available()) return;
    try { const answer = await bridge().hubStatus(); if (answer?.status) state.hub = answer.status; } catch {}
    if (state.hub && !state.hub.linked && state.hub.state !== "off") { try { await bridge().hubDisconnect(); } catch {} state.hub = { ...state.hub, state: "off" }; }
    render();
  }
  async function connect() {
    if (!available() || state.busy) return;
    state.busy = true; render();
    try { const answer = await bridge().hubConnect(); if (answer?.status) state.hub = answer.status; } catch {}
    state.busy = false;
    if (prefs.roomId) { try { await bridge().hubSubscribe(prefs.roomId, true); } catch {} }
    if (ready()) await joined();
    render();
  }
  // Once per connection: the room list, and the share if it is on (the
  // client re-subscribes rooms and re-sends the share by itself after that).
  async function joined() {
    let answer = null;
    try { answer = await bridge().hubRooms(); } catch {}
    if (answer?.ok) {
      state.rooms = (answer.rooms || []).filter((item) => (item.you === "owner" || item.you === "member") && item.status !== "closed");
      state.roomsLoaded = true;
      if (prefs.roomId && !room()) forgetRoom("You're no longer in that room.");
    }
    if (prefs.share) shareNow();
    render();
  }
  async function choose(roomId) {
    const next = ROOM_ID.test(String(roomId)) ? roomId : null;
    if (next === prefs.roomId) return;
    if (prefs.roomId) { try { await bridge().hubSubscribe(prefs.roomId, false); } catch {} }
    prefs.roomId = next; prefs.following = false; save();
    state.session = null; state.inStudio = [];
    note("");
    if (next) {
      if (!ready() && canConnect()) await connect();
      try { await bridge().hubSubscribe(next, true); } catch {}
    } else if (!prefs.share) { try { await bridge().hubDisconnect(); } catch {} }
    render();
  }
  function forgetRoom(reason) {
    prefs.roomId = null; prefs.following = false; save();
    state.session = null; state.inStudio = [];
    if (reason) note(reason);
  }

  function onHubEvent(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "status" && event.status) {
      const was = state.hub?.state;
      state.hub = { ...(state.hub || {}), ...event.status };
      if (state.hub.state === "ready" && was !== "ready" && !state.roomsLoaded) void joined();
      render();
      return;
    }
    if (event.roomId !== prefs.roomId) return;
    if (event.type === "listen") {
      const previous = state.session;
      const next = event.session ?? null;
      state.session = next;
      state.receivedAt = Date.now();
      state.sentAt = Number.isFinite(event.sentAt) ? event.sentAt : null;
      // A title arriving is not a reason to touch anyone's player.
      const moved = !previous || !next || previous.id !== next.id || previous.playing !== next.playing || previous.positionMs !== next.positionMs || previous.updatedAt !== next.updatedAt;
      if (!next && previous) note(`${previous.host.name || "The host"} stopped the room's player.`);
      if (next && moved) apply();
      if (prefs.share) scheduleShare();
      render();
    } else if (event.type === "presence") {
      state.inStudio = Array.isArray(event.inStudio) ? event.inStudio : [];
      renderSession();
    } else if (event.type === "membership") {
      if (event.userId === me() && ["left", "removed", "closed"].includes(event.state)) { forgetRoom("You're no longer in that room."); render(); }
      else if (event.state === "closed") { forgetRoom("That room was closed."); render(); }
    } else if (event.type === "room" && event.room) {
      state.rooms = state.rooms.map((item) => (item.id === event.room.id ? { ...item, ...event.room } : item));
      if (event.room.status === "closed") forgetRoom("That room was closed.");
      render();
    }
  }

  // ---- the session and the player -----------------------------------------------

  // Where the session is now: its position at the last change, plus the time
  // it has been playing since, on the hub's clock up to sending and on ours
  // after, so neither clock's offset matters.
  function position() {
    const session = state.session;
    if (!session) return 0;
    if (!session.playing) return session.positionMs;
    const onHub = Number.isFinite(state.sentAt) ? Math.max(0, state.sentAt - session.updatedAt) : 0;
    return session.positionMs + onHub + Math.max(0, Date.now() - state.receivedAt);
  }
  function loadedFor(session) {
    const loaded = music()?.linkElement?.();
    const info = music()?.linkInfo?.(session.url);
    return loaded && info && loaded.url === info.url ? loaded : null;
  }
  // A room's plain file is fetched by every follower, so one on an address
  // inside their own network (an IP literal, a single-label or .local-style
  // name) is never loaded from a room, whatever the hub let through. A link
  // the member pastes themselves is theirs to play.
  function publicHost(url) {
    let host;
    try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ""); } catch { return false; }
    if (!host || host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || !host.includes(".")) return false;
    return ![".local", ".localhost", ".lan", ".internal", ".home", ".arpa", ".intranet"].some((suffix) => host.endsWith(suffix));
  }
  // Brings the Links player to the session: loads its link part-way through
  // when another one is showing, else nudges the one that is.
  function apply() {
    const session = state.session;
    if (!session || !prefs.following) return;
    const player = music();
    const info = player?.linkInfo?.(session.url);
    if (!info?.playable) { note("This room's link can't play in Studio.", true); return; }
    if (info.kind === "media" && !publicHost(info.url)) { note("This room's file is on a private network address, so Studio won't fetch it.", true); return; }
    state.applyingUntil = Date.now() + APPLY_QUIET_MS;
    const loaded = loadedFor(session);
    if (loaded) { drive(loaded); return; }
    const target = position();
    player.playLink(session.url, { autoplay: session.playing, startMs: target });
    const fresh = loadedFor(session);
    if (!fresh) return;
    if (fresh.kind === "media") watchHost(fresh);
    // SoundCloud's widget has no start parameter: it seeks once it is up.
    else if (fresh.provider === "soundcloud" && target > DRIFT_MS) {
      fresh.element.addEventListener?.("load", () => window.setTimeout(() => { if (loadedFor(session)?.element === fresh.element) drive(fresh); }, EMBED_SETTLE_MS), { once: true });
    }
  }
  // An embed's position cannot be read back, so every change re-sends both
  // where to be and whether to play.
  function drive(loaded) {
    const session = state.session;
    if (!session) return;
    const target = position();
    state.applyingUntil = Date.now() + APPLY_QUIET_MS;
    if (loaded.kind === "media") {
      const player = loaded.element;
      watchHost(loaded);
      const at = Number(player.currentTime) * 1000;
      // A file's position is known, so only real drift moves it.
      if (!Number.isFinite(at) || Math.abs(at - target) > DRIFT_MS) { try { player.currentTime = target / 1000; } catch {} }
      if (session.playing && player.paused) { try { Promise.resolve(player.play?.()).catch(() => {}); } catch {} }
      if (!session.playing && !player.paused) { try { player.pause?.(); } catch {} }
      return;
    }
    for (const message of embedCommands(loaded.provider, session.playing, target)) post(loaded.element, message);
  }
  // The players' own postMessage vocabularies. Spotify's embed has none.
  function embedCommands(provider, playing, targetMs) {
    const seconds = Math.max(0, targetMs / 1000);
    if (provider === "youtube") return [{ event: "command", func: "seekTo", args: [seconds, true] }, { event: "command", func: playing ? "playVideo" : "pauseVideo", args: [] }];
    if (provider === "vimeo") return [{ method: "setCurrentTime", value: seconds }, { method: playing ? "play" : "pause" }];
    if (provider === "soundcloud") return [{ method: "seekTo", value: Math.round(targetMs) }, { method: playing ? "play" : "pause" }];
    return [];
  }
  function post(frame, message) {
    try { frame.contentWindow?.postMessage(JSON.stringify(message), new URL(frame.src).origin); } catch {}
  }
  // The host's own play, pause and seek on a plain file go to the room.
  function watchHost(loaded) {
    if (loaded.kind !== "media" || state.watched === loaded.element) return;
    const player = loaded.element;
    state.watched = player;
    const report = (action) => {
      const session = state.session;
      if (!session || !mine() || Date.now() < state.applyingUntil || loadedFor(session)?.element !== player) return;
      const at = Math.round(Number(player.currentTime) * 1000);
      if (!Number.isFinite(at)) return;
      if (action === "pause" && !session.playing) return;
      if (action === "play" && session.playing) return;
      if (action === "seek" && Math.abs(at - position()) <= DRIFT_MS) return;
      void send(action, at);
    };
    player.addEventListener("pause", () => report("pause"));
    player.addEventListener("play", () => report("play"));
    player.addEventListener("seeked", () => report("seek"));
  }
  async function send(action, positionMs) {
    if (!prefs.roomId) return false;
    let answer;
    try { answer = await bridge().hubListen({ roomId: prefs.roomId, action, ...(Number.isFinite(positionMs) ? { positionMs: Math.max(0, Math.round(positionMs)) } : {}) }); } catch { answer = { ok: false, reason: "offline" }; }
    if (!answer?.ok) note(REASONS[answer?.reason] || "The hub refused that.", true);
    return Boolean(answer?.ok);
  }
  function currentLink() {
    const status = music()?.status?.();
    if (status?.source !== "link" || !status.link) return null;
    const info = music()?.linkInfo?.(status.link);
    return info?.playable ? { ...info, title: status.title } : null;
  }
  async function start() {
    const link = currentLink();
    if (!link || !prefs.roomId) return;
    const loaded = music()?.linkElement?.();
    const positionMs = loaded?.kind === "media" && loaded.url === link.url ? Math.round(Number(loaded.element.currentTime) * 1000) || 0 : 0;
    let answer;
    try { answer = await bridge().hubListen({ roomId: prefs.roomId, action: "start", url: link.url, label: String(link.title || link.label).slice(0, 120), provider: link.provider, positionMs }); } catch { answer = { ok: false, reason: "offline" }; }
    if (!answer?.ok) { note(REASONS[answer?.reason] || "The hub refused that.", true); return; }
    prefs.following = true; save();
    note(`Playing for ${room()?.name || "the room"}. Its Discord thread gets a note too.`);
    render();
  }
  function hostPosition() {
    const loaded = state.session && loadedFor(state.session);
    return loaded?.kind === "media" ? Number(loaded.element.currentTime) * 1000 : position();
  }
  function follow(on) {
    prefs.following = Boolean(on) && Boolean(prefs.roomId); save();
    if (prefs.following) apply();
    render();
  }

  // ---- now playing ---------------------------------------------------------

  // What /nowplaying may show: the link (the room's title for it when this is
  // the room's session), the station while it sounds, or just "local music".
  function currentTrack() {
    const status = music()?.status?.();
    if (!status) return null;
    if (status.source === "link") {
      const link = currentLink();
      if (!link) return null;
      const session = state.session && prefs.following && music()?.linkInfo?.(state.session.url)?.url === link.url ? state.session : null;
      return { label: String(session?.title || link.title || link.label).slice(0, 120), provider: link.provider, url: link.url };
    }
    if (status.source === "radio" && status.playing && status.stationName) return { label: String(status.stationName).slice(0, 120), provider: "radio" };
    if (status.source === "local" && status.playing) return { label: "Local music", provider: "local" };
    return null;
  }
  function shareNow() {
    window.clearTimeout(state.shareTimer); state.shareTimer = 0;
    if (!available()) return;
    const track = prefs.share ? currentTrack() : null;
    const key = JSON.stringify(track);
    if (key === state.shared) return;
    state.shared = key;
    Promise.resolve(bridge().hubNowPlaying(track)).catch(() => {});
  }
  function scheduleShare() {
    if (!prefs.share && state.shared == null) return;
    window.clearTimeout(state.shareTimer);
    state.shareTimer = window.setTimeout(shareNow, SHARE_DELAY_MS);
  }
  async function setShare(on) {
    prefs.share = Boolean(on); save();
    if (prefs.share) {
      if (!ready() && canConnect()) await connect();
      shareNow();
    } else {
      shareNow();
      state.shared = null;
      if (!prefs.roomId) { try { await bridge().hubDisconnect(); } catch {} }
    }
    render();
  }

  // ---- the section -----------------------------------------------------------

  function build(host) {
    host.textContent = "";
    host.setAttribute("aria-labelledby", "music-together-heading");
    const heading = element("h4", "music-node-label", "Listen together", host); heading.id = "music-together-heading";
    element("p", "music-fineprint", "Play a link for one of your Void Engine rooms. Everyone listening along in Studio hears it at the same point, and the room's Discord thread gets a note.", host);
    els.state = element("p", "music-together-state", null, host); els.state.setAttribute("role", "status");
    const row = element("div", "music-together-row", null, host);
    els.connect = button("Connect", "ghost", row, () => void connect(), "music-together-connect");
    const label = element("label", "music-together-room", "Room", row);
    els.room = element("select", null, null, label); els.room.id = "music-together-room";
    els.room.addEventListener("change", () => void choose(els.room.value));
    els.start = button("Play this link in the room", "primary", row, () => void start(), "music-together-start");
    els.session = element("div", "music-together-session", null, host); els.session.hidden = true;
    const copy = element("span", "music-together-copy", null, els.session);
    els.sessionTitle = element("strong", null, null, copy);
    els.sessionDetail = element("small", null, null, copy);
    const tools = element("span", "music-link-tools", null, els.session);
    els.follow = button("Listen along", "primary", tools, () => follow(!prefs.following), "music-together-follow");
    els.toggle = button("Pause", "ghost", tools, () => void send(state.session?.playing ? "pause" : "play", hostPosition()), "music-together-toggle");
    els.restart = button("From the start", "ghost", tools, () => void send("seek", 0), "music-together-restart");
    els.stop = button("Stop", "ghost", tools, () => void send("stop"), "music-together-stop");
    els.empty = element("p", "music-fineprint", null, host);
    els.note = element("p", "music-together-note", null, host); els.note.setAttribute("role", "status");
    const share = element("label", "music-effect music-together-share", null, host);
    const shareCopy = element("span", "music-effect-copy", null, share);
    element("strong", null, "Share what I'm playing", shareCopy);
    const hint = element("small", null, "Void Engine members can see it with /nowplaying on Discord. Off unless you turn it on; the hub keeps it in memory only and drops it when Studio closes.", shareCopy);
    hint.id = "music-share-nowplaying-hint";
    els.share = element("input", null, null, share); els.share.type = "checkbox"; els.share.id = "music-share-nowplaying";
    els.share.setAttribute("aria-describedby", hint.id);
    els.share.addEventListener("change", () => void setShare(els.share.checked));
  }
  function stateText() {
    const hub = state.hub;
    if (!hub) return "Checking the rooms hub…";
    if (!hub.configured) return ERRORS["not-configured"];
    if (!hub.communityConfigured) return "Listening together needs the Discord link, which this build doesn't have.";
    if (!hub.linked) return ERRORS["not-linked"];
    if (hub.state === "ready") return `Connected as ${hub.user?.name || "you"}${hub.readOnly ? " · listen-only while you're timed out" : ""}${hub.paused ? " · the hub is paused" : ""}.`;
    if (hub.state === "connecting" || state.busy) return "Connecting to the rooms hub…";
    if (hub.state === "offline") return "The rooms hub is out of reach. Studio keeps trying.";
    if (hub.state === "error") return ERRORS[hub.error] || "The rooms hub refused the connection.";
    return "Not connected. Choose Connect, or turn sharing on.";
  }
  function renderRooms() {
    const options = [["", state.rooms.length || !state.roomsLoaded ? "Choose a room" : "You're not in any rooms yet"]];
    for (const item of state.rooms) options.push([item.id, `${item.name}${item.status === "locked" ? " (locked)" : ""}`]);
    if (prefs.roomId && !state.rooms.some((item) => item.id === prefs.roomId)) options.push([prefs.roomId, "Your last room"]);
    const signature = JSON.stringify(options);
    if (els.room.dataset.options !== signature) {
      els.room.textContent = "";
      for (const [value, text] of options) { const option = element("option", null, text, els.room); option.value = value; }
      els.room.dataset.options = signature;
    }
    els.room.value = prefs.roomId || "";
  }
  function renderSession() {
    const session = state.session;
    els.session.hidden = !session;
    if (!session) return;
    els.sessionTitle.textContent = `🎧 ${session.host.name || "Someone"} is playing ${session.title || session.label}`;
    const others = state.inStudio.length;
    const spotify = session.provider === "spotify" ? " · Spotify can't be synced: press play in its player" : "";
    els.sessionDetail.textContent = `On ${PROVIDERS[session.provider] || "the web"} · ${session.playing ? "playing" : "paused"} at ${clock(position())}${others ? ` · ${others} in Studio` : ""}${spotify}`;
    els.follow.textContent = prefs.following ? "Stop listening along" : "Listen along";
    els.follow.className = prefs.following ? "ghost" : "primary";
    els.follow.setAttribute("aria-pressed", String(prefs.following));
    const control = steer() && !state.hub?.readOnly;
    els.toggle.hidden = !control; els.restart.hidden = !control; els.stop.hidden = !control;
    els.toggle.textContent = session.playing ? "Pause" : "Resume";
  }
  function renderStart() {
    if (!els.start) return;
    els.start.hidden = !ready() || !prefs.roomId;
    const link = currentLink();
    els.start.disabled = !link || Boolean(state.hub?.readOnly) || (Boolean(state.session) && !steer());
    els.start.title = !link ? "Load a YouTube, Spotify, SoundCloud or Vimeo link, or a file link, above first" : state.session && !steer() ? REASONS["not-yours"] : "Everyone listening along hears it at the same point";
  }
  function tick() {
    const live = Boolean(state.session?.playing) && !els.session.hidden;
    if (live && !state.ticker) state.ticker = window.setInterval(() => { if (state.session?.playing) renderSession(); else stopTicker(); }, 1000);
    else if (!live) stopTicker();
  }
  function stopTicker() { if (state.ticker) { window.clearInterval(state.ticker); state.ticker = 0; } }
  function render() {
    if (!built) return;
    els.state.textContent = stateText();
    const hub = state.hub;
    els.connect.hidden = !canConnect() || ready() || hub?.state === "connecting" || state.busy;
    els.room.parentElement.hidden = !ready() && !prefs.roomId;
    els.room.disabled = !ready();
    renderRooms();
    renderSession();
    renderStart();
    els.empty.hidden = !(ready() && prefs.roomId && !state.session);
    els.empty.textContent = `Nothing is playing in ${room()?.name || "this room"}. Load a link above and play it for the room.`;
    els.share.checked = prefs.share;
    els.share.disabled = !canConnect();
    tick();
  }

  function init() {
    if (built || !available()) return;
    const host = music().togetherHost();
    if (!host) return;
    built = true;
    build(host);
    host.hidden = false;
    bridge().onHubEvent?.(onHubEvent);
    window.addEventListener("mefi-music-change", () => { if (prefs.share) scheduleShare(); renderStart(); });
    window.addEventListener("mefi-community-status", () => void refreshStatus());
    window.addEventListener("mefi-community-change", () => void refreshStatus());
    render();
    // A room or a share that was on when Studio closed comes back, like the
    // radio does; smoke and capture runs share the owner's profile and stay off.
    void refreshStatus().then(() => { if ((prefs.roomId || prefs.share) && canConnect() && !headless()) void connect(); });
  }
  window.MefiTogether = { init, status: () => ({ hub: state.hub, roomId: prefs.roomId, following: prefs.following, share: prefs.share, session: state.session }), position, embedCommands };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
