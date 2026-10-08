// Social: the mode for people, rooms, what friends make and a simple talk with Mefi (window.MefiSocial).
//
// A QA pass on 2026-10-06 found Social reading as a development dashboard with a social area attached: Friends only
// through Search, worktrees, Fleet, Trace, models, the machine's load and Git in every corner, eight choices around the
// one box. Studio owns detailed building now; this file is what keeps Social to its own places.
//
// - Which pages stay in Social (PAGES): Home, Friends, Projects, Activity, the Inbox, Settings, Size and the setup guide.
//   Any other page (the Map, the boards, Team, Fleet, Trace, Worktrees, the model pages) and any session opens in Studio:
//   renderer/nav.js go() asks studioOnly() and switches the mode before it goes, so the page and what it was opened with
//   are kept. openInStudio() is the same on purpose, for an "Open in Studio" button. Search and the tab strip still list
//   everything; choosing a Studio page from Social is the switch.
// - The Friends card on Social's Home (peopleCard): who is online and where, the rooms open now and what friends shared
//   this week, read from the relay's front page (main's hub:room "front", the read The Lobby makes) once a minute while
//   it shows and the window can be seen. Signed out, it is one line and the way to The Lobby's sign-in. Everything is
//   text (textContent); nothing from the relay becomes a link.
// - Projects (route "projects"): your projects to open (MefiWorkspace.selectProject, which asks before it stops working
//   agents), New app (renderer/vibe-panels.js) and the way to what friends shared (Friends › Project hub).
// Activity (route "activity") is renderer/today.js's: the open project's work in one list.
(function () {
  "use strict";
  const bridge = () => window.mefiStudio;
  const nav = () => window.MefiNav;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = String(text); return node; };
  const button = (label, className, run, { id = null, title = "" } = {}) => {
    const node = el("button", className, label);
    node.type = "button";
    if (id) node.id = id;
    if (title) node.title = title;
    node.addEventListener("click", run);
    return node;
  };
  const socialMode = () => window.MefiVibe?.mode?.() === "vibe";
  // Kill switches, per device (localStorage): "mefiStudio.social.allPages" = "on" opens every page inside Social's rail again,
  // as before 2026-10-06; "mefiStudio.social.friendsCard" = "off" leaves the Friends card off Social's Home.
  const read = (key) => { try { return globalThis.localStorage?.getItem?.(key) ?? null; } catch { return null; } };
  const allPages = () => read("mefiStudio.social.allPages") === "on";
  const friendsCardOff = () => read("mefiStudio.social.friendsCard") === "off";
  const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
  // A steady colour per member, from their id (The Lobby's own rule, renderer/friends-front.js).
  const hue = (id) => [...String(id)].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7);
  const KINDS = { game: "game", app: "app", tool: "tool", art: "art", music: "music", other: "project" };
  const goFriends = (place, extra = {}) => nav()?.go?.("friends-page", { place, ...extra });

  // ---- which pages are Social's --------------------------------------------------------------------------------
  // Pages, not actions or Search: an action (Pause agents, a Friends way in) runs where it is. Any page filed under Settings,
  // Help or Friends is Social's too, so a Settings page added later needs no line here.
  const PAGES = Object.freeze(["vibe", "friends-page", "inbox", "projects", "activity", "studio", "size", "setup-helper", "shop"]);
  const SOCIAL_SECTIONS = Object.freeze(["settings", "help", "friends"]);
  function studioOnly(id, params = {}) {
    if (!socialMode() || typeof id !== "string" || allPages()) return false;
    // Home stays Social's; a session (a task's thread) or the classic chat view is Studio's.
    if (id === "workspace") return Boolean(params && typeof params === "object" && params.view);
    if (PAGES.includes(id)) return false;
    const dest = nav()?.get?.(id);
    if (!dest || dest.kind === "action" || dest.layer === "transient") return false;
    return !SOCIAL_SECTIONS.includes(dest.section);
  }
  let toldOnce = false;
  // Leave Social for Studio, keeping the page under it: what nav.js go() does before it opens a Studio page asked for from
  // Social. The first time in a session a note says where you are and the way back.
  function toStudio() {
    if (!socialMode()) return false;
    window.MefiVibe?.setMode?.("build", { go: false });
    if (!toldOnce) {
      toldOnce = true;
      window.MefiToast?.("Opened in Studio, where the details live. The Social switch at the top (Ctrl M) goes back.", "info");
    }
    return true;
  }
  // "Open in Studio": the switch, then the page.
  function openInStudio(id, params = {}) {
    toStudio();
    return nav()?.go?.(id, params);
  }
  // A task opens as its session in Studio (renderer/sessions.js; `tab` picks the inspector's tab, "changes" for a result to
  // review), or on Studio's board where sessions are off.
  function openTask(taskId, { projectId = null, tab = null } = {}) {
    if (!taskId) return false;
    const id = String(taskId);
    toStudio();
    const sessions = window.MefiSessions;
    if (sessions?.active?.() && sessions.open?.(id, { preview: true, ...(tab ? { tab } : {}) })) return true;
    nav()?.go?.("tasks", { taskId: id, ...(projectId ? { projectId } : {}), filter: "all" });
    return true;
  }

  // ---- the Friends card on Social's Home ---------------------------------------------------------------------------
  // Home is up most of the day, so the card asks the relay sparingly: once when it shows, then every five minutes while it
  // can be seen, and again when the window comes back after a minute away (every read is one request on the relay's daily
  // budget; The Lobby, open now and then, reads every minute).
  const REFRESH_MS = 5 * 60_000;
  const WAKE_AFTER_MS = 60_000;
  const MAX_PEOPLE = 6, MAX_ROOMS = 3, MAX_SHARED = 3;
  function peopleCard() {
    const root = el("section", "social-card social-people");
    root.id = "social-people";
    root.setAttribute("aria-labelledby", "social-people-title");
    const head = el("header", "social-card-head");
    const title = el("h2", "social-card-title", "Friends");
    title.id = "social-people-title";
    const online = el("span", "social-online");
    online.hidden = true;
    head.append(title, online);
    const body = el("div", "social-card-body");
    const foot = el("div", "social-card-foot");
    foot.append(button("Open the Lobby", "social-link", () => goFriends("lobby"), { id: "social-people-lobby" }),
      button("Rooms", "social-link", () => goFriends("rooms")));
    root.append(head, body, foot);
    const api = bridge();
    // No room service in this build (a test page, the web preview), or the card switched off: it is not drawn at all.
    if (typeof api?.hubStatus !== "function" || typeof api?.hubRoom !== "function" || friendsCardOff()) { root.hidden = true; root.dataset.state = "unavailable"; return root; }
    let timer = 0, seq = 0, tried = false, readAt = 0;
    const gone = () => root.isConnected === false;
    // Social's Home stays in the page while Studio is up (its layer is hidden): the card reads nothing until it is seen again.
    const seen = () => document.visibilityState !== "hidden" && (typeof root.getClientRects !== "function" || root.getClientRects().length > 0);
    const schedule = (ms = REFRESH_MS) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        if (gone()) return;
        if (!seen()) { schedule(); return; }
        void load();
      }, ms);
    };
    const say = (state, words, ...actions) => {
      root.dataset.state = state;
      online.hidden = true;
      foot.hidden = state !== "ready";
      const line = el("p", "social-card-note", words);
      line.setAttribute("role", "status");
      body.replaceChildren(line, ...(actions.length ? [el("div", "social-card-actions")] : []));
      if (actions.length) body.lastChild.append(...actions);
    };
    async function load() {
      const mine = ++seq;
      let hub = null;
      try { hub = (await api.hubStatus())?.status ?? null; } catch { hub = null; }
      if (gone() || mine !== seq) return;
      if (!hub?.configured) { say("unavailable", "Friends needs the room service, which this copy of Studio can't reach."); return; }
      if (!hub.linked) {
        say("signed-out", "See who's online, join a room and share what you make.",
          button("Sign in with Discord", "social-btn primary", () => goFriends("lobby"), { id: "social-people-signin", title: "The Lobby asks Discord once, in your browser" }));
        return;
      }
      if (hub.state !== "ready") {
        // Signed in and not connected yet: looking at Friends is the ask, as The Lobby does it.
        if (hub.state === "off" && !hub.error && !tried && typeof api.hubConnect === "function") {
          tried = true;
          say("connecting", "Connecting to Friends…");
          try { await api.hubConnect(); } catch { /* the next look says why */ }
          if (!gone() && mine === seq) void load();
          return;
        }
        const words = window.MefiFriendsFront?.hubState?.(hub)?.text || "Not connected to Friends yet.";
        say(hub.state || "off", words, button("Open Friends", "social-btn", () => goFriends("lobby")));
        schedule();
        return;
      }
      if (!hub.front) { say("ready", "You're connected. The Lobby shows who's here."); foot.hidden = false; return; }
      let page = null;
      try { page = await api.hubRoom("front"); } catch { page = null; }
      if (gone() || mine !== seq) return;
      if (!page?.ok) { if (root.dataset.state !== "ready") say("error", "Friends could not be read just now. It tries again in a minute."); schedule(); return; }
      readAt = Date.now();
      paint(page, hub.user?.id ?? null);
      schedule();
    }
    function paint(page, me) {
      root.dataset.state = "ready";
      foot.hidden = false;
      const people = (Array.isArray(page.online?.people) ? page.online.people : []).filter((person) => person && person.id !== me);
      const count = Number(page.online?.count) || 0;
      online.hidden = false;
      online.replaceChildren(el("i", "social-dot"), document.createTextNode(` ${count} online`));
      const parts = [];
      const list = el("ul", "social-people-list");
      list.setAttribute("aria-label", "Online now");
      for (const person of people.slice(0, MAX_PEOPLE)) {
        const item = el("li", "social-person");
        item.dataset.person = String(person.id);
        const face = el("span", "social-face", initials(person.name));
        face.style.setProperty("--who-hue", String(hue(person.id)));
        face.setAttribute("aria-hidden", "true");
        const where = person.where ? (person.where.id === "lobby" ? "In the Lobby" : `In ${person.where.name}`) : person.building?.project ? `Building ${person.building.project}` : "In Studio";
        const words = el("span", "social-person-text");
        words.append(el("b", "", person.name), el("small", "", where));
        const open = button("", "social-person-go", () => (person.where && person.where.id !== "lobby" ? goFriends("rooms", { room: person.where.id }) : goFriends("lobby")));
        open.setAttribute("aria-label", `${person.name}, ${where.toLowerCase()}. ${person.where && person.where.id !== "lobby" ? "Open the room." : "Open the Lobby."}`);
        open.append(face, words);
        item.append(open);
        list.append(item);
      }
      if (!people.length) list.append(el("li", "social-empty", "Nobody else is on right now. The Lobby has your invite code."));
      parts.push(list);
      const rooms = (Array.isArray(page.rooms) ? page.rooms : []).filter((room) => room && room.status !== "closed").slice(0, MAX_ROOMS);
      if (rooms.length) {
        const box = el("div", "social-subsection");
        box.append(el("h3", "social-subhead", "Rooms open now"));
        const roomList = el("ul", "social-rows");
        for (const room of rooms) {
          const item = el("li", "social-row");
          const here = Number(room.here) || 0;
          const words = el("span", "social-row-text");
          words.append(el("b", "", room.name), el("small", "", [room.kind === "cowork" ? "Cowork" : room.kind === "listen" ? "Listening" : "Hangout", here ? `${here} here now` : plural(Number(room.memberCount) || 0, "person", "people")].join(" · ")));
          const member = ["owner", "member", "host"].includes(room.you);
          item.append(words, button(member ? "Open" : "Join", "social-btn", () => goFriends("rooms", { room: room.id }), { title: member ? `Open ${room.name}` : `Ask to join ${room.name}` }));
          roomList.append(item);
        }
        box.append(roomList);
        parts.push(box);
      }
      const shared = [page.top, ...(Array.isArray(page.fresh) ? page.fresh : [])].filter((project) => project && project.title);
      const seen = new Set();
      const unique = shared.filter((project) => (seen.has(project.id) ? false : seen.add(project.id)));
      if (unique.length) {
        const box = el("div", "social-subsection");
        box.append(el("h3", "social-subhead", "Shared this week"));
        const sharedList = el("ul", "social-rows");
        for (const project of unique.slice(0, MAX_SHARED)) {
          const item = el("li", "social-row");
          const words = el("span", "social-row-text");
          words.append(el("b", "", project.title), el("small", "", `${project.owner?.name || "A friend"}'s ${KINDS[project.kind] ?? "project"}`));
          item.append(words, button("See it", "social-btn", () => goFriends("hub"), { title: "Play it from the Project hub" }));
          sharedList.append(item);
        }
        box.append(sharedList);
        parts.push(box);
      }
      body.replaceChildren(...parts);
    }
    // Back on screen (the window came forward, or Home shows again: renderer/today.js show()) after a minute or more: read
    // again soon rather than wait out the five minutes.
    const wake = () => { if (!gone() && seen() && Date.now() - readAt >= WAKE_AFTER_MS) schedule(800); };
    document.addEventListener?.("visibilitychange", wake);
    root.wake = wake;
    root.refresh = () => { tried = false; void load(); };
    root.dispose = () => { clearTimeout(timer); timer = 0; seq += 1; document.removeEventListener?.("visibilitychange", wake); };
    say("loading", "Looking for your friends…");
    void load();
    return root;
  }

  // ---- Projects --------------------------------------------------------------------------------------------------
  const projects = { root: null, list: null, note: null, signature: "" };
  const shortPath = (value) => { const parts = String(value || "").split(/[\\/]+/).filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/"); };
  function mountProjects() {
    if (projects.root) return projects.root;
    const overlay = el("div", "overlay workspace-page social-page");
    overlay.id = "projects-overlay";
    overlay.hidden = true;
    const sheet = el("section", "sheet social-sheet");
    sheet.tabIndex = -1;
    sheet.setAttribute("role", "region");
    sheet.setAttribute("aria-labelledby", "projects-title");
    const head = el("header", "social-page-head");
    const words = el("div", "social-page-words");
    const title = el("h1", "", "Projects");
    title.id = "projects-title";
    title.tabIndex = -1;
    words.append(title, el("p", "social-page-about", "Your apps and projects. Open one to talk about it with Mefi or to build on it."));
    const make = button("New app", "social-btn primary", () => { nav()?.go?.("vibe"); window.MefiVibe?.openPanel?.("newapp"); }, { id: "projects-new-app", title: "Start a new app from a few words" });
    head.append(words, make);
    const list = el("ul", "social-projects");
    list.id = "projects-list";
    list.setAttribute("aria-label", "Your projects");
    const note = el("p", "social-card-note");
    note.id = "projects-note";
    note.setAttribute("role", "status");
    const friends = el("section", "social-card social-projects-friends");
    friends.setAttribute("aria-labelledby", "projects-friends-title");
    const friendsTitle = el("h2", "social-card-title", "What friends made");
    friendsTitle.id = "projects-friends-title";
    friends.append(friendsTitle, el("p", "social-card-note", "Play what your friends share, and share yours, in the Project hub."), button("Open the Project hub", "social-btn", () => goFriends("hub"), { id: "projects-hub" }));
    sheet.append(head, note, list, friends);
    overlay.append(sheet);
    document.body.append(overlay);
    Object.assign(projects, { root: overlay, list, note });
    return overlay;
  }
  async function paintProjects() {
    const api = bridge();
    let answer = null;
    try { answer = await api?.projectsList?.(); } catch { answer = null; }
    if (!projects.root || projects.root.hidden) return;
    const rows = Array.isArray(answer?.projects) ? answer.projects : [];
    const active = window.MefiWorkspace?.activeProjectId?.() || answer?.activeId || null;
    const signature = JSON.stringify([rows.map((row) => [row.id, row.name, row.path]), active]);
    if (signature === projects.signature) return;
    projects.signature = signature;
    projects.list.replaceChildren();
    if (!rows.length) { projects.list.append(el("li", "social-empty", "No projects yet. New app makes one from a few words.")); return; }
    for (const row of rows) {
      const item = el("li", "social-project");
      item.dataset.project = String(row.id);
      const mark = el("span", "social-project-mark", initials(row.name).slice(0, 2));
      mark.setAttribute("aria-hidden", "true");
      const words = el("span", "social-row-text");
      words.append(el("b", "", row.name || "A project"), el("small", "", shortPath(row.path)));
      const here = row.id === active;
      if (here) item.dataset.current = "true";
      const open = button(here ? "Open now" : "Open", here ? "social-btn" : "social-btn primary", () => void choose(row), { title: here ? "This is the open project. Back to Home." : `Open ${row.name}` });
      if (here) open.setAttribute("aria-current", "true");
      item.append(mark, words, open);
      projects.list.append(item);
    }
  }
  async function choose(row) {
    const active = window.MefiWorkspace?.activeProjectId?.();
    if (row.id === active) { nav()?.go?.("vibe"); return; }
    projects.note.textContent = `Opening ${row.name}…`;
    try {
      // Home's own switch: it asks before it stops agents that are still working, and saves their progress when you say so.
      const select = window.MefiWorkspace?.selectProject;
      if (typeof select === "function") await select(row.id);
      else { const answer = await bridge()?.projectsSelect?.(row.id); if (answer?.ok === false) throw new Error(answer.error || "That project could not be opened."); }
      if ((window.MefiWorkspace?.activeProjectId?.() ?? row.id) !== row.id) { projects.note.textContent = "Still in the same project."; return; }
      projects.note.textContent = "";
      nav()?.go?.("vibe");
    } catch (error) {
      projects.note.textContent = error?.message || "That project could not be opened.";
    }
  }
  function openProjects() {
    mountProjects();
    nav()?.claim?.("projects");
    projects.root.hidden = false;
    projects.signature = "";
    window.MefiShell?.sync?.("projects");
    void paintProjects();
    requestAnimationFrame?.(() => document.getElementById("projects-title")?.focus?.({ preventScroll: true }));
    return true;
  }
  function closeProjects() {
    if (!projects.root || projects.root.hidden) return false;
    projects.root.hidden = true;
    nav()?.release?.("projects");
    return true;
  }

  // ---- the registry -------------------------------------------------------------------------------------------------
  function register() {
    nav()?.register?.({
      id: "projects", label: "Projects", short: "Projects", kind: "overlay", layer: "sheet", section: "home", group: "surfaces",
      glyph: "g-folder", badge: null, desc: "Your apps and projects, New app, and what friends made",
      searchTerms: "projects project apps app open switch new app folder my projects shared friends made",
      showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
      element: "projects-overlay", focus: "#projects-title",
      open: () => openProjects(), close: () => closeProjects(), isOpen: () => Boolean(projects.root && !projects.root.hidden),
    });
  }
  if (nav()?.register) register();
  else document.addEventListener?.("DOMContentLoaded", register, { once: true });
  // The project list follows a switch made anywhere while the page shows.
  window.addEventListener?.("mefi:project-changed", () => { if (projects.root && !projects.root.hidden) { projects.signature = ""; void paintProjects(); } });

  window.MefiSocial = { PAGES, studioOnly, toStudio, openInStudio, openTask, peopleCard, openProjects, closeProjects };
})();
