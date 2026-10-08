// Friends' front door: the sign-in card and The Lobby (window.MefiFriendsFront).
//
// gate({ onSignedIn }) is what Friends shows a member who has not signed in:
// one "Sign in with Discord" card. Discord asks once in the browser
// (MefiCommunity.link), the room service connects, and onSignedIn() lets the
// place paint itself again. Rooms, the Project hub and The Lobby use it; Your
// PCs and the Playground never need it.
//
// card() is The Lobby, Friends' front page in The Studio Daily's voice. It is
// read from the relay in one call (main's hub:room "front", the relay's
// GET /v1/front): who is online and where, the week's top project, the rooms
// open now, what was shared this week, rank-ups and the member's own week,
// with "Show me as online" and an invite code at the foot. Building now shows
// friends who share what they are making (their open project's name and how
// many tasks run and finished today, as a small tree); "Share what I'm
// building" at the foot is this member's own switch (main's
// hubBuildingShare), off until they turn it on. It reads again
// every minute while it is on screen and the window can be seen, and sooner
// when someone arrives or leaves: while it shows, it holds the Lobby room
// (hubSubscribe "lobby", as Rooms does) and a presence frame there reads the
// page again, at most every ten seconds. It lets go when Friends does
// (dispose). Everything is text: names and titles go
// in with textContent, and nothing from the relay becomes a link.
//
// Pop-ups (popups.hear, on the module's one hub listener, Friends open or
// not): a friend you share a room with opened Studio, someone invited you to
// a room or asks to join yours, someone played or starred your project, and
// a member got one of your style packs in the Shop (credits reason "sale").
// Each is a toast (window.MefiToast) with a way to the right Friends place;
// several friends coming online at once are one toast. "Pop-ups from
// friends" at The Lobby's foot turns them off (localStorage
// mefiStudio.friendsPopups = "0"), and none show while the window is hidden.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, cls = "ghost", id = null) => { const el = node("button", cls, text); el.type = "button"; if (id) el.id = id; el.addEventListener("click", run); return el; };
  const bridge = () => window.mefiStudio;
  const REFRESH_MS = 60_000;
  const RANKS = { spark: "Spark", ember: "Ember", flame: "Flame", comet: "Comet", star: "Star", nova: "Nova", void: "Void" };
  const KINDS = { game: "game", app: "app", tool: "tool", art: "art", music: "music", other: "project" };
  const rankName = (key) => RANKS[key] ?? (typeof key === "string" && key ? key[0].toUpperCase() + key.slice(1) : "Spark");
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
  // A steady colour per member, from their id.
  const hue = (id) => [...String(id)].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7);
  const goPlace = (place, extra = {}) => window.MefiNav?.go?.("friends-page", { place, ...extra });
  // "today" and "yesterday" by the calendar, not by 24-hour spans.
  const startOfDay = (ms) => { const day = new Date(ms); day.setHours(0, 0, 0, 0); return day.getTime(); };
  const when = (ms) => {
    if (!Number.isFinite(ms)) return "";
    const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : new Date(ms).toLocaleDateString([], { weekday: "long" });
  };
  const HOLD_WORDS = {
    "new-account": "Credits start when your Discord account is 30 days old",
    "new-member": "Credits start a week after you join the Void Engine server",
    "forgot-me": "Credits are paused for 30 days after Forget me",
    "read-only": "Credits are paused while your account is read-only",
  };

  // ---- the room service connection, said once for every Friends place ----------
  // What the connection is doing, in a sentence, and the one thing that helps:
  // sign in again, join the server, update Studio, or Connect (only when a
  // connection can actually be made). The Lobby, the Project hub and Your PCs use it.
  function hubState(hub) {
    if (!hub?.configured) return { action: null, text: "This copy of Studio can't reach the room service." };
    if (!hub.linked) return { action: "signin", text: "Sign in with Discord to use Friends." };
    if (hub.error === "not-member") return { action: "join", text: "Your Discord account isn't in the Void Engine server yet. Join it, then check again." };
    if (hub.error === "auth") return { action: "signin", text: "Your Discord sign-in has run out. Sign in with Discord again." };
    if (hub.error === "version") return { action: "update", text: "The room service needs a newer Studio. Update Studio; Friends reconnects by itself after the update." };
    if (hub.error === "relay-behind") return { action: null, text: "The room service is being updated. Studio reconnects by itself in a few minutes." };
    if (hub.state === "ready") return { action: null, text: "" };
    if (hub.state === "connecting") return { action: null, text: "Connecting to the room service…" };
    if (hub.error === "too-many-sockets") return { action: "connect", text: "Studio is open in too many places with this account. Close one, then Connect." };
    if (hub.state === "offline") return { action: "connect", text: "Lost the room service. Studio reconnects by itself; Connect tries now." };
    return { action: "connect", text: hub.error ? "Not connected to the room service. Check your internet, then Connect." : "Not connected to the room service yet." };
  }

  // ---- the sign-in card -------------------------------------------------------
  // note: a line to start with (why signing in is asked again).
  function gate({ onSignedIn, note = "" } = {}) {
    const root = node("section", "friends-gate");
    root.id = "friends-gate";
    root.setAttribute("aria-labelledby", "friends-gate-title");
    const title = node("h2", "friends-gate-title", "Friends");
    title.id = "friends-gate-title";
    const lead = node("p", "friends-gate-lead", "See who's online, join a room, and share what you make with people who build with Studio.");
    const actions = node("div", "friends-gate-actions");
    const status = node("p", "friends-gate-status", note);
    status.id = "friends-gate-status";
    status.setAttribute("role", "status");
    const fine = node("p", "friends-gate-fine", "Studio asks Discord for your name and your Void Engine server roles. Studio's room service passes room messages along and keeps none of them.");
    const points = node("ul", "friends-gate-points");
    for (const [strong, rest] of [["You show as online", " while Studio is open. Turn it off any time."], ["Your PCs and Studio Daily", " keep working without signing in."]]) {
      const item = node("li");
      item.append(node("b", "", strong), document.createTextNode(rest));
      points.append(item);
    }
    let busy = false;
    const signIn = button("Sign in with Discord", () => { void start(); }, "friends-gate-signin", "friends-gate-signin");
    actions.append(signIn);
    root.append(title, lead, actions, status, fine, points);

    async function connected() {
      status.textContent = "Signed in. Connecting…";
      try { await bridge()?.hubConnect?.(); } catch { /* the place says what it sees next */ }
      onSignedIn?.();
    }
    function notMember() {
      root.dataset.state = "not-member";
      status.textContent = "Your Discord account isn't in the Void Engine server yet. Join it, then check again.";
      actions.replaceChildren(
        button("Join the Discord", () => { void window.MefiCommunity?.join?.(); }, "friends-gate-signin", "friends-gate-join"),
        button("I've joined, check again", () => { void recheck(); }, "ghost", "friends-gate-recheck"),
      );
    }
    async function recheck() {
      if (busy) return;
      busy = true;
      status.textContent = "Checking…";
      const checked = await window.MefiCommunity?.check?.();
      busy = false;
      if (checked?.ok === false && checked.error === "not-member") { notMember(); return; }
      await connected();
    }
    async function start() {
      const community = window.MefiCommunity;
      if (typeof community?.link !== "function") { window.MefiNav?.go?.("community"); return; }
      if (busy) return;
      busy = true;
      signIn.disabled = true;
      status.textContent = "Discord is asking in your browser. Press Authorize there, then come back.";
      const linked = await community.link();
      busy = false;
      signIn.disabled = false;
      if (linked?.ok) { await connected(); return; }
      if (linked?.error === "not-member") { notMember(); return; }
      status.textContent = linked?.error === "canceled" ? "Signing in was cancelled. Press Sign in with Discord to try again." : "Signing in didn't finish. Press Sign in with Discord to try again.";
    }
    root.notMember = notMember;
    return root;
  }

  // ---- Pop-ups --------------------------------------------------------------------
  const POPUPS_KEY = "mefiStudio.friendsPopups";
  // Credits from community events (relay events.mjs), as a pop-up says them.
  const EVENT_CREDITS = { together: "for building together", cowork: "for the cowork hour", jam: "from the Build Jam" };
  const popups = {
    on() { try { return globalThis.localStorage?.getItem(POPUPS_KEY) !== "0"; } catch { return true; } },
    set(on) { try { globalThis.localStorage?.setItem(POPUPS_KEY, on ? "1" : "0"); } catch { /* this window only */ } },
    online: [], // names waiting to be said together
    timer: null,
    // run: where the toast's button goes, when that is not a Friends place (the Shop's own page).
    show(text, label, place, extra = {}, run = null) {
      if (!popups.on() || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
      window.MefiToast?.(text, "info", { action: { label, run: run ?? (() => goPlace(place, extra)) } });
    },
    hear(event) {
      switch (event?.type) {
        case "friendOnline": {
          if (!event.user?.name || popups.online.includes(event.user.name)) return;
          popups.online.push(event.user.name);
          // A few friends opening Studio together are one toast.
          if (!popups.timer) popups.timer = setTimeout(() => {
            const names = popups.online.splice(0);
            popups.timer = null;
            if (!names.length) return;
            const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;
            popups.show(`${who} ${names.length === 1 ? "is" : "are"} online`, "Say hi", "lobby");
          }, 3000);
          return;
        }
        case "invite":
          if (event.invite?.status === "pending") popups.show(`${event.invite.invitedBy.name} invited you to ${event.invite.roomName}`, "See the invite", "rooms");
          return;
        case "joinRequest":
          if (event.request?.status === "pending") popups.show(`${event.request.requester.name} asks to join one of your rooms`, "See requests", "rooms");
          return;
        case "credits":
          if (event.delta > 0 && event.reason === "played") popups.show(`Someone played your project: +${event.delta} credits`, "Project hub", "hub");
          else if (event.delta > 0 && event.reason === "starred") popups.show(`Someone starred your project: +${event.delta} credits`, "Project hub", "hub");
          else if (event.delta > 0 && EVENT_CREDITS[event.reason]) popups.show(`+${event.delta} credits ${EVENT_CREDITS[event.reason]}`, "Events", "events");
          // The relay pays a pack's maker 75% of what was paid (relay/src/shop.mjs): Your packs is in Make a style.
          else if (event.delta > 0 && event.reason === "sale") popups.show(`A member got one of your style packs: +${plural(event.delta, "credit")}`, "Your packs", "shop", {}, () => (window.MefiShop?.open ? window.MefiShop.open("make") : goPlace("shop")));
          return;
        default:
      }
    },
  };

  // ---- The Lobby: the front page ------------------------------------------------
  let current = null; // the card on screen: { hear }
  let hearing = false;
  function listen(api) {
    if (hearing || typeof api?.onHubEvent !== "function") return;
    hearing = true;
    api.onHubEvent((event) => { popups.hear(event); current?.hear(event); });
  }

  function card() {
    const root = node("section", "friends-front");
    root.id = "friends-front";
    root.setAttribute("aria-labelledby", "friends-front-title");
    const status = node("p", "friends-front-status");
    status.id = "friends-front-status";
    status.setAttribute("role", "status");
    const body = node("div", "friends-front-body");
    root.append(status, body);
    const api = bridge();
    if (typeof api?.hubRoom !== "function" || typeof api?.hubStatus !== "function") {
      status.textContent = "The Lobby works in the desktop app.";
      root.dataset.state = "unavailable";
      return root;
    }
    listen(api);
    let timer = null, seq = 0, tried = false, gone = false;
    let holding = false, soon = null, readAt = 0; // the Lobby room held for its presence frames
    let page = null; // the last front page read
    let meId = null; // this member, from hub:status
    let sharing = false; // "Share what I'm building", as main's hub:status says
    let autoConnect = true; // "Reconnect by itself" (settings.friends.connectAtLaunch)
    let code = null; // { roomId, code, link } for the member's own room

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (gone || root.isConnected === false) { dispose(); return; }
        if (typeof document !== "undefined" && document.visibilityState === "hidden") { schedule(); return; }
        // Someone is using a control on the page (a switch, Copy invite): read later, not under their hands.
        if (typeof document !== "undefined" && root.contains?.(document.activeElement) && document.activeElement !== root) { schedule(); return; }
        void load();
      }, REFRESH_MS);
    };

    async function load() {
      const mine = ++seq;
      // What waits in Rooms (invites, requests to decide) reaches the Friends badge, and the masthead once it is up.
      void Promise.resolve(window.MefiRooms?.recount?.()).then(() => { if (!gone && mine === seq && page) paint(); }).catch(() => {});
      let hub;
      try { hub = (await api.hubStatus())?.status; } catch { hub = null; }
      if (gone || mine !== seq) return;
      if (!hub?.linked) {
        root.dataset.state = "signed-out";
        status.textContent = "";
        body.replaceChildren(gate({ onSignedIn: () => { tried = false; void load(); } }));
        return;
      }
      if (hub.error === "not-member") {
        root.dataset.state = "not-member";
        status.textContent = "";
        const card = gate({ onSignedIn: () => { tried = false; void load(); } });
        card.notMember();
        body.replaceChildren(card);
        return;
      }
      if (hub.state !== "ready") {
        // Signed in and simply not connected yet: opening The Lobby is the ask.
        if (hub.state === "off" && !hub.error && !tried) {
          tried = true;
          root.dataset.state = "connecting";
          status.textContent = "Connecting to the room service…";
          try { await api.hubConnect(); } catch { /* the next look says why */ }
          if (!gone && mine === seq) void load();
          return;
        }
        root.dataset.state = hub.state || "off";
        const said = hubState(hub);
        if (said.action === "signin") { status.textContent = ""; body.replaceChildren(gate({ onSignedIn: () => { tried = false; void load(); }, note: said.text })); return; }
        status.textContent = said.text;
        body.replaceChildren(...(said.action === "connect" ? [button("Connect", () => { tried = false; void Promise.resolve(api.hubConnect()).finally(() => load()); }, "ghost", "friends-front-connect")] : []));
        return;
      }
      sharing = hub.shareBuilding === true;
      autoConnect = hub.autoConnect !== false;
      meId = hub.user?.id ?? meId;
      if (!hub.front) {
        root.dataset.state = "unsupported";
        status.textContent = "This room service has no front page yet. Rooms and the Project hub still work.";
        body.replaceChildren();
        return;
      }
      let answer;
      try { answer = await api.hubRoom("front"); } catch { answer = null; }
      if (gone || mine !== seq) return;
      if (!answer?.ok) {
        status.textContent = page ? "The Lobby could not be read just now. It tries again in a minute." : "The Lobby could not be read. It tries again in a minute.";
        schedule();
        return;
      }
      page = answer;
      readAt = Date.now();
      if (!holding && hub.lobby) { holding = true; api.hubSubscribe?.("lobby", true, "rooms"); }
      root.dataset.state = "ready";
      status.textContent = "";
      if (page.ownRoom && code?.roomId !== page.ownRoom.id) {
        code = { roomId: page.ownRoom.id, code: null, link: null };
        void Promise.resolve(api.hubRoom("roomCode", page.ownRoom.id)).then((held) => {
          if (held?.ok && code?.roomId === page?.ownRoom?.id) { code = { roomId: page.ownRoom.id, code: held.code, link: held.link ?? null }; if (!gone) paint(); }
        }).catch(() => {});
      }
      if (!page.ownRoom) code = null;
      paint();
      schedule();
    }

    function mast() {
      const head = node("header", "front-mast");
      const left = node("div", "front-ear");
      left.append(node("p", "front-date", new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })));
      const hi = button(page.lobby.here ? `Say hi in the Lobby · ${page.lobby.here} there` : "Say hi in the Lobby", () => goPlace("rooms", { room: "lobby" }), "front-link", "friends-front-lobby");
      left.append(hi);
      const waiting = Number(window.MefiRooms?.pending?.() ?? 0);
      if (waiting > 0) left.append(button(`${waiting} waiting for you in Rooms`, () => goPlace("rooms"), "front-link front-waiting", "friends-front-waiting"));
      const plate = node("div", "front-plate");
      const name = node("h2", "front-nameplate", "The Lobby");
      name.id = "friends-front-title";
      plate.append(name, node("p", "front-motto", "What your friends are making"));
      const right = node("div", "front-ear front-ear-end");
      const online = node("p", "front-online-count");
      online.append(node("span", "front-dot"), document.createTextNode(` ${page.online.count} online now`));
      const you = page.you;
      right.append(online, node("p", "", `You: ${rankName(you.rank?.key)} · ${plural(you.balance, "credit")}`));
      head.append(left, plate, right);
      return head;
    }

    function onlineRow() {
      const list = node("ul", "front-people");
      list.setAttribute("aria-label", "Online now");
      for (const person of page.online.people) {
        const item = node("li", "front-who");
        item.dataset.person = person.id;
        const face = node("span", "front-avatar", initials(person.name));
        face.style.setProperty("--who-hue", String(hue(person.id)));
        face.setAttribute("aria-hidden", "true");
        const text = node("span", "front-who-text");
        text.append(node("b", "", person.name), node("small", "", person.where ? `${rankName(person.rank)} · In ${person.where.id === "lobby" ? "the Lobby" : person.where.name}` : `${rankName(person.rank)} · In Studio`));
        if (person.where) {
          const go = button("", () => goPlace("rooms", { room: person.where.id }), "front-who-go");
          go.setAttribute("aria-label", `${person.name}, in ${person.where.name}. Open the room.`);
          go.append(face, text);
          item.append(go);
        } else item.append(face, text);
        list.append(item);
      }
      if (!page.online.people.length) list.append(node("li", "front-empty", "Nobody else is in Studio right now. Share your invite code below to bring friends in."));
      return list;
    }

    // Friends sharing what they build: a small tree each, the project at the root, a lit leaf per running task and a dim one per task finished today.
    function buildingNow() {
      const makers = page.online.people.filter((person) => person.building);
      if (!makers.length) return null;
      const box = node("section", "front-building");
      box.setAttribute("aria-label", "Building now");
      box.append(node("h3", "front-col-title", "Building now"));
      const list = node("ul", "front-building-list");
      for (const person of makers) {
        const made = person.building;
        const item = node("li", "front-building-item");
        const tree = node("span", "front-tree");
        tree.setAttribute("aria-hidden", "true");
        tree.append(node("span", "front-tree-root"));
        const leaves = node("span", "front-tree-leaves");
        for (let n = 0; n < Math.min(made.running, 6); n += 1) leaves.append(node("span", "front-tree-leaf run"));
        for (let n = 0; n < Math.min(made.doneToday, 6); n += 1) leaves.append(node("span", "front-tree-leaf done"));
        tree.append(leaves);
        const words = node("span", "front-building-text");
        words.append(node("b", "", `${person.name} · ${made.project}`), node("small", "", `${made.running} running · ${made.doneToday} done today`));
        item.append(tree, words);
        list.append(item);
      }
      box.append(list);
      return box;
    }

    function lead() {
      const story = node("article", "front-lead");
      const top = page.top;
      if (!top) {
        story.append(node("p", "front-kicker", "Project hub"), node("h3", "front-lead-title", "Nothing shared yet"),
          node("p", "front-dek", "Share what you make. When a friend plays it for two minutes, you both earn credits."),
          button("Share a project", () => goPlace("hub"), "ghost", "friends-front-share"));
        return story;
      }
      story.append(node("p", "front-kicker", top.week ? "Top project this week" : "Top project"));
      story.append(node("h3", "front-lead-title", top.title));
      story.append(node("p", "front-dek", top.blurb || `${top.owner.name}'s ${KINDS[top.kind] ?? "project"} on ${top.host}.`));
      const by = node("p", "front-byline");
      const facts = [`${top.owner.name} · ${rankName(top.owner.rank)}`, `Shared ${when(top.createdAt)}`, KINDS[top.kind] ?? "project", top.week ? `${plural(top.weekPlays, "play")} this week` : plural(top.plays, "play"), plural(top.stars, "star")];
      by.textContent = facts.join(" · ");
      const play = button("Play", () => {
        // A playlist (renderer/playlists.js) plays in Studio's own player; the play counts the same way.
        const playlist = window.MefiPlaylists?.fromLink?.(top.url, top.title);
        const asked = playlist ? window.mefiStudio?.hubProjects?.("playProject", top.id, { here: true }) : window.mefiStudio?.hubProjects?.("playProject", top.id);
        void Promise.resolve(asked).then((answer) => {
          const hold = page.you.hold;
          if (playlist) window.MefiPlaylists.play(playlist);
          const opened = playlist ? "Playing in Studio" : "Opened in your browser";
          status.textContent = !answer?.ok ? (playlist ? "Playing in Studio; this play won't count right now." : "That project could not be opened.")
            : top.owner.id === meId ? `${playlist ? "Playing your own playlist in Studio" : "Opened your own project in your browser"}. Your own plays don't earn credits.`
            : hold ? `${opened}. ${HOLD_WORDS[hold.reason] ?? "Credits start once your account is in good standing"}, so this play won't earn yet.`
            : `${opened}. After two minutes you both earn credits.`;
        }).catch(() => { status.textContent = "That project could not be opened."; });
      }, "ghost front-play", "friends-front-play");
      story.append(by, play);
      return story;
    }

    function column(title, items, empty) {
      const col = node("section", "front-col");
      col.append(node("h3", "front-col-title", title));
      if (!items.length) col.append(node("p", "front-empty", empty));
      for (const item of items) col.append(item);
      return col;
    }
    function entry(title, meta, run = null) {
      const item = run ? button("", run, "front-item") : node("div", "front-item");
      item.append(node("b", "", title), node("small", "", meta));
      return item;
    }

    function columns() {
      const row = node("div", "front-cols");
      const rooms = page.rooms.map((room) => entry(room.name, [room.kind === "cowork" ? "Cowork" : "Hangout", plural(room.memberCount, "person", "people"), room.here ? `${room.here} here now` : null, room.you === "owner" ? "yours" : room.listed ? null : "private"].filter(Boolean).join(" · "), () => goPlace("rooms", { room: room.id })));
      row.append(column("Rooms open now", rooms, "No rooms open right now. Make one in Rooms."));
      const fresh = page.fresh.map((project) => entry(project.title, `${project.owner.name} · ${KINDS[project.kind] ?? "project"} · ${plural(project.plays, "play")}`, () => goPlace("hub")));
      if (page.rankUps.length) fresh.push(entry("Rank ups", page.rankUps.map((item) => `${item.name} reached ${item.rank.name}`).join(" · ")));
      row.append(column("New this week", fresh, "Nothing new this week yet."));
      const you = page.you;
      const mine = node("div", "front-you");
      mine.append(node("span", "front-big", String(you.balance)));
      const words = node("span", "front-you-words", `credits · rank ${rankName(you.rank?.key)}`);
      if (you.rank?.next) words.append(node("small", "", `${Math.max(0, you.rank.next.at - you.lifetime)} more to ${you.rank.next.name}`));
      mine.append(words);
      const week = [];
      if (you.week.plays) week.push(entry(`Your projects got ${plural(you.week.plays, "play")}`, `+${you.week.earned} credits this week`, () => goPlace("hub")));
      else if (you.week.earned) week.push(entry(`+${you.week.earned} credits this week`, "From playing friends' projects", () => goPlace("hub")));
      if (you.week.stars) week.push(entry(plural(you.week.stars, "new star"), "On your projects this week", () => goPlace("hub")));
      if (!week.length) {
        if (you.hold) week.push(entry(HOLD_WORDS[you.hold.reason] ?? "Credits start once your account is in good standing", you.hold.until ? `From ${new Date(you.hold.until).toLocaleDateString([], { day: "numeric", month: "long" })}` : "Plays and stars from friends count then", () => goPlace("hub")));
        else if (!you.projects) week.push(entry("Share a project to start earning", "Plays and stars earn you credits", () => goPlace("hub")));
        else week.push(entry("No plays yet this week", "Ask friends to play what you shared, and play theirs", () => goPlace("hub")));
      }
      row.append(column("Your week", [mine, ...week], ""));
      return row;
    }

    function foot() {
      const bar = node("footer", "front-foot");
      const toggle = node("label", "front-visible");
      const tick = node("input");
      tick.type = "checkbox";
      tick.id = "friends-front-visible";
      tick.checked = page.visible !== false;
      tick.addEventListener("change", () => {
        void Promise.resolve(api.hubRoom("setOnlineVisible", tick.checked)).then((answer) => {
          if (answer?.ok) { page.visible = answer.visible; status.textContent = answer.visible ? "Friends can see you're online." : "You're hidden from Who's online."; }
          else { tick.checked = !tick.checked; status.textContent = "That didn't save. Check your connection and try again."; }
        }).catch(() => { tick.checked = !tick.checked; });
      });
      toggle.append(tick, node("span", "", "Show me as online"));
      const pops = node("label", "front-visible");
      const popTick = node("input");
      popTick.type = "checkbox";
      popTick.id = "friends-front-popups";
      popTick.checked = popups.on();
      popTick.addEventListener("change", () => { popups.set(popTick.checked); status.textContent = popTick.checked ? "Pop-ups from friends are on." : "Pop-ups from friends are off."; });
      pops.append(popTick, node("span", "", "Pop-ups from friends"));
      const share = node("label", "front-visible");
      const shareTick = node("input");
      shareTick.type = "checkbox";
      shareTick.id = "friends-front-building";
      shareTick.checked = sharing;
      shareTick.addEventListener("change", () => {
        void Promise.resolve(api.hubRoom("shareBuilding", shareTick.checked)).then((answer) => {
          if (answer?.ok) { sharing = answer.shareBuilding === true; status.textContent = sharing ? "Friends see your project's name and how many tasks run, never what they are." : "You stopped sharing what you're building."; }
          else { shareTick.checked = !shareTick.checked; status.textContent = "That didn't save. Check your connection and try again."; }
        }).catch(() => { shareTick.checked = !shareTick.checked; });
      });
      share.append(shareTick, node("span", "", "Share what I'm building"));
      // On: Friends connects again after every restart, update and wake from sleep.
      const again = node("label", "front-visible");
      const againTick = node("input");
      againTick.type = "checkbox";
      againTick.id = "friends-front-reconnect";
      againTick.checked = autoConnect;
      againTick.addEventListener("change", () => {
        void Promise.resolve(api.hubRoom("autoConnect", againTick.checked)).then((answer) => {
          if (answer?.ok) { autoConnect = answer.autoConnect === true; status.textContent = autoConnect ? "Friends reconnects by itself after restarts, updates and sleep." : "Friends stays off after a restart until you Connect."; }
          else { againTick.checked = !againTick.checked; status.textContent = "That didn't save. Try again."; }
        }).catch(() => { againTick.checked = !againTick.checked; });
      });
      again.append(againTick, node("span", "", "Reconnect by itself"));
      bar.append(toggle, pops, share, again);
      const invite = node("span", "front-invite");
      if (code?.code) {
        invite.append(document.createTextNode("Invite code "), node("b", "front-code", code.code));
        invite.append(button("Copy invite", () => {
          const text = `Join me in Mefi Studio: open Friends › Rooms, choose Join with a code, and enter ${code.code}.${code.link ? ` ${code.link}` : ""}`;
          void Promise.resolve(globalThis.navigator?.clipboard?.writeText?.(text)).then(() => { status.textContent = "Invite copied. Paste it anywhere: Discord, a text, an email."; }, () => { status.textContent = `Your code is ${code.code}.`; });
        }, "ghost", "friends-front-copy"));
      } else if (page.ownRoom) invite.append(node("span", "", "Getting your invite code…"));
      else invite.append(button("Make a room to invite friends", () => goPlace("rooms"), "ghost", "friends-front-make"));
      bar.append(invite);
      return bar;
    }

    // This week's community events (Friends › Events), when the room service runs them.
    function eventsRow() {
      const jam = page.events?.jam, cowork = page.events?.cowork;
      if (!jam && !cowork) return null;
      const box = node("section", "front-events");
      box.setAttribute("aria-label", "This week");
      box.append(node("h3", "front-col-title", "This week"));
      const day = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleDateString([], { weekday: "long" }) : "");
      const hour = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
      if (jam) {
        const phase = jam.phase === "entries" ? `Entries open until ${day(jam.entriesUntil)}${jam.entered ? " · you're in" : ""}` : jam.phase === "voting" ? `Voting until ${day(jam.endsAt)}` : "The results are in";
        box.append(entry(`Build Jam: ${jam.theme}`, `${phase} · ${jam.entries ?? 0} ${jam.entries === 1 ? "entry" : "entries"}`, () => goPlace("events")));
      }
      if (cowork) {
        const now = Date.now();
        const on = Number.isFinite(cowork.startsAt) && cowork.startsAt <= now && (!Number.isFinite(cowork.endsAt) || cowork.endsAt > now);
        box.append(entry("Cowork hour", on ? `On now · ${cowork.here ?? 0} here` : `Next at ${hour(cowork.startsAt)}`, () => goPlace("events")));
      }
      return box;
    }

    function paint() {
      if (!page) return;
      // A repaint gives keyboard focus back to the same control.
      const focused = typeof document !== "undefined" && root.contains?.(document.activeElement) ? document.activeElement.id : null;
      body.replaceChildren(...[mast(), onlineRow(), buildingNow(), eventsRow(), lead(), columns(), foot()].filter(Boolean));
      if (focused) document.getElementById?.(focused)?.focus?.({ preventScroll: true });
      window.MefiScroll?.scan?.(root);
    }

    // The connection or the member's credits changed: read again (not more than a frame's worth).
    function hear(event) {
      if (gone || root.isConnected === false) { dispose(); return; }
      if (event?.type === "status" || event?.type === "credits" || event?.type === "played") void load();
      // Someone arrived in or left the Lobby: read again, not more than once every ten seconds.
      else if (event?.type === "presence" && event.roomId === "lobby" && !soon) {
        soon = setTimeout(() => { soon = null; if (!gone) void load(); }, Math.max(1500, readAt + 10_000 - Date.now()));
      }
    }
    function dispose() {
      if (gone) return;
      gone = true;
      seq += 1;
      clearTimeout(timer);
      clearTimeout(soon);
      timer = null;
      if (holding) { holding = false; api.hubSubscribe?.("lobby", false, "rooms"); }
      if (current === handle) current = null;
    }
    const handle = { hear, dispose };
    current = handle;
    root.dispose = dispose;
    void load();
    return root;
  }

  window.MefiFriendsFront = { gate, card, popups, hubState };
  // Pop-ups need the hub listener with Friends closed too.
  listen(bridge());
})();
