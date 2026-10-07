// Friends › Project hub: members' shared projects on the Mefi Studio relay,
// their credits and ranks (relay/src/credits.mjs). A project is a card: a
// public link, a title and a short blurb, never a file. The Star map draws
// every project as a star (bigger for more plays and stars, a ring while it
// is featured, a faint line between projects by the same maker); New, Top
// and Mine list the same cards; Share adds yours.
//
// Sharing is free and earns nothing by itself. Credits come from playing:
// when a member plays someone else's project for two minutes, both earn (the
// maker 5, the player 2), and a star earns the maker 3. Never bought; spent
// on a day at the top of the hub. Ranks: a level from lifetime
// credits (Spark to Void) and the member's Discord roles as special ranks.
// Your balance is yours; others see only your rank badge.
//
// Everything goes through main's hub:projects channel (HUB_PROJECT_METHODS;
// scripts/hub-client.cjs checks every argument). Play opens the link in the
// browser from main, which counts the play two minutes later. Text is set
// with textContent only. The Star map is drawn once per change, never in a
// loop, and only while the hub is on screen. card() makes the panel;
// dispose() lets it go.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, id, cls = "ghost project-hub-button") => { const el = node("button", cls, text); el.type = "button"; if (id) el.id = id; el.addEventListener("click", run); return el; };
  const bridge = () => window.mefiStudio;
  const KINDS = [["game", "Game"], ["app", "App"], ["tool", "Tool"], ["art", "Art"], ["music", "Music"], ["other", "Other"]];
  const RANK_NAMES = { spark: "Spark", ember: "Ember", flame: "Flame", comet: "Comet", star: "Star", nova: "Nova", void: "Void" };
  const SPECIAL_NAMES = { mod: "Moderator", contributor: "Contributor", patron: "Patron", spotlight: "Spotlight", mentor: "Mentor", helper: "Helper", builder: "Builder", cowork_host: "Cowork host", room_host: "Room host", regular: "Regular" };
  const REASONS = {
    "links-not-allowed": "Sharing opens after your first day in the server.",
    "bad-link": "Share a public https link (itch.io, GitHub Pages, a store page). Short links and home-network addresses are not allowed.",
    "already-shared": "You have already shared that link.",
    "owned-projects": "You have 5 projects on the hub. Remove one to share another.",
    "daily-shares": "You have shared 3 projects today. Try again tomorrow.",
    "hub-full": "The hub is full right now.",
    "one-featured": "One of your projects is already featured.",
    "featured-full": "All three featured spots are taken. One frees up within a day.",
    cooldown: "This project was featured recently. It can be featured again a week after.",
    "featuring-paused": "Featuring is paused for a while. Your credits weren't spent.",
    credits: "You need 100 credits to feature a project.",
    self: "You cannot star your own project.",
    title: "Give it a title.",
    unsupported: "The Project hub isn't on this room service yet. Rooms and chat still work.",
    offline: "Not connected to the room service.",
    "rate-limited": "Slow down a moment, then try again.",
    "read-only": "Your account is read-only in the server right now.",
    paused: "The room service is paused right now.",
  };
  // Why credits have not started (the relay's GUARD), in plain words with the day they will.
  const dateOf = (ms) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "long" });
  const onDay = (ms) => (Number.isFinite(ms) ? ` on ${dateOf(ms)}` : "");
  function holdWords(hold) {
    switch (hold?.reason) {
      case "new-account": return `Credits start when your Discord account is 30 days old${onDay(hold.until)}. Until then, plays and stars you give count for no one.`;
      case "new-member": return `Credits start a week after you joined the Void Engine server${onDay(hold.until)}.`;
      case "forgot-me": return `Credits are paused for 30 days after Forget me${Number.isFinite(hold.until) ? `, until ${dateOf(hold.until)}` : ""}.`;
      case "read-only": return "Credits are paused while your account is read-only in the server.";
      default: return "Credits start once your account is in good standing in the server.";
    }
  }
  // What a finished play earned, or why it earned nothing (the relay's why), in a sentence.
  function playWords(event) {
    const you = event?.credited?.you ?? 0;
    const maker = event?.credited?.owner ?? 0;
    if (you) return `Play counted: +${you} credits for you${maker ? `, +${maker} for the maker` : ""}.`;
    switch (event?.why) {
      case "own": return "That's your own project, so the play doesn't earn credits.";
      case "new-account": return "Play noted. Plays from Discord accounts under 30 days old don't earn credits yet.";
      case "new-member": return "Play noted. Plays start earning a week after you join the Void Engine server.";
      case "forgot-me": return "Play noted. Credits are paused for 30 days after Forget me.";
      case "read-only": return "Play noted. Credits are paused while your account is read-only in the server.";
      case "maker-held": return "Play counted. The maker's account can't earn credits right now, so nobody earned this time.";
      case "limit": return "Play counted. You've already earned from this maker today, or reached a daily or weekly limit.";
      case "paused": return "Play counted. Plays aren't earning credits for a while; the moderators paused them.";
      case "expired": return "That play took more than six hours to finish, so it wasn't counted. Press Play again.";
      default: return event?.counted ? "Play counted." : "Play noted.";
    }
  }
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

  const why = (answer, fallback) => REASONS[answer?.reason] || REASONS[answer?.error] || fallback;
  const why_ = why;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  let current = null;
  let hearing = false;

  function listen(api) {
    if (hearing || typeof api?.onHubEvent !== "function") return;
    hearing = true;
    api.onHubEvent((event) => { if (current) current.hear(event); });
  }

  // A stable spot for a project on the Star map: its id hashed to two numbers in 0..1.
  function spot(id) {
    let a = 2166136261, b = 5381;
    for (let index = 0; index < id.length; index += 1) {
      const code = id.charCodeAt(index);
      a = Math.imul(a ^ code, 16777619) >>> 0;
      b = (Math.imul(b, 33) + code) >>> 0;
    }
    return { x: (a % 1000) / 1000, y: (b % 1000) / 1000 };
  }

  function badge(rankKey) {
    const el = node("span", `project-hub-rank rank-${RANK_NAMES[rankKey] ? rankKey : "spark"}`, RANK_NAMES[rankKey] ?? "Spark");
    el.title = `Rank: ${el.textContent}`;
    return el;
  }

  function card() {
    const root = node("section", "project-hub");
    root.id = "project-hub";
    root.setAttribute("aria-labelledby", "project-hub-title");
    const title = node("h4", "project-hub-title", "Project hub");
    title.id = "project-hub-title";
    const status = node("p", "project-hub-status", "Checking the room service…");
    status.id = "project-hub-status";
    status.setAttribute("role", "status");
    const mine = node("div", "project-hub-me");
    const body = node("div", "project-hub-body");
    root.append(title, status, mine, body);
    const api = bridge();
    if (typeof api?.hubProjects !== "function" || typeof api?.hubStatus !== "function") {
      status.textContent = "The project hub works in the desktop app.";
      root.dataset.state = "unavailable";
      return root;
    }
    listen(api);
    current?.dispose();
    let me = null, tab = "map", projects = [], featured = [], selected = null, busy = false;
    const draft = { url: "", title: "", blurb: "", kind: "game" };
    const reporting = new Set(); // projects whose report reasons are open
    const call = async (method, ...args) => {
      try { return await api.hubProjects(method, ...args); } catch (error) { return { ok: false, error: "failed", message: error?.message }; }
    };
    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      root.setAttribute("aria-busy", "true");
      if (label) status.textContent = label;
      try { await work(); } catch { status.textContent = "The project hub could not do that. Try again."; }
      busy = false;
      root.removeAttribute("aria-busy");
    };

    function paintMe() {
      mine.replaceChildren();
      if (!me) return;
      const head = node("div", "project-hub-me-head");
      head.append(badge(me.rank?.key), node("strong", "", `${plural(me.credits.balance, "credit")}`));
      const next = me.rank?.next;
      const meter = node("div", "project-hub-meter");
      meter.setAttribute("role", "progressbar");
      meter.setAttribute("aria-label", next ? `Progress to ${next.name}` : "Top rank");
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-valuenow", String(Math.round((me.rank?.progress ?? 1) * 100)));
      const fill = node("span", "project-hub-meter-fill");
      fill.style.width = `${Math.round((me.rank?.progress ?? 1) * 100)}%`;
      meter.append(fill);
      const line = node("p", "muted project-hub-me-line",
        `${next ? `${next.at - me.credits.lifetime} more to ${next.name}` : "Top rank"} · today ${me.credits.today}/${me.credits.todayCap}${me.streak.days > 1 ? ` · ${me.streak.days}-day streak` : ""}${me.credits.held > 0 ? ` · ${plural(me.credits.held, "credit")} waiting for a quick check` : ""}`);
      mine.append(head, meter, line);
      if (me.specialRanks.length) {
        const chips = node("div", "project-hub-chips");
        for (const key of me.specialRanks) chips.append(node("span", "project-hub-chip", SPECIAL_NAMES[key] ?? key));
        mine.append(chips);
      }
      if (!me.canEarn) mine.append(node("p", "muted project-hub-hold", holdWords(me.hold)));
    }

    function tabs() {
      const row = node("div", "project-hub-tabs");
      row.setAttribute("role", "tablist");
      for (const [id, label] of [["map", "Star map"], ["new", "New"], ["top", "Top"], ["mine", "Mine"], ["share", "Share"]]) {
        const item = button(label, () => { tab = id; selected = null; void refresh(); }, `project-hub-tab-${id}`);
        item.setAttribute("role", "tab");
        item.setAttribute("aria-selected", String(tab === id));
        item.tabIndex = tab === id ? 0 : -1;
        row.append(item);
      }
      arrowKeys(row);
      return row;
    }

    function actions(project) {
      const row = node("div", "project-hub-actions");
      const playIt = button("Play", () => play(project));
      playIt.setAttribute("aria-label", `Play ${project.title}`);
      row.append(playIt);
      const own = project.owner.id === me?.user?.id;
      if (!own) {
        const starIt = button(project.starred ? "Starred" : "Star", () => star(project, !project.starred));
        starIt.setAttribute("aria-label", project.starred ? `Unstar ${project.title}` : `Star ${project.title}`);
        row.append(starIt);
      }
      if (own && !project.featuredUntil) row.append(button(`Feature (${me?.featureCost ?? 100} credits)`, () => feature(project)));
      if (own) row.append(button("Remove", () => remove(project)));
      // Anyone may report someone else's project; a moderator may also take it off the hub.
      if (!own) row.append(button(reporting.has(project.id) ? "Cancel report" : "Report", () => { if (reporting.has(project.id)) reporting.delete(project.id); else reporting.add(project.id); paint(); }));
      if (!own && me?.moderator) row.append(button("Remove (moderator)", () => remove(project)));
      if (reporting.has(project.id)) {
        const why = node("div", "project-hub-report");
        why.append(node("span", "muted", "What is wrong with it?"));
        for (const reason of ["Spam or a broken link", "Not safe to open", "Someone else's work", "Something else"]) {
          why.append(button(reason, () => guard("Sending the report…", async () => {
            const answer = await call("reportProject", project.id, reason);
            reporting.delete(project.id);
            status.textContent = answer?.ok ? "Thanks. A moderator will look at it." : why_(answer, "The report did not go through.");
            paint();
          })));
        }
        row.append(why);
      }
      return row;
    }

    function projectRow(project) {
      const row = node("li", "project-hub-row");
      row.dataset.project = project.id;
      const text = node("div", "project-hub-row-text");
      const head = node("div", "project-hub-row-head");
      head.append(node("strong", "", project.title));
      if (project.featuredUntil) head.append(node("span", "project-hub-chip featured", "Featured"));
      const by = node("span", "muted project-hub-by", ` by ${project.owner.name} `);
      by.append(badge(project.owner.rank));
      text.append(head, by);
      if (project.blurb) text.append(node("p", "project-hub-blurb", project.blurb));
      // A playlist (YouTube's play-them-all link) shows its videos and plays in Studio (renderer/playlists.js).
      const playlist = window.MefiPlaylists?.fromLink?.(project.url, project.title);
      const shelf = playlist && window.MefiPlaylists.cardFor?.(playlist, { play: false, title: false });
      if (shelf) text.append(shelf);
      text.append(node("span", "muted project-hub-meta", `${project.host} · ${plural(project.plays, "play")} · ${plural(project.stars, "star")} · ${playlist ? "Playlist" : KINDS.find(([id]) => id === project.kind)?.[1] ?? "Other"}`));
      row.append(text, actions(project));
      return row;
    }

    function starMap() {
      const wrap = node("div", "project-hub-map");
      const canvas = node("canvas", "project-hub-canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Star map of ${plural(projects.length, "shared project")}. The list below has the same projects.`);
      const detail = node("div", "project-hub-detail");
      detail.setAttribute("aria-live", "polite");
      const list = node("ul", "project-hub-map-list");
      wrap.append(canvas, detail, list);
      const stars = projects.map((project) => {
        const at = spot(project.id);
        return { project, x: at.x, y: at.y, r: 3 + 2.2 * Math.log2(1 + project.plays + 2 * project.stars) };
      });
      const tone = (name, fallback) => getComputedStyle(root).getPropertyValue(name).trim() || fallback;
      function draw() {
        const width = Math.max(240, Math.min(720, wrap.clientWidth || 480));
        const height = Math.round(width * 0.5);
        const scale = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext?.("2d");
        if (!ctx) return;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const pad = 18;
        const place = (star) => ({ x: pad + star.x * (width - 2 * pad), y: pad + star.y * (height - 2 * pad) });
        // Faint lines between projects by the same maker.
        ctx.strokeStyle = tone("--hairline-strong", "rgba(255,255,255,.18)");
        ctx.lineWidth = 1;
        const byOwner = new Map();
        for (const star of stars) byOwner.set(star.project.owner.id, [...(byOwner.get(star.project.owner.id) ?? []), star]);
        for (const group of byOwner.values()) {
          for (let index = 1; index < group.length; index += 1) {
            const a = place(group[index - 1]), b = place(group[index]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        const colors = { game: tone("--gold-bright", "#a7f3da"), app: tone("--ivory", "#e7f5ee"), tool: tone("--good", "#afdfc2"), art: tone("--warn", "#ffd479"), music: tone("--gold", "#71cbb7"), other: tone("--muted", "#abc4c9") };
        for (const star of stars) {
          const at = place(star);
          const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, star.r * 3);
          glow.addColorStop(0, colors[star.project.kind] ?? colors.other);
          glow.addColorStop(1, "transparent");
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(at.x, at.y, star.r * 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = colors[star.project.kind] ?? colors.other;
          ctx.beginPath(); ctx.arc(at.x, at.y, star.r, 0, Math.PI * 2); ctx.fill();
          if (star.project.featuredUntil || star.project.id === selected) {
            ctx.strokeStyle = star.project.id === selected ? tone("--ivory", "#fff") : tone("--warn", "#ffd479");
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(at.x, at.y, star.r + 5, 0, Math.PI * 2); ctx.stroke();
          }
        }
        // Names beside the stars while the map is not crowded; the list below always has them.
        if (stars.length <= 30) {
          ctx.font = "12px system-ui, sans-serif";
          ctx.textBaseline = "middle";
          for (const star of stars) {
            const at = place(star);
            const right = at.x < width - 120;
            ctx.textAlign = right ? "left" : "right";
            ctx.fillStyle = star.project.id === selected ? tone("--ivory", "#fff") : tone("--muted", "#abc4c9");
            ctx.fillText(star.project.title, at.x + (right ? 1 : -1) * (star.r + 8), at.y);
          }
        }
        canvas.dataset.stars = String(stars.length);
        canvas._place = place;
      }
      function show(project) {
        selected = project?.id ?? null;
        detail.replaceChildren();
        if (project) detail.append(projectRow(project));
        draw();
      }
      canvas.addEventListener("click", (event) => {
        const box = canvas.getBoundingClientRect();
        const x = event.clientX - box.left, y = event.clientY - box.top;
        let best = null;
        for (const star of stars) {
          const at = canvas._place?.(star);
          if (!at) continue;
          const distance = Math.hypot(at.x - x, at.y - y);
          if (distance <= star.r + 8 && (!best || distance < best.distance)) best = { star, distance };
        }
        show(best?.star.project ?? null);
      });
      for (const star of stars) {
        const item = node("li");
        item.append(button(`${star.project.title} · ${star.project.owner.name}`, () => show(star.project), null, "ghost project-hub-map-item"));
        list.append(item);
      }
      if (!stars.length) detail.append(node("p", "muted", "No projects yet. Share yours, and it becomes the first star."));
      requestAnimationFrame(() => { draw(); if (selected) show(projects.find((item) => item.id === selected)); });
      if (typeof ResizeObserver === "function") {
        const watch = new ResizeObserver(() => draw());
        watch.observe(wrap);
        wrap.dispose = () => watch.disconnect();
      }
      return wrap;
    }

    function shareForm() {
      const form = node("form", "project-hub-share");
      const field = (label, input) => { const wrap = node("label", "project-hub-field"); wrap.append(node("span", "", label), input); return wrap; };
      const url = node("input"); url.type = "url"; url.required = true; url.maxLength = 512; url.placeholder = "https://you.itch.io/your-game"; url.value = draft.url; url.id = "project-hub-url";
      const name = node("input"); name.type = "text"; name.required = true; name.maxLength = 100; name.placeholder = "What is it called?"; name.value = draft.title; name.id = "project-hub-name";
      const blurb = node("input"); blurb.type = "text"; blurb.maxLength = 300; blurb.placeholder = "One line about it (optional)"; blurb.value = draft.blurb; blurb.id = "project-hub-blurb";
      const kind = node("select"); kind.id = "project-hub-kind";
      for (const [id, label] of KINDS) { const option = node("option", "", label); option.value = id; option.selected = id === draft.kind; kind.append(option); }
      kind.value = draft.kind;
      for (const [input, key] of [[url, "url"], [name, "title"], [blurb, "blurb"], [kind, "kind"]]) input.addEventListener("input", () => { draft[key] = input.value; });
      const submit = node("button", "project-hub-button", "Share it");
      submit.type = "submit";
      form.append(field("Link", url), field("Title", name), field("About it", blurb), field("Kind", kind), submit,
        node("p", "muted", "Sharing is free. Only the link, title and line above are kept on the hub, never a file. When a member plays it for two minutes, you both earn credits: 5 for you, 2 for them."));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void guard("Sharing…", async () => {
          const answer = await call("shareProject", { url: url.value.trim(), title: name.value.trim(), blurb: blurb.value.trim(), kind: kind.value });
          if (!answer?.ok) { status.textContent = why(answer, "That could not be shared."); return; }
          Object.assign(draft, { url: "", title: "", blurb: "" });
          status.textContent = "Shared. When members play it for two minutes, you both earn credits.";
          tab = "mine";
          await refresh();
        });
      });
      return form;
    }

    function paint() {
      for (const child of [...body.children]) child.dispose?.();
      const parts = [tabs()];
      if (tab === "share") parts.push(shareForm());
      else {
        if (featured.length && tab !== "mine") {
          const strip = node("ul", "project-hub-list project-hub-featured");
          strip.setAttribute("aria-label", "Featured projects");
          for (const project of featured) strip.append(projectRow(project));
          parts.push(strip);
        }
        if (tab === "map") parts.push(starMap());
        else {
          const list = node("ul", "project-hub-list");
          for (const project of projects) list.append(projectRow(project));
          parts.push(projects.length ? list : node("p", "muted", tab === "mine" ? "You have not shared a project yet. Share tab: a link, a title, done." : "No projects yet."));
        }
      }
      body.replaceChildren(...parts);
      paintMe();
    }

    async function refresh() {
      const [who, list] = await Promise.all([call("me"), call("projects", tab === "map" ? "top" : tab === "share" ? "mine" : tab)]);
      if (who?.ok) me = who;
      if (list?.ok) { projects = list.projects; featured = list.featured; }
      else if (list?.error === "unsupported") { status.textContent = REASONS.unsupported; root.dataset.state = "unsupported"; body.replaceChildren(); mine.replaceChildren(); return; }
      paint();
    }

    async function play(project) {
      // A playlist plays in Studio's own player; the play counts the same way.
      const playlist = window.MefiPlaylists?.fromLink?.(project.url, project.title);
      await guard("Opening…", async () => {
        const answer = playlist ? await call("playProject", project.id, { here: true }) : await call("playProject", project.id);
        const minutes = Math.round((answer?.minMs ?? 120000) / 60000), counts = project.owner.id === me?.user?.id ? "" : " for you both";
        if (playlist) {
          window.MefiPlaylists.play(playlist);
          status.textContent = answer?.ok ? `${project.title} is playing in Studio. Listen for ${minutes} minutes and it counts${counts}.` : `${project.title} is playing in Studio; this play won't count: ${why(answer, "the room service didn't answer.")}`;
          return;
        }
        status.textContent = answer?.ok ? `${project.title} opened in your browser. Play for ${minutes} minutes and it counts${counts}.` : why(answer, "That project could not be opened.");
      });
    }
    async function star(project, on) {
      await guard(null, async () => {
        const answer = await call("star", project.id, on);
        if (!answer?.ok) { status.textContent = why(answer, "That did not work."); return; }
        await refresh();
      });
    }
    async function feature(project) {
      const ask = `Feature ${project.title} at the top of the hub for a day, for ${me?.featureCost ?? 100} credits?`;
      if (window.confirm?.(ask) === false) return;
      await guard("Featuring…", async () => {
        const answer = await call("feature", project.id);
        status.textContent = answer?.ok ? `${project.title} is featured for a day. ${plural(answer.balance, "credit")} left.` : why(answer, "That could not be featured.");
        await refresh();
      });
    }
    async function remove(project) {
      if (window.confirm?.(`Take ${project.title} off the hub? Its plays and stars go with it.`) === false) return;
      await guard("Removing…", async () => {
        const answer = await call("removeProject", project.id);
        status.textContent = answer?.ok ? `${project.title} is off the hub.` : why(answer, "That could not be removed.");
        await refresh();
      });
    }

    // Linking happens right here (Discord asks once in the browser), then the
    // room service connects by itself; opening the hub while linked connects once.
    let autoConnected = false;
    const connectNow = () => guard("Connecting…", async () => {
      const answer = await api.hubConnect();
      if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
    });
    async function linkHere() {
      const community = window.MefiCommunity;
      if (typeof community?.link !== "function") { window.MefiNav?.go?.("community"); return; }
      status.textContent = "Discord is asking in your browser. Press Authorize there, then come back.";
      const linked = await community.link();
      if (linked?.ok) { autoConnected = true; await connectNow(); return; }
      if (linked?.error === "not-member") { notMember(); return; }
      status.textContent = linked?.error === "canceled" ? "Signing in was cancelled. Press Sign in with Discord to try again." : "Signing in didn't finish. Press Sign in with Discord to try again.";
    }
    function notMember() {
      root.dataset.state = "not-member";
      status.textContent = "Your Discord account isn't in the Void Engine server yet. Join it, then check again.";
      body.replaceChildren(button("Join the Discord", () => { void window.MefiCommunity?.join?.(); }, "project-hub-join"), button("I've joined, check again", () => guard("Checking…", async () => {
        const checked = await window.MefiCommunity?.check?.();
        if (checked?.ok === false && checked.error === "not-member") { notMember(); return; }
        autoConnected = true;
        const answer = await api.hubConnect();
        if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
      }), "project-hub-recheck"));
    }
    function explain(hub) {
      if (!hub?.configured) { status.textContent = "The project hub needs the room service, which this copy of Studio has no address for."; root.dataset.state = "not-configured"; body.replaceChildren(); return false; }
      if (!hub.linked) {
        root.dataset.state = "not-linked";
        // Friends' one sign-in card (renderer/friends-front.js) when it is in this build.
        const gate = window.MefiFriendsFront?.gate?.({ onSignedIn: () => { autoConnected = true; void load(); } });
        status.textContent = gate ? "" : "Link your Discord account to share and play projects. Discord asks once in your browser.";
        body.replaceChildren(gate ?? button("Sign in with Discord", () => { void linkHere(); }, "project-hub-link"));
        return false;
      }
      if (hub.error === "not-member") { notMember(); return false; }
      if (hub.state === "off" && !hub.error && !autoConnected) {
        autoConnected = true;
        root.dataset.state = "connecting";
        status.textContent = "Connecting to the room service…";
        void connectNow();
        return false;
      }
      if (hub.state !== "ready") {
        root.dataset.state = hub.state || "off";
        // Friends' one way of saying it (renderer/friends-front.js hubState): Connect only when it can help.
        const said = window.MefiFriendsFront?.hubState?.(hub) ?? { action: "connect", text: hub.state === "connecting" ? "Connecting to the room service…" : "Connect to see members' projects." };
        if (said.action === "signin" && window.MefiFriendsFront?.gate) { status.textContent = ""; body.replaceChildren(window.MefiFriendsFront.gate({ onSignedIn: () => { autoConnected = true; void load(); }, note: said.text })); return false; }
        status.textContent = said.text;
        body.replaceChildren(...(said.action === "connect" ? [button("Connect", () => guard("Connecting…", async () => {
          const answer = await api.hubConnect();
          if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
        }), "project-hub-connect")] : []));
        return false;
      }
      if (!hub.projects) { status.textContent = REASONS.unsupported; root.dataset.state = "unsupported"; body.replaceChildren(); return false; }
      root.dataset.state = "ready";
      return true;
    }
    async function load() {
      let hub;
      try { hub = (await api.hubStatus())?.status; } catch { hub = null; }
      if (!explain(hub)) return;
      status.textContent = "Share what you make, play what friends make.";
      await refresh();
    }

    function hear(event) {
      if (root.isConnected === false) { dispose(); return; }
      if (event?.type === "credits" && me) {
        me.credits = { ...me.credits, balance: event.balance, lifetime: event.lifetime ?? me.credits.lifetime, today: event.today ?? me.credits.today };
        if (event.delta > 0) status.textContent = `+${event.delta} credits${{ played: ": someone played your project", play: " for playing", starred: ": someone starred your project" }[event.reason] ?? ""}.`;
        else if (event.reason === "revoked") status.textContent = `A moderator took back ${-event.delta} credits that came from farming.`;
        void refresh();
      } else if (event?.type === "played") {
        status.textContent = playWords(event);
        void refresh();
      } else if (event?.type === "status") void load();
    }
    function dispose() {
      for (const child of [...body.children]) child.dispose?.();
      if (current === handle) current = null;
    }
    const handle = { hear, dispose };
    current = handle;
    root.dispose = dispose;
    void load();
    return root;
  }

  window.MefiProjectHub = { card, spot };
})();
