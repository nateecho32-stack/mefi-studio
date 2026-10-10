// Friends' room desktop: the existing room chat remains responsible for messages,
// membership and permissions. This view adds navigation and small summaries of
// actual project, room-player and jam state. It never starts a worker or player.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, key) => { const el = node("button", "ghost room-desktop-button", text); el.type = "button"; if (key) el.dataset.roomControl = key; el.addEventListener("click", run); return el; };
  const enabled = () => { try { return window.localStorage?.getItem("mefiStudio.friendsRoomLayout") !== "classic"; } catch { return true; } };
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?";
  function hue(id, mine) { if (mine) return 88; let n = 2166136261; for (const c of String(id || "")) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0; n = Math.imul(n ^ (n >>> 16), 0x7feb352d) >>> 0; return n % 360; }
  function avatar(id, name, mine = false) {
    const face = node("span", "room-desktop-avatar", initials(mine ? "You" : name));
    face.setAttribute("aria-hidden", "true"); face.style?.setProperty?.("--person-hue", String(hue(id, mine))); return face;
  }
  let current = null, listening = false;
  function listen(api) {
    if (listening) return;
    listening = true;
    for (const [method, kind] of [["onProjects", "projects"], ["onTasks", "tasks"], ["onAssistantStatus", "workers"]]) {
      try { api?.[method]?.((value) => current?.push(kind, value)); } catch { /* An older bridge can still show its initial snapshot. */ }
    }
    window.addEventListener?.("mefi-music-change", () => current?.changed());
    document.addEventListener?.("visibilitychange", () => { if (!document.hidden) { current?.changed(); current?.refresh(); } });
  }
  function create(options) {
    if (!enabled()) return null;
    const { api, snapshot, open, close, onChange } = options;
    listen(api);
    let gone = false, queued = false, epoch = 0, project = null, tasks = null, workers = null, buildError = "", buildLoaded = false;
    let front = null, jam = null, eventsRead = false, eventsStarted = false, frontRead = false, player = null, playerRoom = null, eventError = "";
    let taskSource = null, taskSummary = { active: [], done: 0 };
    let lastFlags = {}, lastRead = 0, frontPresenceFresh = false;
    let navHost = null, contextHost = null, navOpen = false, contextOpen = false, cardKey = "", navKey = "";
    const go = (place, extra = {}) => window.MefiNav?.go?.("friends-page", { place, ...extra });
    const listeningControls = () => { const id = snapshot().room?.id; window.MefiMusic?.openAudio?.(); window.MefiMusic?.setSource?.("link"); window.MefiMusic?.openSection?.("more"); if (id) void Promise.resolve(window.MefiTogether?.selectRoom?.(id)).catch(() => {}); };
    const notify = () => { if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("mefi:friends-room")); onChange?.(); };
    function schedule() {
      if (gone || queued) return;
      queued = true;
      const paint = () => { queued = false; if (gone || document.hidden) return; paintNavigation(); paintCards(); notify(); };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(paint); else Promise.resolve().then(paint);
    }
    async function readBuild() {
      const seq = ++epoch;
      try {
        if (typeof api.projectsList !== "function") { buildError = "Project status is unavailable in this build."; schedule(); return; }
        const list = await api.projectsList();
        if (gone || seq !== epoch) return;
        if (!list?.ok) throw new Error("unavailable");
        project = list.projects?.find((item) => item.id === list.activeId) || null; buildLoaded = true;
        tasks = null; workers = null; buildError = ""; schedule();
        if (!project) return;
        const id = project.id;
        const [board, live] = await Promise.all([api.tasksList?.(), api.assistantStatus?.()]);
        if (gone || seq !== epoch || project?.id !== id) return;
        tasks = board?.ok && board.projectId === id && Array.isArray(board.tasks) ? board.tasks : null;
        workers = live?.ok && live.status?.projectId === id && Array.isArray(live.status.running) ? live.status.running : null;
        if (!tasks || !workers) buildError = "Some project status could not be refreshed.";
      } catch { if (!gone && seq === epoch) { project = null; tasks = null; workers = null; buildLoaded = true; buildError = "Project status could not be loaded."; } }
      schedule();
    }
    function people() {
      const state = snapshot(), room = state.room;
      if (!state.connected) return [];
      const known = Array.isArray(front?.online?.people) ? front.online.people : [];
      const ids = state.hereKnown ? state.here : frontPresenceFresh ? known.filter((person) => person.where?.id === room?.id).map((person) => person.id) : [];
      return [...new Set(ids)].slice(0, room?.maxMembers || 25).map((id) => {
        const person = known.find((item) => item.id === id), mine = id === state.me?.id;
        const rank = mine ? front?.you?.rank?.name : typeof person?.rank === "string" ? person.rank : person?.rank?.name;
        return { id, name: mine ? "You" : person?.name || state.nameOf(id) || "Someone", mine, rank: rank ? String(rank).slice(0, 40) : null };
      });
    }
    function navigation() {
      const state = snapshot(); if (gone || !state.room) return null;
      const rows = [{ kind: "heading", label: "Rooms" }];
      for (const room of state.rooms.filter((item) => ["owner", "member"].includes(item.you))) {
        rows.push({ kind: "row", key: `room:${room.id}`, label: room.name, glyph: room.id === "lobby" ? "g-community" : "g-chat", current: state.room.id === room.id, count: Number.isFinite(room.memberCount) ? room.memberCount : null, run: () => { navOpen = false; open(room); } });
      }
      rows.push({ kind: "row", key: "rooms:all", label: "All rooms & invitations", quiet: true, run: close });
      rows.push({ kind: "heading", label: "Here now" });
      const members = people();
      for (const person of members) rows.push({ kind: "member", key: `person:${person.id}`, label: person.name, rank: person.rank, hue: hue(person.id, person.mine), initials: initials(person.name), mine: person.mine });
      if (!members.length) rows.push({ kind: "note", label: !state.connected ? "Offline. Presence is unavailable." : state.hereKnown ? "Nobody in Studio here right now." : "Waiting for room presence…" });
      rows.push({ kind: "heading", label: "Explore Friends" });
      rows.push({ kind: "row", key: "friends:lobby", label: "Lobby roundup", glyph: "g-community", run: () => go("lobby", { view: "roundup" }) });
      for (const place of window.MefiCompanionHub?.friendsPlaces?.() || []) {
        if (["lobby", "rooms"].includes(place.id)) continue;
        rows.push({ kind: "row", key: `friends:${place.id}`, label: place.label, glyph: place.glyph, current: false, run: place.run });
      }
      return { section: "friends", title: "Rooms", roomDesktop: true, rows };
    }
    function paintNavigation() {
      if (!navHost) return;
      const held = navHost.contains?.(document.activeElement) ? document.activeElement?.dataset?.roomControl : null;
      const rows = navigation()?.rows || [];
      const key = JSON.stringify(rows);
      if (key === navKey) return; navKey = key;
      const children = rows.map((row) => {
        if (row.kind === "heading") return node("h3", "room-desktop-label", row.label);
        if (row.kind === "note") return node("p", "muted room-desktop-note", row.label);
        if (row.kind === "member") {
          const item = node("div", `room-desktop-person${row.mine ? " mine" : ""}`);
          const face = avatar(row.key, row.label, row.mine); face.style?.setProperty?.("--person-hue", String(row.hue));
          const copy = node("span", "room-desktop-person-copy"); copy.append(node("strong", "", row.label));
          if (row.rank) copy.append(node("span", "muted", row.rank));
          item.append(face, copy); return item;
        }
        const item = button(row.label, row.run, row.key); item.className += " room-desktop-room";
        if (row.current) item.setAttribute("aria-current", "page");
        if (row.count != null) item.append(node("span", "muted room-desktop-count", String(row.count)));
        return item;
      });
      navHost.replaceChildren(...children);
      if (held) [...navHost.querySelectorAll?.("[data-room-control]") || []].find((el) => el.dataset.roomControl === held)?.focus?.({ preventScroll: true });
    }
    const card = (label, cls) => { const el = node("section", `room-desktop-card ${cls}`); el.append(node("h3", "room-desktop-label", label)); return el; };
    function playerState() {
      const state = snapshot(), together = window.MefiTogether?.status?.();
      if (!state.room) return null;
      return together?.roomId === state.room.id ? together.session : playerRoom === state.room.id ? player : null;
    }
    function paintCards() {
      if (!contextHost) return;
      const session = playerState(), state = snapshot();
      if (tasks !== taskSource) { taskSource = tasks; const active = (tasks || []).filter((task) => !task.dropped && task.status !== "archived" && task.kind !== "group"); taskSummary = { active, done: active.filter((task) => ["done", "completed"].includes(task.status)).length }; }
      const { active, done } = taskSummary;
      const running = new Set((workers || []).map((worker) => worker.taskId));
      const recent = [...active.filter((task) => running.has(task.id)).slice(0, 3), ...active.filter((task) => !running.has(task.id)).slice(0, 3)].slice(0, 3);
      const together = window.MefiTogether?.status?.();
      const following = together?.following && together.roomId === state.room?.id;
      // The paint key contains only the small summary, never raw task history or
      // worker output. A repeated status frame leaves the card and its focus alone.
      const playerKnown = playerRoom === state.room?.id || together?.roomId === state.room?.id;
      const key = JSON.stringify([project?.id, project?.name, active.length, done, tasks !== null, recent.map((task) => [task.id, task.title, task.status]), workers?.length, buildError, buildLoaded, session?.title, session?.label, session?.playing, session?.provider, following, playerKnown, jam?.theme, jam?.phase, eventsRead, eventError, state.room?.id, state.connected]);
      if (key === cardKey) return; cardKey = key;
      const held = contextHost.contains?.(document.activeElement) ? document.activeElement?.dataset?.roomControl : null;
      const build = card("Your build", "room-desktop-build");
      build.append(node("strong", "room-desktop-card-title", project?.name || (buildError ? "Project unavailable" : buildLoaded ? "No project open" : "Checking your project…")));
      if (project) {
        const working = workers === null ? "Checking builders…" : workers.length ? `${workers.length} ${workers.length === 1 ? "builder" : "builders"} working` : "No builders running";
        build.append(node("p", "muted", `Your project · ${working}`));
        if (tasks) {
          const progress = node("progress", "room-desktop-progress"); progress.max = active.length || 1; progress.value = done;
          progress.setAttribute("aria-label", `${done} of ${active.length} tasks done`); build.append(progress);
          build.append(node("p", "muted room-desktop-note", `${done} of ${active.length} tasks done`));
          const list = node("ul", "room-desktop-tasks");
          for (const task of recent) {
            const item = node("li", ""); item.dataset.status = task.status; item.dataset.running = String(running.has(task.id));
            const action = button(task.title || "Untitled task", () => window.MefiNav?.go?.("tasks", { taskId: task.id, projectId: project.id, filter: "all" }), `task:${task.id}`);
            action.title = `${task.title || "Task"} · ${task.status || "status unavailable"}`; item.append(action); list.append(item);
          }
          if (!active.length) list.append(node("li", "muted", "No tasks in this project yet."));
          build.append(list);
        } else build.append(node("p", "muted", "Task status is unavailable."));
        build.append(button("Open your work", () => window.MefiNav?.go?.("tasks"), "build:open"));
      } else build.append(node("p", "muted", buildError || "Open a project to see its tasks and builders here."));
      if (buildError && project) build.append(node("p", "muted", buildError));
      const music = card("Listening together", "room-desktop-listening");
      const record = node("span", "room-desktop-record", "♪"); record.setAttribute("aria-hidden", "true"); music.append(record);
      music.append(node("strong", "room-desktop-card-title", session?.title || session?.label || (playerKnown ? "Nothing playing in this room" : "Open the room player")));
      music.append(node("p", "muted", !state.connected ? "Offline · last received room player state." : session ? `${session.playing ? "Playing" : "Paused"}${session.provider === "spotify" ? " · Spotify needs play in its player" : following ? " · Listening along" : " · Open the player to listen along"}` : "Open listening controls to see or share this room's music."));
      music.append(button(session ? "Open room player" : "Listen together", listeningControls, "player:open"));
      const event = card("This week's Build Jam", "room-desktop-jam");
      event.append(node("strong", "room-desktop-card-title", jam?.theme || (eventError ? "Build Jam unavailable" : eventsRead ? "No current jam" : "Checking the week's theme…")));
      event.append(node("p", "muted", !state.connected ? "Offline · last received theme. Reconnect for current events." : jam ? jam.phase === "voting" ? "Play the entries, then vote for your favourites." : jam.phase === "entries" ? "Make something, share it, enter it." : "See the current jam and its results." : eventError || (eventsRead ? "The room service has no current jam to show." : "The theme appears when the event service answers.")));
      event.append(button(jam?.phase === "voting" ? "Explore the entries" : "Open the Build Jam", () => go("events"), "jam:open"));
      contextHost.replaceChildren(build, music, event);
      if (held) [...contextHost.querySelectorAll?.("[data-room-control]") || []].find((el) => el.dataset.roomControl === held)?.focus?.({ preventScroll: true });
    }
    function view(chatParts) {
      const board = node("div", "room-desktop-board");
      const side = node("aside", "room-desktop-nav"); side.setAttribute("aria-label", "Rooms and people"); side.dataset.open = String(navOpen);
      const navToggle = button("Rooms & people", () => { navOpen = !navOpen; side.dataset.open = String(navOpen); navToggle.setAttribute("aria-expanded", String(navOpen)); }, "nav:toggle");
      navToggle.className += " room-desktop-toggle"; navToggle.setAttribute("aria-expanded", String(navOpen));
      navHost = node("nav", "room-desktop-nav-body"); navHost.setAttribute("aria-label", "Room navigation"); side.append(navToggle, navHost);
      side.addEventListener("keydown", (event) => { if (event.key === "Escape" && navOpen) { event.preventDefault(); event.stopPropagation(); navOpen = false; side.dataset.open = "false"; navToggle.setAttribute("aria-expanded", "false"); navToggle.focus(); } });
      const chat = node("div", "room-desktop-chat"); chat.append(...chatParts);
      const context = node("aside", "room-desktop-context"); context.setAttribute("aria-label", "Your build and room"); context.dataset.open = String(contextOpen);
      const contextToggle = button("Your build & room", () => { contextOpen = !contextOpen; context.dataset.open = String(contextOpen); contextToggle.setAttribute("aria-expanded", String(contextOpen)); }, "context:toggle");
      contextToggle.className += " room-desktop-toggle"; contextToggle.setAttribute("aria-expanded", String(contextOpen));
      contextHost = node("div", "room-desktop-context-body"); context.append(contextToggle, contextHost);
      context.addEventListener("keydown", (event) => { if (event.key === "Escape" && contextOpen) { event.preventDefault(); event.stopPropagation(); contextOpen = false; context.dataset.open = "false"; contextToggle.setAttribute("aria-expanded", "false"); contextToggle.focus(); } });
      board.append(side, chat, context); cardKey = ""; navKey = ""; paintNavigation(); paintCards(); return board;
    }
    async function capabilities(flags) {
      if (gone) return;
      lastFlags = { ...lastFlags, ...flags }; lastRead = Date.now();
      if (flags.front && !frontRead) { frontRead = true; try { const answer = await api.hubRoom("front"); if (!gone && answer?.ok) { front = answer; frontPresenceFresh = true; options.onFront?.(answer); schedule(); } } catch { /* Presence still arrives through the room subscription. */ } }
      if (gone) return;
      if (!flags.events) { eventsRead = true; eventError = "This room service does not provide events."; schedule(); }
      else if (!eventsStarted) { eventsStarted = true; eventError = ""; try { const answer = await api.hubEvents?.("events"); if (!gone) { eventsRead = true; jam = answer?.ok ? answer.jam : null; eventError = answer?.ok ? "" : "The event service could not be reached."; schedule(); } } catch { if (!gone) { eventsRead = true; eventError = "The event service could not be reached."; schedule(); } } }
    }
    function push(kind, value) {
      if (gone) return;
      if (kind === "projects") { if (value?.activeId !== project?.id) void readBuild(); else { project = value.projects?.find((item) => item.id === value.activeId) || project; schedule(); } }
      if (kind === "tasks" && Array.isArray(value) && project && !value.some((task) => task.projectId && task.projectId !== project.id)) { tasks = value; schedule(); }
      if (kind === "workers" && value?.projectId === project?.id && Array.isArray(value.running)) { workers = value.running; schedule(); }
    }
    const handle = { view, navigation, capabilities, changed: schedule, push, listen: listeningControls, player: playerState,
      refresh: () => { if (!gone && snapshot().room && snapshot().connected && Date.now() - lastRead >= 60_000) { frontRead = false; eventsStarted = false; void capabilities(lastFlags); } },
      hide: () => { navHost = null; contextHost = null; },
      hear: (event) => {
        if (event?.type === "listen" && event.roomId === snapshot().room?.id) { player = event.session || null; playerRoom = event.roomId; schedule(); }
        if (event?.type === "status" && event.status) {
          if (event.status.state !== "ready") frontPresenceFresh = false;
          else if (!snapshot().connected) { frontRead = false; eventsStarted = false; void capabilities({ ...lastFlags, ...Object.fromEntries(Object.entries(event.status).filter(([key, value]) => ["front", "events"].includes(key) && typeof value === "boolean")) }); }
        }
      },
      dispose: () => { gone = true; epoch += 1; if (current === handle) current = null; navHost = null; contextHost = null; },
    };
    current = handle; void readBuild(); return handle;
  }
  window.MefiRoomLayout = { enabled, create, avatar, navigation: () => current?.navigation() || null };
})();
