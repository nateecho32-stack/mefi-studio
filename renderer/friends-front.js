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
// with "Show me as online" and an invite code at the foot. It reads again
// every minute while it is on screen and the window can be seen, and stops
// when Friends lets it go (dispose). Everything is text: names and titles go
// in with textContent, and nothing from the relay becomes a link.
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
  const when = (ms) => {
    if (!Number.isFinite(ms)) return "";
    const days = Math.floor((Date.now() - ms) / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : new Date(ms).toLocaleDateString([], { weekday: "long" });
  };

  // ---- the sign-in card -------------------------------------------------------
  function gate({ onSignedIn } = {}) {
    const root = node("section", "friends-gate");
    root.id = "friends-gate";
    root.setAttribute("aria-labelledby", "friends-gate-title");
    const title = node("h2", "friends-gate-title", "Friends");
    title.id = "friends-gate-title";
    const lead = node("p", "friends-gate-lead", "See who's online, join a room, and share what you make with people who build with Studio.");
    const actions = node("div", "friends-gate-actions");
    const status = node("p", "friends-gate-status");
    status.id = "friends-gate-status";
    status.setAttribute("role", "status");
    const fine = node("p", "friends-gate-fine", "Studio asks Discord for your name and your Void Engine server roles. Nothing you type in a room is stored on the server.");
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

  // ---- The Lobby: the front page ------------------------------------------------
  let current = null; // the card on screen: { hear }
  let hearing = false;
  function listen(api) {
    if (hearing || typeof api?.onHubEvent !== "function") return;
    hearing = true;
    api.onHubEvent((event) => { current?.hear(event); });
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
    let page = null; // the last front page read
    let code = null; // { roomId, code, link } for the member's own room

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (gone || root.isConnected === false) { dispose(); return; }
        if (typeof document !== "undefined" && document.visibilityState === "hidden") { schedule(); return; }
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
        status.textContent = hub.state === "connecting" ? "Connecting to the room service…" : "Not connected to the room service.";
        body.replaceChildren(button("Connect", () => { tried = false; void Promise.resolve(api.hubConnect()).finally(() => load()); }, "ghost", "friends-front-connect"));
        return;
      }
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
        void Promise.resolve(window.mefiStudio?.hubProjects?.("playProject", top.id)).then((answer) => {
          status.textContent = answer?.ok ? "Opened in your browser. After two minutes you both earn credits." : "That project could not be opened.";
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
      if (!week.length) week.push(entry("Share a project to start earning", "Plays and stars earn you credits", () => goPlace("hub")));
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
          else { tick.checked = !tick.checked; status.textContent = "That didn't save. Try again."; }
        }).catch(() => { tick.checked = !tick.checked; });
      });
      toggle.append(tick, node("span", "", "Show me as online"));
      bar.append(toggle);
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

    function paint() {
      if (!page) return;
      body.replaceChildren(mast(), onlineRow(), lead(), columns(), foot());
      window.MefiScroll?.scan?.(root);
    }

    // The connection or the member's credits changed: read again (not more than a frame's worth).
    function hear(event) {
      if (gone || root.isConnected === false) { dispose(); return; }
      if (event?.type === "status" || event?.type === "credits" || event?.type === "played") void load();
    }
    function dispose() {
      gone = true;
      seq += 1;
      clearTimeout(timer);
      timer = null;
      if (current === handle) current = null;
    }
    const handle = { hear, dispose };
    current = handle;
    root.dispose = dispose;
    void load();
    return root;
  }

  window.MefiFriendsFront = { gate, card };
})();
