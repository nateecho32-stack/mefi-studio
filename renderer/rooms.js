// Friends › Rooms: the member's rooms on the Void Engine hub, joining by
// request or invite, deciding requests for rooms they own, and room chat.
// Everything goes through main's hub:room channel (scripts/hub-client.cjs
// checks every argument against the hub protocol) plus the hub* status and
// connect calls renderer/together.js already uses. Messages are shown with
// textContent only, links are never made clickable, and `<@id>` mentions show
// as @name from the message's own mention list. pending() is what the Friends
// badge adds: invites to answer and requests to decide.
//
// One hub listener serves the module: it hands frames to the panel on screen,
// and with Friends closed it still re-counts invites and requests for the
// badge. A panel holds its open room as "rooms" (hub-client HOLDERS) and lets
// go when it closes: dispose(), which companion-hub calls before it clears the
// Friends section. A repaint keeps what the owner was typing and each
// message's own row.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, id) => { const el = node("button", "ghost rooms-button", text); el.type = "button"; if (id) el.id = id; el.addEventListener("click", run); return el; };
  const bridge = () => window.mefiStudio;
  const REASONS = {
    "listed-rank": "Showing a room in the list opens at Flame rank (200 credits, earned when friends play and star what you share). Leave \"Show it in the room list\" off to make a private room and invite people with its code.",
    "room-host-role": "Showing a room in the list needs the Room Host role in the Void Engine server.",
    "new-member": "New members can do this after their first day in the server.",
    "week-member": "Making your own rooms opens after your first week in the Void Engine server. Until then, join friends' rooms with their invite code or from the list, and say hi in the Lobby.",
    "owned-rooms": "You already own 3 open rooms. Close one first.",
    "daily-creates": "You have made 5 rooms today. Try again tomorrow.",
    "hub-full": "The room service is full right now.",
    "room-full": "That room is full.",
    "pending-requests": "You already have 3 requests waiting.",
    "daily-requests": "You have asked to join 10 rooms today. Try again tomorrow.",
    "room-requests": "That room has too many requests waiting.",
    "daily-invites": "You have sent 20 invites today. Try again tomorrow.",
    "invite-only": "That room is invite-only.",
    locked: "That room is locked.",
    "already-member": "You are already in that room.",
    "already-decided": "Someone already answered that request.",
    invited: "You are already invited. Accept the invite instead.",
    removed: "You were removed from that room. You can ask again after 30 days.",
    "links-not-allowed": "New members can share links after their first day in the server.",
    expired: "That has expired.",
    closed: "That room is closed.",
    "owner-must-close": "Owners close their room instead of leaving it.",
    self: "That is you.",
    paused: "The room service is paused right now.",
    "rate-limited": "Slow down a moment, then try again.",
    "read-only": "Your account is read-only in the server right now.",
    "not-member": "You are not in that room.",
    unavailable: "Discord did not answer. Try again in a moment.",
    offline: "Not connected to the room service.",
    timeout: "The room service did not answer in time. Try again.",
    "not-yours": "Only the person who posted it can change it.",
    "room-busy": "That room is busy. Try again in a moment.",
    auth: "Your Discord sign-in has run out. Sign in with Discord again in Friends.",
    version: "The room service needs a newer Studio. Update Studio; it reconnects by itself after the update.",
    "relay-behind": "The room service is being updated. Studio reconnects by itself in a few minutes.",
    unsupported: "This copy of Studio cannot reach the room service.",
    lobby: "Everyone stays in the Lobby. Go back to All rooms to step out of it.",
    code: "That code didn't match a room. Check it and try again.",
  };
  // A tab row's keys: arrows, Home and End choose the next tab, and focus follows it after the repaint.
  function arrowKeys(row) {
    row.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step && event.key !== "Home" && event.key !== "End") return;
      const items = [...row.children];
      const at = items.indexOf(event.target);
      if (at < 0) return;
      event.preventDefault?.();
      const next = items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + step + items.length) % items.length];
      next.click();
      const id = next.id;
      const settle = () => (typeof document !== "undefined" ? document.getElementById?.(id)?.focus?.() : null);
      settle();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(settle);
    });
  }

  // Two-step confirm (studio-ui.js MefiUi.arm): the first press asks, the
  // second acts. Without the shared helper (a bare page), the browser asks.
  const confirmed = (label, armed, ask, run) => (window.MefiUi?.arm
    ? window.MefiUi.arm(button(label, () => {}), { run, armed })
    : button(label, () => { if (window.confirm?.(ask) !== false) run(); }));
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback);
  const why = (answer, fallback) => REASONS[answer?.reason] || REASONS[answer?.error] || fallback;
  const time = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  // A room frame is the same for every member, so it may not say what you are
  // in it ("none"); keep what this panel knew.
  const merged = (was, next) => ({ ...was, ...next, you: next?.you === "none" && was?.you ? was.you : next?.you });
  const counts = { invites: 0, decide: 0 };
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) { try { fn(); } catch {} } };
  let current = null; // the panel on screen: { hear, dispose }
  let hearing = false;
  let recounting = null;

  function pending() { return counts.invites + counts.decide; }
  function subscribe(fn) { listeners.add(fn); listen(bridge()); return () => listeners.delete(fn); }
  function tally(invites, requests, me) {
    if (Array.isArray(invites)) counts.invites = invites.filter((item) => item.status === "pending").length;
    if (Array.isArray(requests)) counts.decide = requests.filter((item) => item.status === "pending" && item.requester?.id !== me?.id).length;
    notify();
  }
  // With Friends closed, an invite or a request to decide still reaches the badge.
  function recountQuietly(api) {
    if (recounting || typeof api?.hubRoom !== "function" || typeof api?.hubStatus !== "function") return recounting;
    recounting = (async () => {
      try {
        const hub = (await api.hubStatus())?.status;
        if (hub?.state !== "ready") return;
        const [requestList, inviteList] = await Promise.all([api.hubRoom("requests"), api.hubRoom("invites")]);
        tally(inviteList?.ok ? inviteList.invites : null, requestList?.ok ? requestList.requests : null, hub.user);
      } catch {} finally { recounting = null; }
    })();
    return recounting;
  }
  function listen(api) {
    if (hearing || typeof api?.onHubEvent !== "function") return;
    hearing = true;
    api.onHubEvent((event) => {
      if (current) current.hear(event);
      else if (["status", "joinRequest", "invite", "membership"].includes(event?.type)) void recountQuietly(api);
    });
  }

  // The text of a message with its <@id> mentions as @name: the message's own
  // list first, then a name this panel knows (lookup), else "@someone".
  function readable(message, lookup = null) {
    const names = new Map((message.mentions ?? []).map((item) => [item.id, item.name]));
    return String(message.text ?? "").replace(/<@!?(\d{17,20})>/g, (raw, id) => `@${names.get(id) || lookup?.(id) || "someone"}`);
  }
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";

  function panel(options = {}) {
    const root = node("section", "rooms");
    root.id = "rooms";
    root.setAttribute("aria-labelledby", "rooms-title");
    const title = node("h4", "rooms-title", "Rooms");
    title.id = "rooms-title";
    const status = node("p", "rooms-status", "Checking the room service…");
    status.id = "rooms-status";
    status.setAttribute("role", "status");
    const body = node("div", "rooms-body");
    root.append(title, status, body);
    const api = bridge();
    if (typeof api?.hubRoom !== "function" || typeof api?.hubStatus !== "function") {
      status.textContent = "Rooms work in the desktop app.";
      root.dataset.state = "unavailable";
      return root;
    }
    listen(api);
    current?.dispose();
    let me = null, tab = "rooms", openRoom = null, busy = false, openSeq = 0;
    // What the room service carries (hub-client status): the Lobby, join codes, Who's online.
    let flags = { lobby: false, joinCodes: false, online: false };
    let lobbyOpened = false, people = null, showOnline = true, onlineTimer = null;
    let wanted = typeof options?.room === "string" && options.room ? options.room : null;
    let creating = false, roomMenu = false, here = [], hereBox = null;
    const messageMenus = new Set(); // messages whose small menu is open
    const codes = new Map(); // room id -> { code, link }
    let rooms = [], requests = [], invites = [], messages = [], more = false;
    // Fields keyed by what they hold. A repaint gives each its text back, and
    // a field that is off screen (another tab, another room) keeps its draft.
    const fields = new Map();
    const drafts = new Map();
    const field = (el, key) => { el.dataset.draft = key; fields.set(key, el); return el; };
    const asking = new Set(); // rooms whose join note is open
    const reporting = new Set(); // messages whose report reason is open
    const rows = new Map(); // message id -> { message, item }

    const call = async (method, ...args) => {
      try { return await api.hubRoom(method, ...args); } catch (error) { return { ok: false, error: "failed", message: error?.message }; }
    };
    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      root.setAttribute("aria-busy", "true");
      if (label) status.textContent = label;
      try { await work(); } catch (error) { status.textContent = plain(error, "Rooms could not do that. Try again."); }
      busy = false;
      root.removeAttribute("aria-busy");
    };
    // The list only repaints while it is on screen; a refresh under an open
    // room still brings the counts up to date.
    async function refresh({ repaint = !openRoom } = {}) {
      const [roomList, requestList, inviteList] = await Promise.all([api.hubRooms(), call("requests"), call("invites")]);
      rooms = roomList?.ok ? roomList.rooms : rooms;
      requests = requestList?.ok ? requestList.requests : requests;
      invites = inviteList?.ok ? inviteList.invites : invites;
      tally(invites, requests, me);
      if (repaint) paint();
    }

    function tabs() {
      const row = node("div", "rooms-tabs");
      row.setAttribute("role", "tablist");
      const places = [["rooms", "Rooms"], ...(flags.online ? [["online", people ? `Online (${people.length})` : "Online"]] : []), ["requests", `Requests${counts.decide ? ` (${counts.decide})` : ""}`], ["invites", `Invites${counts.invites ? ` (${counts.invites})` : ""}`]];
      for (const [id, label] of places) {
        const item = button(label, () => { tab = id; paint(); if (id === "online") void loadOnline(); }, `rooms-tab-${id}`);
        item.setAttribute("role", "tab");
        item.setAttribute("aria-selected", String(tab === id));
        item.tabIndex = tab === id ? 0 : -1;
        row.append(item);
      }
      arrowKeys(row);
      return row;
    }

    function roomRow(room) {
      const row = node("li", "rooms-row rooms-card");
      row.dataset.room = room.id;
      const text = node("div", "rooms-row-text");
      const people = `${room.memberCount}${room.maxMembers ? ` of ${room.maxMembers}` : ""} ${room.memberCount === 1 ? "person" : "people"}`;
      const meta = [room.kind === "cowork" ? "Cowork" : "Hangout", people, room.you === "owner" ? "yours" : room.you === "member" ? "you're in" : null, room.listed ? null : "private", room.status !== "active" ? room.status : null].filter(Boolean).join(" · ");
      text.append(node("strong", "rooms-card-name", room.name), node("span", "muted rooms-card-meta", meta));
      const actions = node("div", "rooms-row-actions");
      const mine = requests.find((item) => item.roomId === room.id && item.requester.id === me?.id && item.status === "pending");
      const invitation = invites.find((item) => item.roomId === room.id && item.status === "pending");
      const askable = !(room.you === "owner" || room.you === "member") && !invitation && !mine && room.policy === "request" && room.status === "active";
      if (room.you === "owner" || room.you === "member") actions.append(button("Open", () => { void open(room); }));
      else if (invitation) actions.append(button("Join", () => answerInvite(invitation, true)), button("Decline", () => answerInvite(invitation, false)));
      else if (mine) actions.append(node("span", "muted", "Requested"), button("Cancel", () => cancel(mine)));
      else if (askable) actions.append(button("Ask to join", () => { if (!asking.has(room.id)) { asking.add(room.id); ask(room, row); } }));
      row.append(text, actions);
      if (askable && asking.has(room.id)) ask(room, row);
      return row;
    }

    function ask(room, row) {
      const note = field(node("input", "rooms-note"), `note:${room.id}`);
      note.type = "text";
      note.maxLength = 300;
      note.placeholder = "A short note for the owner (optional)";
      note.setAttribute("aria-label", `Note to the owner of ${room.name}`);
      const send = button("Send request", () => guard("Asking to join…", async () => {
        const answer = await call("requestJoin", room.id, note.value);
        status.textContent = answer?.ok ? `Asked to join ${room.name}. The owner will decide.` : why(answer, "The request did not go through.");
        if (answer?.ok) { asking.delete(room.id); note.value = ""; await refresh(); }
      }));
      row.append(note, send);
    }
    const cancel = (request) => guard("Cancelling…", async () => {
      const answer = await call("cancelRequest", request.id);
      status.textContent = answer?.ok ? "Request cancelled." : why(answer, "The request could not be cancelled.");
      await refresh();
    });
    const answerInvite = (invite, accept) => guard(accept ? "Joining…" : "Declining…", async () => {
      const answer = await call(accept ? "acceptInvite" : "declineInvite", invite.id);
      status.textContent = answer?.ok ? (accept ? `You joined ${invite.roomName}.` : "Invite declined.") : why(answer, "That did not go through.");
      await refresh();
    });
    const decide = (request, approve) => guard(approve ? "Letting them in…" : "Declining…", async () => {
      const answer = await call("decide", request.id, approve ? "approve" : "deny");
      status.textContent = answer?.ok ? (approve ? `${request.requester.name || "They"} can join now.` : "Request declined.") : why(answer, "That did not go through.");
      await refresh();
    });

    // "New room" opens this small form; it closes again when the room is made.
    function createForm() {
      const form = node("div", "rooms-create");
      form.append(node("h5", "", "New room"));
      const name = field(node("input", "rooms-name"), "create-name");
      name.type = "text";
      name.maxLength = 80;
      name.id = "rooms-create-name";
      name.placeholder = "Room name";
      name.setAttribute("aria-label", "Room name");
      const kind = field(node("select", "rooms-select"), "create-kind");
      kind.id = "rooms-create-kind";
      kind.setAttribute("aria-label", "Kind of room");
      for (const [value, label] of [["hangout", "Hangout (up to 25)"], ["cowork", "Cowork (up to 10)"]]) { const option = node("option", "", label); option.value = value; kind.append(option); }
      kind.value = "hangout";
      const policy = field(node("select", "rooms-select"), "create-policy");
      policy.id = "rooms-create-policy";
      policy.setAttribute("aria-label", "Who can join");
      for (const [value, label] of [["request", "Anyone can ask to join"], ["invite", "Invite only"]]) { const option = node("option", "", label); option.value = value; policy.append(option); }
      policy.value = "request";
      const listedLabel = node("label", "rooms-check");
      const listed = field(node("input"), "create-listed");
      listed.type = "checkbox";
      listed.id = "rooms-create-listed";
      // Off to start: a private room anyone a week in the server can make; listing it opens at Flame rank.
      listed.checked = false;
      listedLabel.append(listed, node("span", "", " Show it in the room list (opens at Flame rank)"));
      const create = button("Make room", () => guard("Making the room…", async () => {
        const answer = await call("createRoom", { name: name.value.trim(), kind: kind.value, policy: policy.value, listed: listed.checked });
        status.textContent = answer?.ok ? `${answer.room.name} is ready. Open it, then share its invite code.` : why(answer, answer?.error === "bad-request" ? "Give the room a one-line name of up to 80 characters." : "The room could not be made.");
        if (answer?.ok) { name.value = ""; creating = false; await refresh(); }
      }), "rooms-create");
      const actions = node("div", "rooms-row-actions");
      actions.append(create, button("Cancel", () => { creating = false; paint(); }, "rooms-create-cancel"));
      form.append(name, kind, policy, listedLabel, actions);
      return form;
    }

    function listView() {
      const list = node("ul", "rooms-list rooms-cards");
      const shown = rooms.filter((room) => room.status !== "closed");
      list.append(...shown.map(roomRow));
      if (!shown.length) list.append(node("li", "muted rooms-empty", "No rooms yet. Make one, join with a friend's code, or say hi in the Lobby."));
      const tools = node("div", "rooms-tools");
      if (flags.joinCodes) tools.append(joinRow());
      tools.append(button(creating ? "Close the form" : "New room", () => { creating = !creating; paint(); }, "rooms-new"));
      return [tools, ...(creating ? [createForm()] : []), list];
    }

    // ---- connecting made simple: a join code, and who is online ----------------
    function joinRow() {
      const row = node("div", "rooms-join");
      const box = field(node("input", "rooms-note"), "join-code");
      box.type = "text";
      box.id = "rooms-join-code";
      box.maxLength = 24;
      box.placeholder = "Join with a code, like 7K3Q-M2XR";
      box.setAttribute("aria-label", "Join with a code");
      const go = button("Join", () => {
        if (!box.value.trim()) return;
        void guard("Joining…", async () => {
          const answer = await call("joinCode", box.value);
          if (!answer?.ok) { status.textContent = why(answer, "That code did not work."); return; }
          box.value = "";
          status.textContent = `You joined ${answer.room.name}.`;
          await refresh({ repaint: false });
          await open(rooms.find((room) => room.id === answer.room.id) ?? answer.room);
        });
      }, "rooms-join");
      box.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); go.click(); } });
      row.append(box, go);
      return row;
    }

    async function loadOnline() {
      if (onlineTimer) { clearTimeout(onlineTimer); onlineTimer = null; }
      const answer = await call("online");
      if (answer?.ok) { people = answer.people; showOnline = answer.visible !== false; }
      if (tab === "online" && !openRoom) paint();
      // Kept fresh while the list is on screen.
      if (tab === "online" && root.isConnected !== false) onlineTimer = setTimeout(() => { void loadOnline(); }, 30_000);
    }

    function onlineView() {
      const parts = [];
      const toggle = node("label", "rooms-online-toggle");
      const tick = node("input");
      tick.type = "checkbox";
      tick.id = "rooms-online-visible";
      tick.checked = showOnline;
      tick.addEventListener("change", () => guard(null, async () => {
        const answer = await call("setOnlineVisible", tick.checked);
        if (answer?.ok) showOnline = answer.visible;
        status.textContent = showOnline ? "Others can see you're online." : "You're hidden from Who's online.";
      }));
      toggle.append(tick, node("span", "", "Show me as online"));
      parts.push(toggle);
      if (!people) { parts.push(node("p", "muted", "Looking for who's online…")); return parts; }
      const list = node("ul", "rooms-list");
      const owned = rooms.filter((room) => room.you === "owner" && room.status === "active" && room.id !== "lobby");
      for (const person of people) {
        const row = node("li", "rooms-row");
        row.dataset.person = person.id;
        const text = node("div", "rooms-row-text");
        text.append(node("strong", "", person.name), node("span", "muted", ` · ${person.rank[0].toUpperCase()}${person.rank.slice(1)}`));
        const actions = node("div", "rooms-row-actions");
        for (const room of owned.slice(0, 3)) {
          actions.append(button(`Invite to ${room.name}`, () => guard("Inviting…", async () => {
            const sent = await call("invite", room.id, person.id);
            status.textContent = sent?.ok ? `Invited ${person.name} to ${room.name}. They join when they accept.` : why(sent, "The invite did not go through.");
          })));
        }
        actions.append(button("Start a room together", () => guard("Making a room…", async () => {
          const made = await call("createRoom", { kind: "hangout", name: `${me?.name || "Me"} & ${person.name}`.slice(0, 80), policy: "invite", listed: false });
          if (!made?.ok) { status.textContent = why(made, "The room could not be made."); return; }
          const sent = await call("invite", made.room.id, person.id);
          status.textContent = sent?.ok ? `Made ${made.room.name} and invited ${person.name}.` : why(sent, "The room is made, but the invite did not go through.");
          await refresh({ repaint: false });
          await open(rooms.find((room) => room.id === made.room.id) ?? made.room);
        })));
        row.append(text, actions);
        list.append(row);
      }
      if (!people.length) list.append(node("li", "muted", "Nobody else is in Studio right now. Share a room's code to bring friends in."));
      parts.push(list);
      return parts;
    }

    function inviteStrip(room) {
      const strip = node("div", "rooms-invite");
      strip.id = "rooms-invite";
      const held = codes.get(room.id);
      if (!held) { strip.append(node("span", "muted", "Getting this room's invite code…")); return strip; }
      strip.append(node("span", "", "Invite friends: code "), node("strong", "rooms-code", held.code));
      strip.append(button("Copy invite", () => {
        const text = `Join me in Mefi Studio: open Friends › Rooms, choose Join with a code, and enter ${held.code}.${held.link ? ` ${held.link}` : ""}`;
        const clip = globalThis.navigator?.clipboard;
        if (typeof clip?.writeText !== "function") { status.textContent = `Your code is ${held.code}.`; return; }
        void clip.writeText(text).then(() => { status.textContent = "Invite copied. Paste it anywhere: Discord, a text, an email."; }, () => { status.textContent = `Your code is ${held.code}.`; });
      }, "rooms-copy-invite"));
      if (room.you === "owner") strip.append(confirmed("New code", "Replace it?", "Make a new code? The old one stops working.", () => guard("Making a new code…", async () => {
        const answer = await call("newRoomCode", room.id);
        if (answer?.ok) codes.set(room.id, answer);
        status.textContent = answer?.ok ? `The new code is ${answer.code}.` : why(answer, "No new code.");
        paint();
      })));
      return strip;
    }

    function requestsView() {
      const list = node("ul", "rooms-list");
      const theirs = requests.filter((item) => item.status === "pending" && item.requester.id !== me?.id);
      const mine = requests.filter((item) => item.status === "pending" && item.requester.id === me?.id);
      const roomName = (id) => rooms.find((room) => room.id === id)?.name || "your room";
      for (const request of theirs) {
        const row = node("li", "rooms-row");
        const text = node("div", "rooms-row-text");
        text.append(node("strong", "", request.requester.name || "Someone"), node("span", "", ` wants to join ${roomName(request.roomId)}`));
        if (request.note) text.append(node("q", "rooms-quote", request.note));
        const actions = node("div", "rooms-row-actions");
        actions.append(button("Let them in", () => decide(request, true)), button("Decline", () => decide(request, false)));
        row.append(text, actions);
        list.append(row);
      }
      for (const request of mine) {
        const row = node("li", "rooms-row");
        row.append(node("span", "", `You asked to join ${roomName(request.roomId)}`), button("Cancel", () => cancel(request)));
        list.append(row);
      }
      if (!theirs.length && !mine.length) list.append(node("li", "muted", "No requests waiting."));
      return [list];
    }

    function invitesView() {
      const list = node("ul", "rooms-list");
      for (const invite of invites.filter((item) => item.status === "pending")) {
        const row = node("li", "rooms-row");
        const text = node("div", "rooms-row-text");
        text.append(node("strong", "", invite.invitedBy.name || "Someone"), node("span", "", ` invited you to ${invite.roomName}`));
        const actions = node("div", "rooms-row-actions");
        actions.append(button("Join", () => answerInvite(invite, true)), button("Decline", () => answerInvite(invite, false)));
        row.append(text, actions);
        list.append(row);
      }
      if (!list.children.length) list.append(node("li", "muted", "No invites waiting."));
      return [list];
    }

    // ---- one room: chat, and the owner's or member's controls ---------------
    const log = node("ol", "rooms-messages");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-label", "Room messages");
    // A name this panel knows for a member id: authors, the online list, requests and invites.
    function nameOf(id) {
      if (id === me?.id) return me?.name || "You";
      const author = messages.find((message) => message.author.id === id)?.author.name;
      return author || people?.find((person) => person.id === id)?.name || requests.find((item) => item.requester.id === id)?.requester.name || invites.find((item) => item.invitedBy.id === id)?.invitedBy.name || null;
    }
    // Each row is built once per message and belongs to the room it came from;
    // its Report or Delete waits in a small menu (⋯) so the chat stays quiet.
    function messageItem(message, roomId) {
      const mine = message.author.id === me?.id;
      const item = node("li", `rooms-message${mine ? " mine" : ""}`);
      item.dataset.message = message.id;
      const head = node("div", "rooms-message-head");
      head.append(node("strong", "", mine ? "You" : message.author.name || "Someone"), node("span", "muted", ` ${time(message.createdAt)}${message.editedAt ? " · edited" : ""}`));
      const canDelete = mine && message.author.viaStudio;
      const canReport = !mine;
      if (canDelete || canReport) {
        const more = button("⋯", () => { if (messageMenus.has(message.id)) messageMenus.delete(message.id); else messageMenus.add(message.id); rows.delete(message.id); showMessages(); });
        more.className = "ghost rooms-button rooms-message-more";
        more.setAttribute("aria-label", mine ? "Options for your message" : `Options for ${message.author.name || "this"} message`);
        more.setAttribute("aria-expanded", String(messageMenus.has(message.id)));
        head.append(more);
      }
      // A shared playlist shows as one to play or save (renderer/playlists.js).
      const text = window.MefiPlaylists?.card?.(String(message.text ?? "")) || node("p", "rooms-message-text", readable(message, nameOf));
      item.append(head, text);
      if (message.attachments?.length) item.append(node("p", "muted", `Attachments in Discord: ${message.attachments.map((file) => file.name).join(", ")}`));
      if (messageMenus.has(message.id)) {
        const actions = node("div", "rooms-row-actions rooms-message-actions");
        if (canDelete) actions.append(confirmed("Delete", "Delete it?", "Delete this message?", () => guard("Deleting…", async () => {
          const answer = await call("deleteMessage", roomId, message.id);
          status.textContent = answer?.ok ? "Deleted." : why(answer, "The message could not be deleted.");
        })));
        else if (canReport) actions.append(button("Report", () => { reporting.add(message.id); messageMenus.delete(message.id); rows.delete(message.id); showMessages(); }));
        item.append(actions);
      }
      if (reporting.has(message.id)) report(message, item, roomId);
      return item;
    }
    function report(message, item, roomId) {
      const reason = field(node("input", "rooms-note"), `report:${message.id}`);
      reason.type = "text";
      reason.maxLength = 500;
      reason.placeholder = "Why? Moderators see the message and this reason.";
      reason.setAttribute("aria-label", "Reason for the report");
      item.append(reason, button("Send report", () => guard("Reporting…", async () => {
        const answer = await call("report", roomId, message.id, reason.value);
        status.textContent = answer?.ok ? "Reported to the moderators. Thank you." : why(answer, "Say briefly why, then send.");
        if (answer?.ok) { reporting.delete(message.id); rows.delete(message.id); showMessages(); }
      })));
    }
    // The log keeps each message's row, so a new message never wipes a report
    // reason being typed, and it follows the newest message while the reader
    // is at the bottom.
    function showMessages({ follow = false } = {}) {
      const atEnd = !(log.scrollHeight > log.clientHeight) || log.scrollHeight - log.scrollTop - log.clientHeight < 24;
      const roomId = openRoom?.id;
      const items = messages.map((message) => {
        const known = rows.get(message.id);
        if (known?.message === message) return known.item;
        const item = messageItem(message, roomId);
        rows.set(message.id, { message, item });
        return item;
      });
      for (const id of [...rows.keys()]) if (!messages.some((message) => message.id === id)) rows.delete(id);
      log.replaceChildren(...items);
      if (follow || atEnd) log.scrollTop = log.scrollHeight;
    }
    // Friends' pets (renderer/pets.js) visit while their room is open here: the
    // relay's roomPets lists the members there with a pet (this member's own
    // too, which is left out). Another room, or none, sends them home.
    const petsHome = () => window.MefiPets?.guests?.([]);
    function petsOf(event) {
      const list = Array.isArray(event?.pets) ? event.pets : [];
      return list.map((entry) => ({ id: String(entry?.userId ?? entry?.id ?? ""), name: entry?.name, pet: entry?.pet })).filter((entry) => entry.id && entry.id !== String(me?.id ?? ""));
    }
    async function open(room) {
      const seq = ++openSeq;
      if (openRoom && openRoom.id !== room.id) { api.hubSubscribe?.(openRoom.id, false, "rooms"); petsHome(); }
      openRoom = room;
      messages = [];
      more = false;
      rows.clear();
      reporting.clear();
      paint();
      // You opened the room to talk: the caret waits in its message box, and
      // paint() keeps it there when the messages arrive.
      const compose = fields.get(`compose:${room.id}`);
      if (compose && !compose.disabled) compose.focus?.({ preventScroll: true });
      api.hubSubscribe?.(room.id, true, "rooms");
      if (flags.joinCodes && room.id !== "lobby" && !codes.has(room.id)) void call("roomCode", room.id).then((answer) => { if (answer?.ok) { codes.set(room.id, answer); if (openRoom?.id === room.id) paint(); } });
      status.textContent = "Loading messages…";
      const page = await call("messages", room.id);
      // The owner went back, or opened another room, while this page loaded.
      if (seq !== openSeq) return;
      messages = page?.ok ? page.messages : [];
      more = page?.hasMore === true;
      status.textContent = page?.ok ? "" : why(page, "Messages could not be loaded. Check your connection, then open the room again.");
      paint();
      showMessages({ follow: true });
    }
    function close() {
      openSeq += 1;
      if (openRoom) api.hubSubscribe?.(openRoom.id, false, "rooms");
      openRoom = null;
      petsHome();
      rows.clear();
      reporting.clear();
      void refresh();
    }
    // A cowork room's part in the open project: whether that project's agents
    // claim the files they edit here (main.cjs "Cowork claims"), and what is
    // claimed now. Repainted on each claims frame.
    let coworkShow = null;
    function coworkSection(room) {
      const box = node("div", "rooms-cowork");
      box.id = "rooms-cowork";
      const line = node("p", "muted", "Checking the open project…");
      const actions = node("div", "rooms-row-actions");
      const list = node("ul", "rooms-list rooms-claims");
      list.id = "rooms-claims";
      box.append(node("strong", "", "Agents working together"), line, actions, list);
      const link = (roomId) => guard(roomId ? "Linking this room…" : "Unlinking…", async () => {
        const view = await api.coworkLink(roomId);
        show(view);
        status.textContent = view?.ok ? room.name : view?.error || "That did not go through.";
      });
      const show = (view) => {
        if (!view?.ok) { line.textContent = view?.error || "The open project could not be read."; return; }
        if (!view.repo) { line.textContent = "Open a project that is on GitHub to let its agents claim files here."; actions.replaceChildren(); list.replaceChildren(); return; }
        const linked = view.roomId === room.id;
        line.textContent = linked
          ? `${view.repo}'s agents claim the files they edit here. Agents on your other PCs, and friends' in this room, leave those files alone until the work is pushed.`
          : `${view.roomId ? `${view.repo}'s agents use another cowork room now. ` : ""}Let ${view.repo}'s agents claim the files they edit here, so agents on two PCs never edit the same file at once.`;
        actions.replaceChildren(button(linked ? "Stop using this room for this project" : "Use this room for this project's agents", () => link(linked ? null : room.id), "rooms-cowork-link"));
        const rows = linked ? view.leases.map((item) => node("li", "rooms-row", `${item.here ? "This PC" : "Another PC"} · ${item.title || "Work"} · ${item.paths.slice(0, 3).join(", ")}${item.paths.length > 3 ? ` +${item.paths.length - 3} more` : ""}`)) : [];
        list.replaceChildren(...rows);
        if (linked && !rows.length) list.append(node("li", "muted", "No files are claimed right now."));
      };
      coworkShow = show;
      void Promise.resolve(api.coworkStatus?.()).then(show).catch(() => {});
      return box;
    }
    // Who is in the room in Studio now (presence frames), as small faces beside its name.
    function paintHere() {
      if (!hereBox) return;
      const ids = here.filter((id) => id !== me?.id);
      const chips = ids.slice(0, 5).map((id) => {
        const name = nameOf(id) || "Someone";
        const chip = node("span", "rooms-here-chip", initials(name));
        chip.title = name;
        chip.setAttribute("aria-label", name);
        return chip;
      });
      if (ids.length > 5) chips.push(node("span", "rooms-here-chip rooms-here-more", `+${ids.length - 5}`));
      hereBox.replaceChildren(...chips, node("span", "muted rooms-here-words", ids.length ? `${ids.length} here` : "Just you here"));
    }

    // The room's ⋯ menu: its invite code, inviting by name, agents working
    // together (cowork rooms), and Lock, Close or Leave.
    function roomPanel(room) {
      const panel = node("div", "rooms-room-panel");
      panel.id = "rooms-room-panel";
      if (flags.joinCodes) panel.append(inviteStrip(room));
      coworkShow = null;
      if (room.kind === "cowork" && room.status === "active" && ["owner", "member"].includes(room.you) && typeof api.coworkStatus === "function") panel.append(coworkSection(room));
      const controls = node("div", "rooms-row-actions");
      if (room.you === "owner") {
        const find = field(node("input", "rooms-note"), `find:${room.id}`);
        find.type = "text";
        find.maxLength = 32;
        find.placeholder = "Invite someone: type a name";
        find.setAttribute("aria-label", "Find a member to invite");
        const found = node("ul", "rooms-list");
        const search = button("Find", () => guard("Searching…", async () => {
          const answer = await call("searchMembers", find.value);
          found.replaceChildren(...(answer?.ok ? answer.members : []).map((member) => {
            const row = node("li", "rooms-row");
            row.append(node("span", "", member.name), button("Invite", () => guard("Inviting…", async () => {
              const sent = await call("invite", room.id, member.id);
              status.textContent = sent?.ok ? `Invited ${member.name}. Nobody joins until they accept.` : why(sent, "The invite did not go through.");
            })));
            return row;
          }));
          status.textContent = answer?.ok ? (answer.members.length ? "Pick who to invite." : "Nobody by that name has signed in yet.") : why(answer, "Search did not work.");
        }));
        const findRow = node("div", "rooms-join");
        findRow.append(find, search);
        panel.append(findRow, found);
        controls.append(button(room.status === "locked" ? "Unlock" : "Lock", () => guard("Updating…", async () => {
          const answer = await call(room.status === "locked" ? "unlock" : "lock", room.id);
          if (answer?.ok && openRoom?.id === room.id) openRoom = merged(openRoom, answer.room);
          status.textContent = answer?.ok ? (answer.room.status === "locked" ? "Locked: no new posts or requests." : "Unlocked.") : why(answer, "That did not go through.");
          paint();
        })), confirmed("Close room", "Close it for everyone?", `Close ${room.name}? Nobody can post or join after this. Each member's Studio keeps its own copy of the chat for a week.`, () => {
          void guard("Closing…", async () => {
            const answer = await call("close", room.id);
            status.textContent = answer?.ok ? `${room.name} is closed.` : why(answer, "The room could not be closed.");
            if (answer?.ok) close();
          });
        }));
      } else {
        controls.append(confirmed("Leave room", "Leave it?", `Leave ${room.name}?`, () => {
          void guard("Leaving…", async () => {
            const answer = await call("leave", room.id);
            status.textContent = answer?.ok ? `You left ${room.name}.` : why(answer, "You could not leave.");
            if (answer?.ok) close();
          });
        }));
      }
      panel.append(controls);
      return panel;
    }

    function composer(room) {
      const wrap = node("div", "rooms-composer");
      const box = field(node("textarea", "rooms-compose"), `compose:${room.id}`);
      box.id = "rooms-compose";
      box.maxLength = 2000;
      box.rows = 1;
      box.placeholder = room.status === "active" ? `Message ${room.name}` : "This room is not taking messages.";
      box.disabled = room.status !== "active";
      box.setAttribute("aria-label", `Message ${room.name} (Enter sends, Shift+Enter for a new line)`);
      const send = button("Send", () => {
        const text = box.value;
        if (!text.trim()) return;
        void guard(null, async () => {
          const answer = await call("sendMessage", room.id, text);
          if (answer?.ok) { box.value = ""; grow(); status.textContent = ""; }
          else status.textContent = `Not sent: ${why(answer, "try again.")}`;
        });
      }, "rooms-send");
      send.disabled = box.disabled;
      // One line that grows with what is typed, up to about six.
      const grow = () => { if (!box.style) return; box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight || 0, 140)}px`; };
      box.addEventListener("input", grow);
      box.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        if (event.shiftKey) return;
        event.preventDefault();
        send.click();
      });
      wrap.append(box, send);
      return wrap;
    }

    function roomView() {
      const room = openRoom;
      const head = node("div", "rooms-room-head");
      const back = button("‹ Rooms", close, "rooms-back");
      back.setAttribute("aria-label", "Back to all rooms");
      const title = node("div", "rooms-room-title");
      // Who reads a room: the relay passes messages to the room's members and keeps none.
      const privacy = node("span", "muted rooms-privacy", room.id === "lobby" ? "Everyone signed in from the Void Engine server is here." : flags.lobby ? "Only the people in this room get its messages. The room service keeps none." : "Void Engine moderators can read every room.");
      privacy.id = "rooms-privacy";
      title.append(node("strong", "rooms-room-name", room.name), privacy);
      hereBox = node("div", "rooms-here");
      hereBox.setAttribute("aria-label", "Who's here");
      paintHere();
      const tools = node("div", "rooms-room-tools");
      if (room.status === "active" && window.MefiMusic?.openAudio) tools.append(button("Listen together", () => { window.MefiMusic.openAudio(); window.MefiMusic.setSource?.("link"); window.MefiMusic.openSection?.("more"); }, "rooms-listen"));
      if (room.id !== "lobby") {
        const menu = button("⋯", () => { roomMenu = !roomMenu; paint(); }, "rooms-room-menu");
        menu.setAttribute("aria-label", roomMenu ? "Hide room options" : "Room options: invite, lock, leave");
        menu.setAttribute("aria-expanded", String(roomMenu));
        tools.append(menu);
      }
      head.append(back, title, hereBox, tools);
      const earlier = button("Load earlier", () => guard("Loading earlier messages…", async () => {
        const seq = openSeq;
        const page = await call("messages", room.id, messages[0]?.id ?? null);
        if (seq !== openSeq) return;
        if (page?.ok) { messages = [...page.messages, ...messages]; more = page.hasMore === true; }
        status.textContent = page?.ok ? "" : why(page, "Earlier messages could not be loaded.");
        paint();
      }), "rooms-earlier");
      earlier.hidden = !more;
      showMessages();
      const chat = node("div", "rooms-chat");
      chat.append(earlier, log);
      if (!messages.length) log.replaceChildren(node("li", "muted rooms-empty", room.id === "lobby" ? "Nobody has said anything yet. Say hi!" : "No messages yet. Say hi, or share the room's invite code from ⋯."));
      return [head, ...(roomMenu && room.id !== "lobby" ? [roomPanel(room)] : []), chat, composer(room)];
    }

    // Rebuilds the view and gives every keyed field its draft (and focus) back.
    function paint() {
      const active = typeof document !== "undefined" ? document.activeElement : null;
      let focused = null;
      for (const [key, el] of fields) {
        drafts.set(key, { value: el.value, checked: el.checked });
        if (el === active) focused = key;
      }
      fields.clear();
      root.dataset.view = openRoom ? "room" : tab;
      body.replaceChildren(...(openRoom ? roomView() : [tabs(), ...(tab === "rooms" ? listView() : tab === "online" ? onlineView() : tab === "requests" ? requestsView() : invitesView())]));
      for (const [key, el] of fields) {
        const draft = drafts.get(key);
        if (draft) { if (el.type === "checkbox") el.checked = draft.checked; else el.value = draft.value; }
        if (key === focused) el.focus?.({ preventScroll: true });
      }
    }

    // Linking happens right here: Discord asks once in the browser, then the
    // room service connects by itself. Not in the server yet: join, then check.
    let autoConnected = false;
    const connectNow = () => guard("Connecting…", async () => {
      const answer = await api.hubConnect();
      if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
    });
    async function linkHere() {
      const community = window.MefiCommunity;
      if (typeof community?.link !== "function") { window.MefiCompanionHub?.close?.({ immediate: true, restore: false }); window.MefiNav?.go?.("community"); return; }
      status.textContent = "Discord is asking in your browser. Press Authorize there, then come back.";
      const linked = await community.link();
      if (linked?.ok) { autoConnected = true; await connectNow(); return; }
      if (linked?.error === "not-member") { notMember(); return; }
      status.textContent = linked?.error === "canceled" ? "Signing in was cancelled. Press Sign in with Discord to try again." : "Signing in didn't finish. Press Sign in with Discord to try again.";
    }
    function notMember() {
      root.dataset.state = "not-member";
      status.textContent = "Your Discord account isn't in the Void Engine server yet. Join it, then check again.";
      body.replaceChildren(button("Join the Discord", () => { void window.MefiCommunity?.join?.(); }, "rooms-join"), button("I've joined, check again", () => guard("Checking…", async () => {
        const checked = await window.MefiCommunity?.check?.();
        if (checked?.ok === false && checked.error === "not-member") { notMember(); return; }
        autoConnected = true;
        const answer = await api.hubConnect();
        if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
      }), "rooms-recheck"));
    }
    function explain(hub) {
      if (!hub?.configured) {
        status.textContent = "Rooms need the room service, which this copy of Studio has no address for: add one in Settings › General › Community › Connection details.";
        root.dataset.state = "not-configured";
        body.replaceChildren();
        return false;
      }
      if (!hub.linked) {
        root.dataset.state = "not-linked";
        // Friends' one sign-in card (renderer/friends-front.js) when it is in this build.
        const gate = window.MefiFriendsFront?.gate?.({ onSignedIn: () => { autoConnected = true; void load(); } });
        status.textContent = gate ? "" : "Link your Discord account to use rooms. Discord asks once in your browser.";
        body.replaceChildren(gate ?? button("Sign in with Discord", () => { void linkHere(); }, "rooms-link"));
        return false;
      }
      if (hub.error === "not-member") { notMember(); return false; }
      // Linked and simply not connected yet: opening Rooms is the ask, so connect once by itself.
      if (hub.state === "off" && !hub.error && !autoConnected) {
        autoConnected = true;
        root.dataset.state = "connecting";
        status.textContent = "Connecting to the room service…";
        void connectNow();
        return false;
      }
      if (hub.state !== "ready") {
        root.dataset.state = hub.state || "off";
        status.textContent = hub.state === "connecting" ? "Connecting to the room service…" : hub.error ? (REASONS[hub.error] ? `Not connected. ${REASONS[hub.error]}` : "Not connected to the room service. Try Connect again.") : "Rooms are off. Connect to see your rooms.";
        body.replaceChildren(button("Connect", () => guard("Connecting…", async () => {
          const answer = await api.hubConnect();
          if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
        }), "rooms-connect"));
        return false;
      }
      root.dataset.state = "ready";
      me = hub.user ?? me;
      flags = { lobby: hub.lobby === true, joinCodes: hub.joinCodes === true, online: hub.online === true };
      return true;
    }
    async function load() {
      let hub;
      try { hub = (await api.hubStatus())?.status; } catch { hub = null; }
      if (!explain(hub)) return;
      status.textContent = hub.paused ? "The room service is paused right now; you can read but not post." : `Signed in as ${me?.name || "you"}.`;
      await refresh();
      // A room asked for by name opens; otherwise you are with everyone: the Lobby opens by itself, once.
      const asked = wanted && !openRoom ? rooms.find((room) => room.id === wanted && ["member", "owner"].includes(room.you)) : null;
      if (wanted && !openRoom && !asked) status.textContent = "That room isn't one of yours yet. Ask to join it from the list.";
      wanted = null;
      if (asked) { lobbyOpened = true; await open(asked); return; }
      const lobby = flags.lobby && !lobbyOpened && !openRoom ? rooms.find((room) => room.id === "lobby" && ["member", "owner"].includes(room.you)) : null;
      if (lobby) { lobbyOpened = true; await open(lobby); }
    }

    // Frames from the module's one hub listener, while this panel is on screen.
    function hear(event) {
      if (root.isConnected === false) {
        dispose();
        if (["status", "joinRequest", "invite", "membership"].includes(event?.type)) void recountQuietly(api);
        return;
      }
      if (event?.type === "status") { if (!openRoom) void load(); return; }
      if (openRoom && event?.type === "membership" && event.roomId === openRoom.id && (event.state === "closed" || (event.userId === me?.id && ["left", "removed"].includes(event.state)))) {
        status.textContent = event.state === "closed" ? REASONS.closed : event.state === "removed" ? REASONS.removed : `You left ${openRoom.name}.`;
        close();
        return;
      }
      if (["joinRequest", "invite", "membership", "room"].includes(event?.type)) {
        if (openRoom && event.type === "room" && event.room?.id === openRoom.id) {
          const next = merged(openRoom, event.room);
          const shape = (room) => `${room.status}|${room.you}|${room.name}|${room.kind}`;
          const changed = shape(next) !== shape(openRoom);
          openRoom = next;
          if (changed) paint();
          return;
        }
        void refresh();
        return;
      }
      if (!openRoom || event?.roomId !== openRoom.id) return;
      if (event.type === "roomPets") { window.MefiPets?.guests?.(petsOf(event)); return; }
      if (event.type === "presence") { here = Array.isArray(event.inStudio) ? event.inStudio : []; paintHere(); return; }
      if (event.type === "claims") { if (coworkShow) void Promise.resolve(api.coworkStatus?.()).then(coworkShow).catch(() => {}); return; }
      if (event.type === "message" && !messages.some((item) => item.id === event.message.id)) { messages = [...messages, event.message].slice(-500); showMessages(); }
      else if (event.type === "messageUpdate") { messages = messages.map((item) => (item.id === event.message.id ? event.message : item)); showMessages(); }
      else if (event.type === "messageDelete") { messages = messages.filter((item) => item.id !== event.messageId); showMessages(); }
      // Another member's Studio filled a gap in this PC's copy (the relay keeps no chat): read the page again.
      else if (event.type === "historyFill") {
        const room = openRoom;
        void Promise.resolve(call("messages", room.id)).then((page) => {
          if (!page?.ok || openRoom !== room) return;
          const byId = new Map(messages.map((item) => [item.id, item]));
          for (const item of page.messages) byId.set(item.id, item);
          messages = [...byId.values()].sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(-500);
          showMessages();
        }).catch(() => {});
      }
    }
    // Lets go of the open room's hold and stops hearing frames. Safe to call twice.
    function dispose() {
      openSeq += 1;
      if (onlineTimer) { clearTimeout(onlineTimer); onlineTimer = null; }
      if (openRoom) { api.hubSubscribe?.(openRoom.id, false, "rooms"); petsHome(); }
      openRoom = null;
      if (current === handle) current = null;
    }
    const handle = { hear, dispose };
    current = handle;
    root.dispose = dispose;
    void load();
    return root;
  }

  // recount(): Friends' front page asks for the invites and requests waiting, with Rooms itself closed.
  window.MefiRooms = { panel, pending, subscribe, readable, recount: () => recountQuietly(bridge()) };
})();
