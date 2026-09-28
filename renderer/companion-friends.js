// Friends › Playground: friends' companions out in your rooms, playdates with
// them (or with Pip, the practice buddy that never leaves this PC), and what
// your own companion may tell them. The rules, the cards and the scenes all
// come from main's "Companion friends" block (scripts/companion-friends.cjs);
// this file lays them out, plays the scripted scenes and sends the owner's
// choices. A friend's card arrives already read and is only shown as text.
// renderer/companion-hub.js mounts it in the Friends section.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, cls = "ghost mini") => { const el = node("button", cls, text); el.type = "button"; el.addEventListener("click", run); return el; };
  const still = () => window.MefiNav?.noMotion?.() || ["off", "calm"].includes(document.documentElement.dataset.motion) || document.body.classList.contains("ws-still") || document.body.classList.contains("no-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const LOOK_WORDS = { wisp: "wisp", fox: "fox", owl: "owl", cat: "cat", person: "companion" };
  const STATE_WORDS = { working: "Working", resting: "Resting", waiting: "Waiting on their person" };
  // Friends get their own tint, so two wisps side by side read as two.
  const HUES = ["150deg", "250deg", "320deg", "40deg", "200deg"];
  const roomNames = new Map();
  let live = null, listening = false;

  const friendName = (card) => card?.name || `A friend's ${LOOK_WORDS[card?.look] || "companion"}`;
  const roomName = (id) => roomNames.get(id) || "a room";

  function actor(face, look, label, side, hue) {
    const root = node("div", "friends-actor"); root.dataset.side = side;
    if (hue) root.style.setProperty("--friends-hue", hue);
    const body = node("span", "friends-face"); body.innerHTML = face(look); body.setAttribute("aria-hidden", "true");
    const say = node("span", "friends-say"), emote = node("span", "friends-emote");
    say.setAttribute("aria-hidden", "true"); emote.setAttribute("aria-hidden", "true");
    root.append(say, emote, body, node("span", "friends-name", label));
    return root;
  }

  function sharedLines(card) {
    const lines = [];
    if (card.personality) lines.push({ focused: "Straight work", balanced: "Balanced", playful: "Friendly & expressive" }[card.personality]);
    if (card.status) lines.push(`${STATE_WORDS[card.status.state] || "Resting"} · ${card.status.running} running · ${card.status.doneToday} done today`);
    if (card.work?.project) lines.push(`Project: ${card.work.project}`);
    for (const title of card.work?.running || []) lines.push(`Working on: ${title}`);
    for (const title of card.work?.done || []) lines.push(`Finished: ${title}`);
    return lines;
  }

  function card({ name = "Mefi", face = () => "" } = {}) {
    const api = window.mefiStudio;
    const root = node("section", "friends-card"); root.setAttribute("aria-labelledby", "friends-title");
    const title = node("h4", "friends-title", "Playground"); title.id = "friends-title";
    const status = node("p", "muted"); status.id = "friends-status"; status.setAttribute("role", "status");
    root.append(title, status);
    if (typeof api?.hubFriends !== "function" || typeof api?.hubPlaydate !== "function") {
      status.textContent = "Playdates work in the desktop app.";
      root.dataset.state = "unavailable";
      return root;
    }
    const stage = node("div", "friends-stage"); stage.id = "friends-stage";
    const said = node("ol", "friends-lines"); said.setAttribute("aria-label", "What the companions said"); said.setAttribute("aria-live", "polite");
    const preview = node("p", "ab-quiet"); preview.id = "friends-preview";
    const practice = button("Practice with Pip", () => play({ practice: true }), "ghost mini friends-practice"); practice.id = "friends-practice";
    const list = node("div", "friends-list");
    const sharing = node("details", "friends-sharing"); sharing.append(node("summary", "", `What ${name} may share`));
    const log = node("details", "friends-log"); log.append(node("summary", "", "What was sent"));
    root.append(stage, said, preview, practice, list, sharing, log);
    const state = { view: null, playing: false, stale: false, name };
    live = { root, reload: () => load() };

    const set = async (change) => {
      root.setAttribute("aria-busy", "true");
      let view;
      try { view = await api.hubSharingSet({ ...change, name }); } catch (error) { view = { ok: false, error: error?.message }; }
      root.removeAttribute("aria-busy");
      if (!view?.ok) { status.textContent = view?.error || "That could not be saved."; return; }
      state.view = view; paint();
    };
    const levelSelect = (label, value, choices, onChange) => {
      const row = node("label", "studio-field friends-field");
      const pickEl = node("select"); pickEl.setAttribute("aria-label", label);
      for (const [id, text] of choices) { const option = node("option", "", text); option.value = id; pickEl.append(option); }
      pickEl.value = value;
      pickEl.addEventListener("change", () => onChange(pickEl.value));
      row.append(node("span", "", label), pickEl);
      return row;
    };
    const levels = () => (state.view?.levels || []).map((level) => [level.id, level.label]);
    const levelLabel = (id) => state.view?.levels?.find((level) => level.id === id)?.label || id;
    // A room or friend rule: a level, or back to the default; this session
    // only when the box is ticked. Default clears both kinds.
    const ruleRow = (label, scope, target, ruleLabel) => {
      const rules = state.view.sharing.rules.filter((rule) => rule.scope === scope && rule.target === target);
      const current = rules.find((rule) => rule.duration === "session") || rules[0] || null;
      const wrap = node("div", "friends-rule");
      const session = node("input"); session.type = "checkbox"; session.checked = current?.duration === "session";
      const sessionLabel = node("label", "friends-session"); sessionLabel.append(session, node("span", "", "This session only"));
      const pickRow = levelSelect(label, current?.level || "", [["", "Same as everyone"], ...levels()], async (value) => {
        if (!value) { for (const duration of ["session", "always"]) await set({ rule: { scope, target, level: null, label: ruleLabel }, duration }); return; }
        await set({ rule: { scope, target, level: value, label: ruleLabel }, duration: session.checked ? "session" : "always" });
      });
      session.addEventListener("change", async () => { if (current) { await set({ rule: { scope, target, level: null, label: ruleLabel }, duration: current.duration }); await set({ rule: { scope, target, level: current.level, label: ruleLabel }, duration: session.checked ? "session" : "always" }); } });
      wrap.append(pickRow, sessionLabel);
      return wrap;
    };

    function paintStage(friend = null, friendLook = null) {
      const me = actor(face, window.MefiCompanion?.state?.()?.look || "wisp", name, "me");
      me.id = "friends-me";
      const link = node("span", "friends-link"); link.setAttribute("aria-hidden", "true");
      const others = friend ? [friend] : (state.view?.friends || []).slice(0, 4).map((row) => ({ look: row.card.look, label: friendName(row.card), mood: row.card.mood }));
      if (!others.length) others.push({ look: "fox", label: "Pip · practice", practice: true });
      stage.replaceChildren(me, link, ...others.map((row, index) => {
        const el = actor(face, row.look || friendLook || "wisp", row.label, "friend", HUES[index % HUES.length]);
        el.dataset.mood = row.mood || "idle";
        if (row.practice) el.dataset.practice = "true";
        return el;
      }));
    }

    function paintStatus() {
      const view = state.view, hub = view.hub;
      const out = view.friends.length;
      status.textContent = !hub.configured ? "Friends' companions meet through the rooms hub, which this PC isn't connected to yet: add its address in Settings › Community › Connection details. Pip is here to practice."
        : !hub.linked ? "Link Discord under Community to meet friends' companions. Pip, the practice buddy, is always here."
        : hub.state !== "ready" ? "Connect under Rooms below, then open a room, and friends' companions there can visit."
        : !hub.companions ? "This rooms hub does not carry companions yet, so friends cannot visit. Pip is here to practice."
        : !hub.rooms.length ? "Open a room under Rooms below, and friends' companions there can visit."
        : out ? `${out} friend${out === 1 ? "'s companion is" : "s' companions are"} out in your rooms.`
        : "No friends' companions are out in your rooms right now.";
      preview.textContent = `Friends see: ${view.preview.summary} (${levelLabel(view.preview.level)} · ${view.preview.why}).`;
    }

    function paintFriends() {
      const view = state.view;
      list.replaceChildren(...view.friends.map((row, index) => {
        const item = node("article", "companion-item friends-friend");
        item.dataset.friend = row.userId;
        const head = node("div", "friends-friend-head");
        const small = node("span", "friends-mini"); small.innerHTML = face(row.card.look); small.style.setProperty("--friends-hue", HUES[index % HUES.length]); small.setAttribute("aria-hidden", "true");
        head.append(small, node("strong", "", friendName(row.card)), node("span", "ab-quiet", `in ${roomName(row.roomId)}`));
        item.append(head);
        for (const line of sharedLines(row.card)) item.append(node("p", "ab-quiet", line));
        if (row.ask) {
          const ask = node("div", "friends-ask"); ask.setAttribute("role", "group"); ask.setAttribute("aria-label", "Share back?");
          const label = friendName(row.card);
          ask.append(node("p", "", row.ask.text),
            button("For this session", () => set({ rule: { scope: "friend", target: row.userId, level: row.ask.level, label }, duration: "session" }), "primary mini"),
            button(`Always with ${label}`, () => set({ rule: { scope: "friend", target: row.userId, level: row.ask.level, label }, duration: "always" })),
            button("Not now", () => set({ dismiss: row.userId })));
          item.append(ask);
        }
        item.append(node("p", "ab-quiet", `You share ${levelLabel(row.sent)}${row.sent !== row.level ? ` (allowed ${levelLabel(row.level)}; this hub reaches the whole room only)` : ""} · ${row.why}`));
        item.append(ruleRow(`What ${name} shares with them`, "friend", row.userId, friendName(row.card)));
        item.append(button(`Play with ${friendName(row.card)}`, () => play({ roomId: row.roomId, userId: row.userId }), "ghost mini friends-play"));
        return item;
      }));
    }

    function paintSharing() {
      const view = state.view;
      const summary = sharing.querySelector("summary");
      const says = node("p", "ab-quiet", view.levels.find((level) => level.id === view.sharing.everyone)?.says || "");
      const rows = [summary, node("p", "muted", "Nothing about you or your work leaves until you allow it. The most specific rule wins: a friend, then a room, then everyone.")];
      rows.push(levelSelect("Everyone, by default", view.sharing.everyone, levels(), (value) => set({ everyone: value })), says);
      rows.push(levelSelect("This session", view.sharing.hold || "", [["", "Use my rules"], ["play", "Just play for now"], ["none", "Stay home for now"]], (value) => set({ hold: value || null })));
      for (const roomId of view.hub.rooms) rows.push(ruleRow(`In ${roomName(roomId)}`, "room", roomId, roomName(roomId)));
      const out = new Set(view.friends.map((row) => row.userId));
      const saved = view.sharing.rules.filter((rule) => !(rule.scope === "friend" && out.has(rule.target)) && !(rule.scope === "room" && view.hub.rooms.includes(rule.target)));
      if (saved.length) {
        const ul = node("ul", "friends-rules");
        for (const rule of saved) {
          const li = node("li", "", `${rule.scope === "room" ? "Room" : "Friend"} ${rule.label}: ${levelLabel(rule.level)}${rule.duration === "session" ? " (this session)" : ""} `);
          li.append(button("Remove", () => set({ rule: { scope: rule.scope, target: rule.target, level: null, label: rule.label }, duration: rule.duration })));
          ul.append(li);
        }
        rows.push(node("h5", "friends-subhead", "Other rules"), ul);
      }
      const never = node("ul", "friends-never");
      for (const line of view.never) never.append(node("li", "", line));
      rows.push(node("h5", "friends-subhead", "Never shared, at any level"), never);
      sharing.replaceChildren(...rows);
    }

    function paintLog() {
      const rows = [log.querySelector("summary")];
      if (!state.view.sent.length) rows.push(node("p", "ab-quiet", "Nothing has been sent this session."));
      else {
        const ul = node("ul", "friends-sent");
        for (const row of state.view.sent) {
          const to = row.to ? friendName(state.view.friends.find((friend) => friend.userId === row.to)?.card) : `everyone in ${roomName(row.roomId)}`;
          ul.append(node("li", "", `${new Date(row.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · to ${to} · ${row.level === "none" ? "went home" : row.summary}`));
        }
        rows.push(ul);
      }
      log.replaceChildren(...rows);
    }

    function paint() {
      if (!state.view) return;
      root.dataset.state = state.view.friends.length ? "friends" : "quiet";
      paintStatus();
      if (!state.playing) paintStage();
      paintFriends(); paintSharing(); paintLog();
      window.MefiCompanionHub?.resize?.();
    }

    async function load() {
      if (!root.isConnected && state.view) { if (live?.root === root) live = null; return; }
      // Never repaint under a control the owner is using, or mid-scene.
      if (state.playing || root.contains(document.activeElement) && document.activeElement.matches("select, input")) { state.stale = true; return; }
      let view;
      try { view = await api.hubFriends({ name }); } catch (error) { view = { ok: false, error: error?.message }; }
      if (!view?.ok) { status.textContent = view?.error || "Friends could not be read."; return; }
      state.view = view; state.stale = false;
      if (view.hub.state === "ready" && view.hub.rooms.some((id) => !roomNames.has(id)) && typeof api.hubRooms === "function") {
        Promise.resolve(api.hubRooms()).then((result) => { for (const room of result?.rooms || []) roomNames.set(room.id, room.name); if (root.isConnected) paint(); }).catch(() => {});
      }
      paint();
    }

    // A scene plays beat by beat; with motion off the whole script shows at once.
    async function play(target) {
      if (state.playing) return;
      let scene;
      try { scene = await api.hubPlaydate({ ...target, music: Boolean(window.MefiIdle?.audioStatus?.()?.listening) }); } catch (error) { scene = { ok: false, error: error?.message }; }
      if (!scene?.ok) { status.textContent = scene?.error || "That playdate could not start."; return; }
      state.playing = true; stage.dataset.playing = "true";
      const label = scene.practice ? "Pip · practice" : friendName(scene.friend);
      paintStage({ look: scene.friend.look, label, mood: scene.friend.mood, practice: scene.practice }, scene.friend.look);
      said.replaceChildren();
      const me = stage.querySelector('[data-side="me"]'), friend = stage.querySelector('[data-side="friend"]');
      const names = { me: name, friend: scene.practice ? "Pip" : friendName(scene.friend), both: "Both" };
      try {
        for (const beat of scene.beats) {
          const actors = beat.who === "both" ? [me, friend] : [beat.who === "me" ? me : friend];
          for (const el of [me, friend]) { el.removeAttribute("data-act"); el.querySelector(".friends-say").textContent = ""; el.querySelector(".friends-emote").textContent = ""; }
          for (const el of actors) {
            el.dataset.act = beat.act;
            if (beat.say && beat.who !== "both") el.querySelector(".friends-say").textContent = beat.say;
            if (beat.emote) el.querySelector(".friends-emote").textContent = beat.emote;
          }
          if (beat.say || beat.emote) said.append(node("li", "", `${names[beat.who]}: ${[beat.say, beat.emote].filter(Boolean).join(" ")}`));
          if (!still()) await wait(1500);
        }
        if (!still()) await wait(600);
      } finally {
        state.playing = false; delete stage.dataset.playing;
        for (const el of [me, friend]) { el.removeAttribute("data-act"); el.querySelector(".friends-say").textContent = ""; el.querySelector(".friends-emote").textContent = ""; }
        window.MefiCompanion?.refresh?.();
        if (state.stale) load(); else paintStage();
      }
    }

    if (!listening && typeof api.onHubEvent === "function") {
      listening = true;
      let timer = 0;
      api.onHubEvent((event) => {
        if (!["companion", "status", "presence", "membership"].includes(event?.type) || !live?.root?.isConnected) return;
        clearTimeout(timer); timer = setTimeout(() => live?.reload(), 300);
      });
    }
    status.textContent = "Looking for friends…";
    paintStage();
    load();
    return root;
  }

  window.MefiCompanionFriends = { card };
})();
