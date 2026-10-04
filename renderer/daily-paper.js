// The Studio Daily: the launch screen (the boot gate's choose phase) as a
// morning front page. startup.js calls show() once it knows the chooser will
// be asked; the paper then fills #paper-mast and #paper-news inside
// #boot-layer, beside the .boot-card it never touches. The chooser stays
// interactive from the first frame: the paper takes no focus, moves no node
// of the card, and news arriving late only redraws the news column. Above
// the news, "Since you were away" (window.mefiStudio.newsAway and
// releaseWhatsNew) says what changed in the recent projects, which models are
// new and what is new in Studio; a project's name selects it in the chooser.
//
// The host keeps one edition a day (scripts/daily-news-host.cjs) and answers
// window.mefiStudio.newsEdition({ refresh }); onNewsEdition pushes a newer
// one (the AI editor's pass, the morning refresh). Without newsEdition, or
// with Settings › General "Daily news on the launch screen" off, show() does
// nothing and the launch screen is the plain card. Stories open in the
// browser through openExternal, and boot.js puts them after the chooser's
// controls in its Tab cycle (controls()). Pinned by tests/daily_paper.test.mjs;
// the look is renderer/daily-paper.css.
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const $ = (id) => document.getElementById(id);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SECTIONS = { MODELS: "Models", TOOLS: "Tools", RESEARCH: "Research", INDUSTRY: "Industry", STUDIO: "Studio" };
  const WIRE_TAGS = { release: "Release", model: "New model", studio: "Studio", news: "News" };
  const state = { on: false, run: 0, edition: null, stamp: "", loading: false, refreshing: false, listening: false, links: [], els: null, away: null, studio: null };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const supported = () => typeof api()?.newsEdition === "function";
  const safeUrl = (url) => (typeof url === "string" && url.length <= 2048 && /^https?:\/\//i.test(url) ? url : null);

  // ---- words ----
  const pad = (value) => String(value).padStart(2, "0");
  const today = (at = Date.now()) => { const date = new Date(at); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
  const dayOf = (text) => { const [year, month, day] = String(text).split("-").map(Number); return new Date(year, month - 1, day); };
  function longDate(date) {
    try { return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }); }
    catch { return date.toDateString(); }
  }
  function clock(at) {
    try { return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
  }
  // "just now", "12 min ago", "5 h ago", "yesterday", "Sep 24".
  function ago(at, now = Date.now()) {
    if (!Number.isFinite(at)) return "";
    const minutes = Math.max(0, Math.round((now - at) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    if (hours < 48) return "yesterday";
    const date = new Date(at);
    return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  }
  function staleNote(date) {
    const days = Math.round((dayOf(today()) - dayOf(date)) / 86400000);
    if (days === 1) return "Yesterday's edition · offline";
    const when = dayOf(date);
    return `Edition of ${MONTHS[when.getMonth()] ?? ""} ${when.getDate()} · offline`;
  }

  // ---- links ----
  function open(url) {
    const call = api()?.openExternal;
    if (typeof call !== "function") return;
    Promise.resolve(call(url)).catch((error) => console.warn("The story could not be opened", error));
  }
  // A story's words as a link; a story without a web address stays text.
  function link(story, className, text = story.title) {
    const url = safeUrl(story.url);
    if (!url) return node("span", className, text);
    const anchor = node("a", `${className} paper-link`, text);
    anchor.href = url;
    anchor.rel = "noopener noreferrer";
    anchor.dataset.storyId = String(story.id ?? "");
    anchor.addEventListener("click", (event) => { event.preventDefault?.(); open(url); });
    state.links.push(anchor);
    return anchor;
  }
  const kicker = (story) => node("p", "paper-kicker", SECTIONS[story.section] ?? "News");
  function byline(story, { also = false } = {}) {
    const line = node("p", "paper-byline");
    line.append(node("span", "paper-byline-text", [story.source, story.points ? `${story.points} points` : "", ago(story.publishedAt)].filter(Boolean).join(" · ")));
    // The Hacker News thread first when there is one: that is where builders talk it over.
    const more = also ? (story.also ?? []).filter((entry) => safeUrl(entry?.url)).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, 2) : [];
    if (more.length) {
      const wrap = node("span", "paper-also");
      wrap.append(node("span", "paper-also-label", "Also"));
      more.forEach((entry, index) => wrap.append(link({ id: `${story.id}:also:${index}`, url: entry.url }, "paper-also-link", String(entry.source ?? "Source"))));
      line.append(wrap);
    }
    return line;
  }

  // ---- the page ----
  function lead(story) {
    const article = node("article", "paper-lead");
    article.dataset.section = String(story.section ?? "");
    const title = node("h2", "paper-lead-title");
    title.append(link(story, "paper-headline"));
    article.append(kicker(story), title);
    if (story.dek) article.append(node("p", "paper-dek", story.dek));
    article.append(byline(story, { also: true }));
    return article;
  }
  function waiting() {
    const article = node("article", "paper-lead paper-waiting");
    article.append(node("p", "paper-kicker", "Today"), node("h2", "paper-lead-title", "Today's paper is on its way"),
      node("p", "paper-dek", "Studio prints the day's biggest AI and developer-tool news here once it can reach the news wires. Your projects are ready."));
    return article;
  }
  function row(stories) {
    const wrap = node("div", "paper-row");
    for (const story of stories) {
      const article = node("article", "paper-story");
      const title = node("h3", "paper-story-title");
      title.append(link(story, "paper-headline"));
      article.append(kicker(story), title);
      if (story.dek) article.append(node("p", "paper-dek paper-dek-small", story.dek));
      article.append(byline(story, { also: true }));
      wrap.append(article);
    }
    return wrap;
  }
  function briefs(stories) {
    const section = node("section", "paper-briefs");
    section.setAttribute("aria-labelledby", "paper-briefs-title");
    const head = node("h3", "paper-section-title", "In brief");
    head.id = "paper-briefs-title";
    const list = node("ol", "paper-brief-list");
    for (const story of stories) {
      const item = node("li", "paper-brief");
      const title = link(story, "paper-brief-title");
      title.title = story.title;
      item.append(title, node("span", "paper-brief-meta", [story.source, ago(story.publishedAt)].filter(Boolean).join(" · ")));
      list.append(item);
    }
    section.append(head, list);
    return section;
  }
  function wire(entries) {
    const section = node("section", "paper-wire");
    section.setAttribute("aria-labelledby", "paper-wire-title");
    const head = node("h3", "paper-section-title", "Studio wire");
    head.id = "paper-wire-title";
    section.append(head);
    if (!entries.length) { section.append(node("p", "paper-wire-empty", "No new releases or models on the wire today.")); return section; }
    const list = node("ul", "paper-wire-list");
    for (const entry of entries) {
      const item = node("li", "paper-wire-item");
      item.dataset.kind = String(entry.kind ?? "");
      const body = node("span", "paper-wire-body");
      body.append(link(entry, "paper-wire-title"));
      if (entry.dek) body.append(node("span", "paper-wire-dek", entry.dek));
      body.append(node("span", "paper-wire-meta", [entry.source, ago(entry.publishedAt)].filter(Boolean).join(" · ")));
      item.append(node("span", "paper-wire-tag", WIRE_TAGS[entry.kind] ?? "News"), body);
      list.append(item);
    }
    section.append(list);
    return section;
  }
  // Typographic placeholders in the paper's own shape while the wires answer.
  function skeleton() {
    const wrap = node("div", "paper-skeleton");
    wrap.setAttribute("aria-hidden", "true");
    const bars = (...names) => names.map((name) => node("span", `paper-skel ${name}`));
    const top = node("div", "paper-skel-lead");
    top.append(...bars("paper-skel-kicker", "paper-skel-head", "paper-skel-head paper-skel-short", "paper-skel-line", "paper-skel-line paper-skel-short"));
    const stories = node("div", "paper-skel-row");
    for (let count = 0; count < 3; count += 1) {
      const column = node("div", "paper-skel-column");
      column.append(...bars("paper-skel-kicker", "paper-skel-title", "paper-skel-title paper-skel-short", "paper-skel-line", "paper-skel-line"));
      stories.append(column);
    }
    const lower = node("div", "paper-skel-row paper-skel-lower");
    for (let count = 0; count < 2; count += 1) {
      const column = node("div", "paper-skel-column");
      column.append(...bars("paper-skel-kicker", "paper-skel-line", "paper-skel-line", "paper-skel-line paper-skel-short", "paper-skel-line"));
      lower.append(column);
    }
    wrap.append(top, stories, lower);
    return wrap;
  }

  // ---- since you were away ----
  // A band above the news from the host (window.mefiStudio.newsAway, main.cjs
  // "The Studio Daily: since you were away") and What's new: each recent
  // project's changes since it was last opened, the models new since the last
  // day the paper was shown, and Studio's own unread changes. It draws when
  // its answers arrive and never takes the focus; a project's name selects
  // that project in the chooser (MefiStartup.pick) without opening it.
  const AWAY_MODELS = 8;
  const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  function shortDay(text) {
    const date = dayOf(text);
    return Number.isNaN(date.getTime()) ? "" : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  }
  function awayProject(digest) {
    const item = node("li", "paper-away-project");
    item.dataset.projectId = String(digest.id ?? "");
    const name = node("button", "paper-away-name", String(digest.name ?? "Project"));
    name.type = "button";
    name.dataset.storyId = `project:${digest.id}`;
    name.addEventListener("click", () => window.MefiStartup?.pick?.(digest.id));
    state.links.push(name);
    const head = node("p", "paper-away-line");
    head.append(name, node("span", "paper-away-meta", digest.since ? `opened ${ago(digest.since)}` : "not opened yet"));
    const facts = node("ul", "paper-away-facts");
    let count = 0;
    const fact = (tone, words) => {
      const line = node("li", "paper-away-fact", words);
      line.dataset.tone = tone;
      facts.append(line);
      count += 1;
    };
    const first = (list, key) => (Array.isArray(list) && list[0]?.[key] ? `: ${list[0][key]}` : "");
    if (digest.waiting?.count) fact("ask", `${plural(digest.waiting.count, "question")} waiting on you${first(digest.waiting.latest, "title")}`);
    if (digest.finished?.count) fact("done", `${plural(digest.finished.count, "task")} finished${digest.finished.latest?.length ? `: ${digest.finished.latest.map((task) => task.title).join(", ")}` : ""}`);
    if (digest.running) fact("run", `${plural(digest.running, "task")} running`);
    const commits = digest.commits ?? {};
    if (commits.count || commits.unpulled) fact("git", `${[commits.count ? plural(commits.count, "new commit") : "", commits.unpulled ? `${commits.unpulled} not pulled yet` : ""].filter(Boolean).join(" · ")}${first(commits.latest, "subject")}`);
    if (!count) fact("quiet", "Nothing new since you were here.");
    item.append(head, facts);
    return item;
  }
  function awayProjects(list) {
    const column = node("section", "paper-away-col paper-away-projects");
    column.dataset.part = "projects";
    column.append(node("h3", "paper-section-title", "Your projects"));
    if (!list.length) {
      column.append(node("p", "paper-away-empty", "Open a folder and its news shows up here: finished work, questions for you and new commits."));
      return column;
    }
    const items = node("ul", "paper-away-list");
    for (const digest of list) items.append(awayProject(digest));
    column.append(items);
    return column;
  }
  function awayModels(models) {
    const column = node("section", "paper-away-col paper-away-models");
    column.dataset.part = "models";
    const drops = Array.isArray(models?.drops) ? models.drops : [];
    column.append(node("h3", "paper-section-title", models?.firstVisit ? "Recent models" : "New models"));
    if (!drops.length) {
      column.append(node("p", "paper-away-empty", models?.firstVisit ? "No model came out in the last two weeks." : "No new models since your last visit."));
      return column;
    }
    const items = node("ul", "paper-away-list");
    for (const drop of drops.slice(0, AWAY_MODELS)) {
      const item = node("li", "paper-away-model");
      item.dataset.source = String(drop.source ?? "");
      item.append(node("span", "paper-away-model-name", String(drop.name ?? drop.id ?? "")), node("span", "paper-away-meta", [drop.sourceName, drop.releaseDate ? shortDay(drop.releaseDate) : ""].filter(Boolean).join(" · ")));
      items.append(item);
    }
    column.append(items);
    const more = drops.length - AWAY_MODELS;
    if (more > 0) column.append(node("p", "paper-away-note", `and ${plural(more, "more model")}`));
    if (models.firstVisit) column.append(node("p", "paper-away-note", "Released in the last two weeks. From tomorrow, only what is new since your last visit."));
    return column;
  }
  function awayStudio(notes) {
    const column = node("section", "paper-away-col paper-away-studio");
    column.dataset.part = "studio";
    column.append(node("h3", "paper-section-title", "Studio"));
    const unread = notes?.enabled === false ? [] : (Array.isArray(notes?.history) ? notes.history : []).filter((entry) => entry?.unread && Array.isArray(entry.notes) && entry.notes.length);
    if (!unread.length) {
      column.append(node("p", "paper-away-empty", notes?.current ? `You are on Studio ${notes.current}. Nothing new to read.` : "Nothing new in Studio."));
      return column;
    }
    for (const entry of unread.slice(0, 2)) {
      column.append(node("p", "paper-away-version", `New in ${entry.version}`));
      const items = node("ul", "paper-away-list");
      for (const line of entry.notes.slice(0, 3)) items.append(node("li", "paper-away-change", String(line)));
      column.append(items);
    }
    return column;
  }
  function awayBand() {
    const away = state.away;
    if (!away && !state.studio) return null;
    const section = node("section", "paper-away");
    section.setAttribute("aria-labelledby", "paper-away-title");
    const head = node("div", "paper-away-head");
    const title = node("h2", "paper-away-title", "Since you were away");
    title.id = "paper-away-title";
    head.append(node("p", "paper-kicker", "Your studio"), title);
    const grid = node("div", "paper-away-grid");
    grid.append(awayProjects(Array.isArray(away?.projects) ? away.projects : []), awayModels(away?.models), awayStudio(state.studio));
    section.append(head, grid);
    return section;
  }
  async function loadAway() {
    const run = state.run;
    const [away, studio] = await Promise.all([
      Promise.resolve(typeof api()?.newsAway === "function" ? api().newsAway() : null).catch(() => null),
      Promise.resolve(typeof api()?.releaseWhatsNew === "function" ? api().releaseWhatsNew() : null).catch(() => null),
    ]);
    if (run !== state.run || !state.on || away?.disabled) return;
    state.away = away?.ok ? away : null;
    state.studio = studio?.ok ? studio : null;
    if (!state.away && !state.studio) return;
    if (state.edition) paintNews();
    else paintLoading();
  }

  // ---- drawing ----
  function glyph() {
    if (typeof document.createElementNS !== "function") return null;
    const ns = "http://www.w3.org/2000/svg";
    const root = document.createElementNS(ns, "svg");
    for (const [key, value] of Object.entries({ width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "paper-glyph" })) root.setAttribute(key, String(value));
    for (const d of ["M13.5 8a5.5 5.5 0 1 1-1.6-3.9", "M13.5 2.5v3h-3"]) { const part = document.createElementNS(ns, "path"); part.setAttribute("d", d); root.append(part); }
    return root;
  }
  // The masthead's nodes are made once and only their words change, so a
  // Refresh with the keyboard on it keeps the focus.
  function buildMast(mast) {
    const date = node("p", "paper-date"), issue = node("p", "paper-issue");
    const start = node("div", "paper-ear paper-ear-start");
    start.append(date, issue);
    const plate = node("div", "paper-plate");
    const name = node("p", "paper-nameplate", "The Studio Daily");
    name.id = "paper-nameplate";
    plate.append(name, node("p", "paper-motto", "AI, developer tools and your studio"));
    const status = node("p", "paper-status");
    const refresh = node("button", "ghost mini paper-refresh");
    refresh.type = "button";
    refresh.id = "paper-refresh";
    const label = node("span", "paper-refresh-label", "Refresh");
    refresh.append(...[glyph(), label].filter(Boolean));
    refresh.addEventListener("click", () => { if (!state.loading && !state.refreshing) void load(true); });
    const end = node("div", "paper-ear paper-ear-end");
    end.append(status, refresh);
    mast.replaceChildren(start, plate, end);
    state.els = { mast, date, issue, status, refresh, label };
  }
  function paintMast() {
    const els = state.els;
    if (!els) return;
    const edition = state.edition;
    els.date.textContent = longDate(edition?.date ? dayOf(edition.date) : new Date());
    const wires = (edition?.sources ?? []).filter((source) => source?.ok).length;
    els.issue.textContent = [edition?.number ? `No. ${edition.number}` : "Morning edition", wires ? `${wires} wire${wires === 1 ? "" : "s"}` : "", edition?.editor === "ai" ? "AI-edited" : ""].filter(Boolean).join(" · ");
    const stale = Boolean(edition?.stale);
    els.status.textContent = state.refreshing ? "Refreshing…" : state.loading ? "Printing today's edition…"
      : stale ? staleNote(edition.date) : !edition || edition.offline || !edition.lead ? "Waiting for the news wires" : `Updated ${clock(edition.generatedAt)}`;
    els.status.dataset.tone = stale ? "stale" : "";
    const busy = state.loading || state.refreshing;
    // aria-disabled, not disabled: a focused button that disables drops the keyboard to the page.
    els.refresh.setAttribute("aria-disabled", String(busy));
    els.refresh.setAttribute("aria-busy", String(state.refreshing));
    els.label.textContent = state.refreshing ? "Refreshing" : "Refresh";
    // What the paper is and is not, under the chooser.
    const note = $("paper-note");
    if (note) note.textContent = [
      wires ? `Headlines and short summaries from ${wires} news wire${wires === 1 ? "" : "s"}, gathered once a day.` : "Studio gathers the news once a day.",
      edition?.editor === "ai" ? "An AI editor chose the lead and tightened the headlines." : "",
      "Stories open in your browser. Settings › General turns the paper off.",
    ].filter(Boolean).join(" ");
  }
  function paintLoading() {
    const news = $("paper-news");
    if (!news) return;
    state.links = [];
    news.dataset.state = "loading";
    news.setAttribute("aria-busy", "true");
    news.replaceChildren(...[awayBand(), skeleton()].filter(Boolean));
  }
  // Redraws the news column only. A story link that had the keyboard hands
  // it to the same story in the new paper, or to Refresh.
  function paintNews() {
    const news = $("paper-news"), edition = state.edition;
    if (!news || !edition) return;
    const active = document.activeElement;
    const held = active && typeof news.contains === "function" && news.contains(active) ? String(active.dataset?.storyId ?? "") : null;
    state.links = [];
    const band = awayBand();
    const parts = [edition.lead ? lead(edition.lead) : waiting()];
    if (edition.top?.length) parts.push(row(edition.top));
    const lower = node("div", "paper-lower");
    if (edition.briefs?.length) lower.append(briefs(edition.briefs));
    lower.append(wire(edition.wire ?? []));
    parts.push(lower);
    for (const part of parts) part.classList?.add?.("paper-enter");
    if (band) parts.unshift(band);
    news.dataset.state = edition.lead ? "ready" : "empty";
    news.setAttribute("aria-busy", "false");
    news.replaceChildren(...parts);
    if (held !== null) (state.links.find((anchor) => anchor.dataset.storyId === held) ?? state.els?.refresh)?.focus?.({ preventScroll: true });
  }
  const valid = (edition) => Boolean(edition && typeof edition === "object" && typeof edition.date === "string" && Array.isArray(edition.top) && Array.isArray(edition.briefs));
  function accept(edition) {
    if (!valid(edition)) return false;
    const stamp = [edition.date, edition.generatedAt, edition.editor, edition.stale ? "stale" : "", edition.offline ? "offline" : ""].join("|");
    if (stamp === state.stamp) return true;
    state.stamp = stamp;
    state.edition = edition;
    paintNews();
    return true;
  }
  const choosing = () => $("boot-layer")?.dataset?.phase === "choose";

  // ---- the host ----
  async function load(refresh) {
    const run = state.run;
    if (refresh) state.refreshing = true; else state.loading = !state.edition;
    paintMast();
    let answer = null;
    try { answer = await api().newsEdition(refresh ? { refresh: true } : {}); }
    catch (error) { console.warn("Today's paper is unavailable", error); }
    if (run !== state.run || !state.on) return;
    state.loading = false;
    state.refreshing = false;
    if (answer?.disabled) { withdraw(); return; }
    if (!(answer?.ok !== false && accept(answer?.edition)) && !state.edition) accept({ date: today(), generatedAt: Date.now(), lead: null, top: [], briefs: [], wire: [], sources: [], editor: "heuristic", offline: true });
    paintMast();
  }
  function listen() {
    if (state.listening || typeof api()?.onNewsEdition !== "function") return;
    state.listening = true;
    api().onNewsEdition((payload) => {
      if (!state.on || !choosing()) return;
      if (payload?.disabled) { withdraw(); return; }
      if (accept(payload?.edition ?? payload)) paintMast();
    });
  }
  // The host said the paper is off (older host that did not tell startup:state):
  // the launch screen goes back to the plain card; its nodes stay where they are.
  function withdraw() {
    state.on = false;
    state.run += 1;
    state.links = [];
    const layer = $("boot-layer");
    if (layer?.dataset) delete layer.dataset.paper;
    for (const part of [$("paper-mast"), $("paper-note"), $("paper-news")]) if (part) { part.hidden = true; part.replaceChildren(); }
  }
  // Called by startup.js when the chooser is about to be drawn. `enabled` is
  // startup:state's `news` (false: the owner switched the paper off).
  function show({ enabled } = {}) {
    if (enabled === false || !supported()) return false;
    const layer = $("boot-layer"), mast = $("paper-mast"), news = $("paper-news");
    if (!layer || !mast || !news) return false;
    state.run += 1;
    state.on = true;
    state.edition = null;
    state.stamp = "";
    state.away = null;
    state.studio = null;
    state.loading = true;
    state.refreshing = false;
    layer.dataset.paper = "on";
    for (const part of [mast, $("paper-note"), news]) if (part) part.hidden = false;
    buildMast(mast);
    paintLoading();
    paintMast();
    listen();
    void load(false);
    void loadAway();
    return true;
  }
  // boot.js's Tab cycle: the stories in reading order, then Refresh.
  function controls() {
    if (!state.on) return [];
    return [...state.links, state.els?.refresh].filter((element) => element && !element.hidden && element.isConnected !== false);
  }

  // ---- Settings › General › Profile & startup ----
  // settings.ui.dailyNews, saved like "When Studio opens" (prefs:set). Off:
  // the plain chooser, and the host fetches nothing. Hidden without the host.
  function wireSettings() {
    const box = $("launch-daily-news"), row = $("launch-daily-news-row");
    if (!box || box.dataset.wired) return;
    box.dataset.wired = "true";
    if (row) row.hidden = !supported();
    Promise.resolve(api()?.prefsGet?.()).then((result) => { if (result?.prefs) box.checked = result.prefs.dailyNews !== false; }).catch(() => {});
    box.addEventListener("change", async () => {
      const wanted = Boolean(box.checked);
      try {
        const result = await api()?.prefsSet?.({ dailyNews: wanted });
        if (!result?.ok) throw new Error(result?.error || "The launch screen setting could not be saved.");
        window.MefiToast?.(wanted ? "The launch screen will carry the day's news." : "The launch screen will show only your projects, and Studio fetches no news.", "info");
      } catch (error) {
        box.checked = !wanted;
        window.MefiToast?.(error?.message || "The launch screen setting could not be saved.", "warn");
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireSettings, { once: true });
  else wireSettings();

  window.MefiDailyPaper = { show, controls, isOn: () => state.on, ago };
})();
