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
    "room-host-role": "Creating rooms needs the Room Host role in the Void Engine server.",
    "new-member": "New members can do this after their first day in the server.",
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
    auth: "Your Discord link needs signing in again. Link Discord again in Settings › General › Community.",
    version: "The room service needs a newer Studio. Update Studio, then connect again.",
    unsupported: "This copy of Studio cannot reach the room service.",
  };
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

  // The text of a message with its <@id> mentions as @name.
  function readable(message) {
    const names = new Map((message.mentions ?? []).map((item) => [item.id, item.name]));
    return String(message.text ?? "").replace(/<@!?(\d{17,20})>/g, (raw, id) => (names.get(id) ? `@${names.get(id)}` : raw));
  }

  function panel() {
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
      for (const [id, label] of [["rooms", "Rooms"], ["requests", `Requests${counts.decide ? ` (${counts.decide})` : ""}`], ["invites", `Invites${counts.invites ? ` (${counts.invites})` : ""}`]]) {
        const item = button(label, () => { tab = id; paint(); }, `rooms-tab-${id}`);
        item.setAttribute("role", "tab");
        item.setAttribute("aria-selected", String(tab === id));
        row.append(item);
      }
      return row;
    }

    function roomRow(room) {
      const row = node("li", "rooms-row");
      row.dataset.room = room.id;
      const text = node("div", "rooms-row-text");
      text.append(node("strong", "", room.name), node("span", "muted", ` · ${room.kind === "cowork" ? "cowork" : "hangout"} · ${room.memberCount}${room.maxMembers ? `/${room.maxMembers}` : ""}${room.status !== "active" ? ` · ${room.status}` : ""}`));
      const actions = node("div", "rooms-row-actions");
      const mine = requests.find((item) => item.roomId === room.id && item.requester.id === me?.id && item.status === "pending");
      const invitation = invites.find((item) => item.roomId === room.id && item.status === "pending");
      const askable = !(room.you === "owner" || room.you === "member") && !invitation && !mine && room.policy === "request" && room.status === "active";
      if (room.you === "owner" || room.you === "member") actions.append(button("Open", () => { void open(room); }));
      else if (invitation) actions.append(button("Accept invite", () => answerInvite(invitation, true)), button("Decline", () => answerInvite(invitation, false)));
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

    function createForm() {
      const form = node("div", "rooms-create");
      form.append(node("h5", "", "Make a room"));
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
      listed.checked = true;
      listedLabel.append(listed, node("span", "", " Show it in the room list"));
      const create = button("Make room", () => guard("Making the room…", async () => {
        const answer = await call("createRoom", { name: name.value.trim(), kind: kind.value, policy: policy.value, listed: listed.checked });
        status.textContent = answer?.ok ? `${answer.room.name} is ready.` : why(answer, answer?.error === "bad-request" ? "Give the room a one-line name of up to 80 characters." : "The room could not be made.");
        if (answer?.ok) { name.value = ""; await refresh(); }
      }), "rooms-create");
      form.append(name, kind, policy, listedLabel, create);
      return form;
    }

    function listView() {
      const list = node("ul", "rooms-list");
      const shown = rooms.filter((room) => room.status !== "closed");
      list.append(...shown.map(roomRow));
      if (!shown.length) list.append(node("li", "muted", "No rooms yet. Make one, or ask a friend to invite you."));
      return [list, createForm()];
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
    // Each row is built once per message and belongs to the room it came from.
    function messageItem(message, roomId) {
      const item = node("li", "rooms-message");
      item.dataset.message = message.id;
      const head = node("div", "rooms-message-head");
      head.append(node("strong", "", message.author.name || "Someone"), node("span", "muted", ` ${time(message.createdAt)}${message.editedAt ? " · edited" : ""}${message.author.viaStudio ? " · Studio" : ""}`));
      const text = node("p", "rooms-message-text", readable(message));
      item.append(head, text);
      if (message.attachments?.length) item.append(node("p", "muted", `Attachments in Discord: ${message.attachments.map((file) => file.name).join(", ")}`));
      const actions = node("div", "rooms-row-actions");
      if (message.author.id === me?.id && message.author.viaStudio) actions.append(confirmed("Delete", "Delete it?", "Delete this message?", () => guard("Deleting…", async () => {
        const answer = await call("deleteMessage", roomId, message.id);
        status.textContent = answer?.ok ? "Deleted." : why(answer, "The message could not be deleted.");
      })));
      else if (message.author.id !== me?.id) actions.append(button("Report", () => { if (!reporting.has(message.id)) { reporting.add(message.id); report(message, item, roomId); } }));
      item.append(actions);
      if (reporting.has(message.id)) report(message, item, roomId);
      return item;
    }
    function report(message, item, roomId) {
      const reason = field(node("input", "rooms-note"), `report:${message.id}`);
      reason.type = "text";
      reason.maxLength = 500;
      reason.placeholder = "Why? Moderators see the message link, not this text.";
      reason.setAttribute("aria-label", "Reason for the report");
      item.append(reason, button("Send report", () => guard("Reporting…", async () => {
        const answer = await call("report", roomId, message.id, reason.value);
        status.textContent = answer?.ok ? "Reported to the moderators." : why(answer, "Say briefly why, then send.");
        if (answer?.ok) reporting.delete(message.id);
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
    async function open(room) {
      const seq = ++openSeq;
      if (openRoom && openRoom.id !== room.id) api.hubSubscribe?.(openRoom.id, false, "rooms");
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
      status.textContent = "Loading messages…";
      const page = await call("messages", room.id);
      // The owner went back, or opened another room, while this page loaded.
      if (seq !== openSeq) return;
      messages = page?.ok ? page.messages : [];
      more = page?.hasMore === true;
      status.textContent = page?.ok ? `${room.name}` : why(page, "Messages could not be loaded.");
      paint();
      showMessages({ follow: true });
    }
    function close() {
      openSeq += 1;
      if (openRoom) api.hubSubscribe?.(openRoom.id, false, "rooms");
      openRoom = null;
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
    function roomView() {
      const room = openRoom;
      const head = node("div", "rooms-room-head");
      head.append(button("‹ All rooms", close, "rooms-back"), node("strong", "", room.name));
      // The hub's privacy note: rooms are private Discord threads.
      const privacy = node("p", "muted rooms-privacy", "Void Engine moderators can read every room.");
      privacy.id = "rooms-privacy";
      coworkShow = null;
      const together = room.kind === "cowork" && room.status === "active" && ["owner", "member"].includes(room.you) && typeof api.coworkStatus === "function" ? coworkSection(room) : null;
      const earlier = button("Load earlier", () => guard("Loading earlier messages…", async () => {
        const seq = openSeq;
        const page = await call("messages", room.id, messages[0]?.id ?? null);
        if (seq !== openSeq) return;
        if (page?.ok) { messages = [...page.messages, ...messages]; more = page.hasMore === true; }
        status.textContent = page?.ok ? room.name : why(page, "Earlier messages could not be loaded.");
        paint();
      }));
      earlier.hidden = !more;
      showMessages();
      const box = field(node("textarea", "rooms-compose"), `compose:${room.id}`);
      box.id = "rooms-compose";
      box.maxLength = 2000;
      box.rows = 2;
      box.placeholder = room.status === "active" ? `Message ${room.name}` : "This room is not taking messages.";
      box.disabled = room.status !== "active";
      box.setAttribute("aria-label", `Message ${room.name}`);
      const send = button("Send", () => {
        const text = box.value;
        if (!text.trim()) return;
        void guard("Sending…", async () => {
          const answer = await call("sendMessage", room.id, text);
          if (answer?.ok) { box.value = ""; status.textContent = room.name; }
          else status.textContent = `Not sent: ${why(answer, "try again.")}`;
        });
      }, "rooms-send");
      send.disabled = box.disabled;
      box.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send.click(); } });
      const owner = room.you === "owner";
      const controls = node("div", "rooms-row-actions");
      if (owner) {
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
          status.textContent = answer?.ok ? (answer.members.length ? "Pick who to invite." : "Nobody by that name.") : why(answer, "Search did not work.");
        }));
        controls.append(find, search, button(room.status === "locked" ? "Unlock" : "Lock", () => guard("Updating…", async () => {
          const answer = await call(room.status === "locked" ? "unlock" : "lock", room.id);
          if (answer?.ok && openRoom?.id === room.id) openRoom = merged(openRoom, answer.room);
          status.textContent = answer?.ok ? (answer.room.status === "locked" ? "Locked: no new posts or requests." : "Unlocked.") : why(answer, "That did not go through.");
          paint();
        })), confirmed("Close room", "Close it for everyone?", `Close ${room.name}? Its history stays in Discord, but nobody can post or join.`, () => {
          void guard("Closing…", async () => {
            const answer = await call("close", room.id);
            status.textContent = answer?.ok ? `${room.name} is closed.` : why(answer, "The room could not be closed.");
            if (answer?.ok) close();
          });
        }));
        return [head, privacy, ...(together ? [together] : []), earlier, log, box, send, controls, found];
      }
      controls.append(confirmed("Leave room", "Leave it?", `Leave ${room.name}?`, () => {
        void guard("Leaving…", async () => {
          const answer = await call("leave", room.id);
          status.textContent = answer?.ok ? `You left ${room.name}.` : why(answer, "You could not leave.");
          if (answer?.ok) close();
        });
      }));
      return [head, privacy, ...(together ? [together] : []), earlier, log, box, send, controls];
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
      body.replaceChildren(...(openRoom ? roomView() : [tabs(), ...(tab === "rooms" ? listView() : tab === "requests" ? requestsView() : invitesView())]));
      for (const [key, el] of fields) {
        const draft = drafts.get(key);
        if (draft) { if (el.type === "checkbox") el.checked = draft.checked; else el.value = draft.value; }
        if (key === focused) el.focus?.({ preventScroll: true });
      }
    }

    function explain(hub) {
      if (!hub?.configured) {
        status.textContent = "Rooms need the Void Engine room service, which this PC is not connected to yet: add its address in Settings › General › Community › Connection details.";
        root.dataset.state = "not-configured";
        body.replaceChildren();
        return false;
      }
      if (!hub.linked) {
        status.textContent = "Link your Discord account to use rooms.";
        root.dataset.state = "not-linked";
        body.replaceChildren(button("Connect with Discord", () => { window.MefiCompanionHub?.close?.({ immediate: true, restore: false }); window.MefiNav?.go?.("community"); }, "rooms-link"));
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
      return true;
    }
    async function load() {
      let hub;
      try { hub = (await api.hubStatus())?.status; } catch { hub = null; }
      if (!explain(hub)) return;
      status.textContent = hub.paused ? "The room service is paused right now; you can read but not post." : `Signed in as ${me?.name || "you"}.`;
      await refresh();
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
      if (event.type === "claims") { if (coworkShow) void Promise.resolve(api.coworkStatus?.()).then(coworkShow).catch(() => {}); return; }
      if (event.type === "message" && !messages.some((item) => item.id === event.message.id)) { messages = [...messages, event.message].slice(-500); showMessages(); }
      else if (event.type === "messageUpdate") { messages = messages.map((item) => (item.id === event.message.id ? event.message : item)); showMessages(); }
      else if (event.type === "messageDelete") { messages = messages.filter((item) => item.id !== event.messageId); showMessages(); }
    }
    // Lets go of the open room's hold and stops hearing frames. Safe to call twice.
    function dispose() {
      openSeq += 1;
      if (openRoom) api.hubSubscribe?.(openRoom.id, false, "rooms");
      openRoom = null;
      if (current === handle) current = null;
    }
    const handle = { hear, dispose };
    current = handle;
    root.dispose = dispose;
    void load();
    return root;
  }

  window.MefiRooms = { panel, pending, subscribe, readable };
})();
