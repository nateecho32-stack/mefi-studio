/* Roadmap page (roadmap.html). No build step, no framework.
   - Draws assets/roadmap.json into the design system's board: Done (with the
     release timeline), Being worked on and Planned. Every item gets a
     <details> disclosure with its details.
   - The area chips filter the whole board, release highlights and the
     cards of a release included.
     roadmap.html?area=friends opens a filtered view, and #an-item-id opens
     that item.
   - "Most wanted" lists the open feature requests with the most 👍, from
     SITE.fetchFeatureRequests in site.js.
   To change what the roadmap says, edit assets/roadmap.json, not this file.

   The <noscript> copy in roadmap.html is the same markup, made from the JSON
   by MefiRoadmap.board(). After editing the JSON, refresh it by running this
   from the site folder (it rewrites only what is inside that <noscript>):

   node -e "const f=require('fs'),w={};require('vm').runInNewContext(f.readFileSync('assets/roadmap.js','utf8'),{window:w});const b=w.MefiRoadmap.board(JSON.parse(f.readFileSync('assets/roadmap.json','utf8')));f.writeFileSync('roadmap.html',f.readFileSync('roadmap.html','utf8').replace(/(<noscript><div class=.board rm-board. data-roadmap-copy>)[^]*?(<\/div><\/noscript>)/,(m,a,z)=>a+b+z))"
*/
(function () {
  "use strict";

  const STATUSES = ["released", "next", "progress", "rolling", "planned", "idea"];
  const LABELS = { released: "Done", next: "Coming next", progress: "In progress", rolling: "Rolling out", planned: "Planned", idea: "Idea" };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Ids the page itself uses, so no item takes them.
  const RESERVED = ["main", "ask", "ask-title", "wanted-title", "roadmap-title", "labels"];

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const list = (value) => (Array.isArray(value) ? value : []);
  const statusOf = (value) => (STATUSES.includes(value) ? value : "planned");
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // "2026-09-27" becomes "27 September 2026", read as a calendar day so no
  // time zone can move it.
  function day(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    const month = m && MONTHS[Number(m[2]) - 1];
    return month ? `${Number(m[3])} ${month} ${m[1]}` : "";
  }

  // Links in the JSON may be https, an #anchor on this page, or a page of
  // this site ("download.html#updates", "wiki/#/faq"). Anything else is dropped.
  function href(value) {
    const url = String(value ?? "").trim();
    if (/^https:\/\/[^\s"'<>]+$/i.test(url) || /^#[\w-]*$/.test(url) || /^\w[\w./-]*(#[\w/-]*)?$/.test(url)) return url;
    return "#";
  }

  // Unique, URL-safe ids for one drawing of the board.
  function idMaker() {
    const used = new Set(RESERVED);
    return (wanted, fallback) => {
      const base = slug(wanted) || slug(fallback) || "item";
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      return id;
    };
  }

  function linkHtml(link) {
    if (!link || !link.href) return "";
    const url = href(link.href);
    const away = /^https:/i.test(url);
    return `<p class="rm-link"><a href="${esc(url)}"${away ? ' rel="noopener"' : ""}>${esc(link.text || "Read more")} <span aria-hidden="true">${away ? "↗" : "→"}</span></a></p>`;
  }

  function detailsHtml(details) {
    const rows = list(details).map((row) => {
      if (typeof row === "string") return `<li>${esc(row)}</li>`;
      if (!row || typeof row !== "object") return "";
      const sub = list(row.items).map((text) => `<li>${esc(text)}</li>`).join("");
      return `<li>${esc(row.text)}${sub ? `<ul>${sub}</ul>` : ""}</li>`;
    }).join("");
    return rows ? `<details class="rm-more"><summary>Details</summary><ul>${rows}</ul></details>` : "";
  }

  // level: the item's heading level (4 in a lane group, 5 inside a release).
  function itemHtml(item, uid, level = 4) {
    const status = statusOf(item.status);
    const area = String(item.area || "");
    const h = level === 5 ? "h5" : "h4";
    return `<article class="item rm-item" id="${uid(item.id, item.title)}" data-status="${status}" data-area="${esc(slug(area))}">`
      + `<${h}>${esc(item.title)}</${h}>`
      + (item.text ? `<p>${esc(item.text)}</p>` : "")
      + linkHtml(item.link)
      + detailsHtml(item.details)
      + `<div class="meta"><span class="status ${status}">${esc(item.label || LABELS[status])}</span>${area ? `<span class="tag">${esc(area)}</span>` : ""}</div>`
      + "</article>";
  }

  function groupHtml(group, uid) {
    const id = uid(group.id, group.title);
    return `<div class="rm-group" data-group="${id}">`
      + `<h3 class="lane-group" id="${id}">${esc(group.title)}</h3>`
      + (group.note ? `<p class="lane-note rm-group-note">${esc(group.note)}</p>` : "")
      + `<div class="rm-items">${list(group.items).map((item) => itemHtml(item, uid)).join("")}</div>`
      + "</div>";
  }

  function timelineHtml(data, uid) {
    const rows = [];
    const next = data.upcoming;
    if (next && next.version) {
      rows.push(`<li class="upcoming rm-release" data-upcoming>`
        + `<p class="when">${esc(next.when || "Not released yet")}</p>`
        + `<h4><span class="rm-version">${esc(next.version)}</span></h4>`
        + (next.note ? `<p class="rm-release-note">${esc(next.note)}</p>` : "")
        + linkHtml(next.link)
        + "</li>");
    }
    list(data.releases).forEach((release, index) => {
      const highlights = list(release.highlights).map((h) => (typeof h === "string" ? { text: h } : h || {}));
      // A release can carry full items instead of a highlights list: they
      // are drawn as cards, each with its Details, inside its timeline entry.
      const items = list(release.items);
      rows.push(`<li class="rm-release" id="${uid(`release-${release.version}`)}" data-release="${esc(release.version)}">`
        + `<p class="when">${release.date ? `<time datetime="${esc(release.date)}">${esc(day(release.date))}</time>` : ""}</p>`
        + `<h4><span class="rm-version">${esc(release.version)}</span> ${esc(release.title)}</h4>`
        + (release.note ? `<p class="rm-release-note">${esc(release.note)}</p>` : "")
        + (items.length
          ? `<div class="rm-group rm-release-items" data-group="release-${esc(slug(release.version))}"><div class="rm-items">`
            + items.map((item) => itemHtml(item, uid, 5)).join("") + "</div></div>"
          : "")
        + (highlights.length
          ? `<details class="rm-highlights"${index === 0 ? " open" : ""}><summary>${count(highlights.length, "highlight", "highlights")}</summary><ul>`
            + highlights.map((h) => `<li data-area="${esc(slug(h.area))}">${esc(h.text)}</li>`).join("")
            + "</ul></details>"
          : "")
        + (release.href ? `<p class="rm-link"><a href="${esc(href(release.href))}" rel="noopener">Release notes <span aria-hidden="true">↗</span></a></p>` : "")
        + "</li>");
    });
    return `<ol class="timeline rm-timeline">${rows.join("")}</ol>`;
  }

  function laneHtml(lane, data, uid) {
    const id = uid(lane.id, lane.title);
    const done = lane.id === "done";
    const items = list(lane.groups).reduce((n, group) => n + list(group.items).length, 0);
    const releases = list(data.releases).length;
    const total = done ? count(releases, "release", "releases") : count(items, "item", "items");
    const timeline = done && (releases || data.upcoming)
      ? `<div class="rm-group rm-releases" data-group="releases"><h3 class="lane-group" id="${uid("releases")}">${esc(lane.releasesTitle || "Releases")}</h3>`
        + (lane.releasesNote ? `<p class="lane-note rm-group-note">${esc(lane.releasesNote)}</p>` : "")
        + timelineHtml(data, uid) + "</div>"
      : "";
    return `<section class="lane rm-lane" id="${id}" data-lane="${esc(slug(lane.id))}" aria-labelledby="${id}-title">`
      + `<div class="lane-head"><h2 id="${id}-title">${esc(lane.title)}</h2><span class="count" data-count="${esc(total)}">${esc(total)}</span></div>`
      + (lane.note ? `<p class="lane-note">${esc(lane.note)}</p>` : "")
      + timeline
      + list(lane.groups).map((group) => groupHtml(group, uid)).join("")
      + '<p class="rm-none" hidden>Nothing in this area here.</p>'
      + "</section>";
  }

  // The three lanes as HTML, for the page and for its <noscript> copy.
  function board(data) {
    const uid = idMaker();
    return list(data && data.lanes).map((lane) => laneHtml(lane, data, uid)).join("");
  }

  window.MefiRoadmap = { board, day, slug };
  if (typeof document === "undefined") return;

  // ---- the page -------------------------------------------------------------
  const GITHUB = "https://github.com/nateecho32-stack/mefi-studio";
  // A group with more items than this shows its first six (roadmap.css) and a
  // "Show all" button, until a filter or a link needs the rest.
  const FOLD_OVER = 8;

  function initFolds(host) {
    host.querySelectorAll(".rm-group").forEach((group) => {
      const items = group.querySelectorAll(".rm-items > .rm-item");
      const box = group.querySelector(".rm-items");
      if (items.length <= FOLD_OVER || !box) return;
      const more = document.createElement("button");
      more.type = "button";
      more.className = "rm-unfold";
      if (box.id === "") box.id = `${group.dataset.group}-items`;
      more.setAttribute("aria-controls", box.id);
      const paint = () => {
        const folded = group.classList.contains("is-folded");
        more.setAttribute("aria-expanded", String(!folded));
        more.textContent = folded ? `Show all ${items.length}` : "Show fewer";
      };
      more.addEventListener("click", () => {
        group.classList.toggle("is-folded");
        paint();
        if (group.classList.contains("is-folded")) more.scrollIntoView({ block: "nearest" });
      });
      group.classList.add("is-folded");
      paint();
      box.after(more);
    });
  }

  function facts(data) {
    const el = document.querySelector("[data-rm-facts]");
    const latest = list(data.releases).find((r) => r.version === data.latestRelease) || list(data.releases)[0];
    if (!el || !latest) return;
    el.innerHTML = `Latest release: <a href="${esc(href(latest.href))}" rel="noopener">${esc(latest.version)}</a>`
      + (latest.date ? `, ${esc(day(latest.date))}` : "")
      + (data.updated ? ` · Roadmap updated ${esc(day(data.updated))}` : "");
  }

  // Phones and narrow windows (roadmap.css, max-width 960px) show one lane at
  // a time, picked with three buttons above the board. Wider screens ignore
  // this and show all three lanes side by side.
  function initViews(host) {
    const lanes = [...host.querySelectorAll(".rm-lane")];
    if (lanes.length < 2) return null;
    const bar = document.createElement("div");
    bar.className = "rm-views";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Show one lane");
    bar.innerHTML = lanes.map((lane) => {
      const title = lane.querySelector(".lane-head h2");
      return `<button type="button" data-view="${esc(lane.id)}" aria-controls="${esc(lane.id)}" aria-pressed="false">${esc(title ? title.textContent : lane.id)}</button>`;
    }).join("");
    host.before(bar);
    function show(id) {
      if (!lanes.some((lane) => lane.id === id)) return;
      host.dataset.view = id;
      lanes.forEach((lane) => lane.classList.toggle("is-shown", lane.id === id));
      bar.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === id)));
    }
    bar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (button) show(button.dataset.view);
    });
    // While a filter is on, each button says how many matches its lane has,
    // and a lane with none gives way to the first lane that has some.
    function counts(tally, all) {
      bar.querySelectorAll("[data-view]").forEach((button) => {
        let badge = button.querySelector(".count");
        if (all) { if (badge) badge.remove(); return; }
        if (!badge) { badge = document.createElement("span"); badge.className = "count"; button.append(badge); }
        badge.textContent = String(tally[button.dataset.view] || 0);
      });
      if (!all && !(tally[host.dataset.view] > 0)) {
        const first = lanes.find((lane) => tally[lane.id] > 0);
        if (first) show(first.id);
      }
    }
    // What's next is what most people come for.
    show(lanes.some((lane) => lane.id === "working") ? "working" : lanes[0].id);
    return { show, counts };
  }

  function initFilters(data, host, views) {
    const bar = document.querySelector("[data-rm-bar]");
    const row = bar && bar.querySelector("[data-rm-chips]");
    const said = bar && bar.querySelector("[data-rm-said]");
    if (!row) return null;
    const totals = new Map();
    host.querySelectorAll(".rm-item[data-area], .rm-release li[data-area]").forEach((el) => {
      totals.set(el.dataset.area, (totals.get(el.dataset.area) || 0) + 1);
    });
    const names = new Map(list(data.areas).map((name) => [slug(name), String(name)]));
    const areas = [...names.keys()].filter((key) => totals.get(key));
    row.innerHTML = '<button type="button" class="chip" data-area="all" aria-pressed="true">All areas</button>'
      + areas.map((key) => `<button type="button" class="chip" data-area="${esc(key)}" aria-pressed="false">${esc(names.get(key))} <span class="count">${totals.get(key)}</span></button>`).join("");
    bar.hidden = false;

    const newest = host.querySelector(".rm-release[data-release]");
    let area = "all";
    try {
      const wanted = new URLSearchParams(location.search).get("area");
      if (wanted && areas.includes(wanted)) area = wanted;
    } catch (e) { /* no query string support */ }

    function apply(fromUser) {
      const all = area === "all";
      host.classList.toggle("is-filtering", !all);
      host.querySelectorAll(".rm-item").forEach((el) => { el.hidden = !all && el.dataset.area !== area; });
      host.querySelectorAll(".rm-release").forEach((li) => {
        if (li.hasAttribute("data-upcoming")) { li.hidden = !all; return; }
        const rows = [...li.querySelectorAll(":scope > .rm-highlights li[data-area]")];
        let shown = 0;
        rows.forEach((h) => { const on = all || h.dataset.area === area; h.hidden = !on; if (on) shown += 1; });
        // A release drawn as cards stays while any of its cards match.
        const cards = li.querySelectorAll(".rm-item:not([hidden])").length;
        li.hidden = !all && shown === 0 && cards === 0;
        const box = li.querySelector(":scope > .rm-highlights");
        if (box) {
          // Filtering opens every release with a match; "All areas" puts the
          // timeline back as it loads, with only the newest release open.
          box.open = all ? li === newest : shown > 0;
          const sum = box.querySelector("summary");
          if (sum) sum.textContent = all ? count(rows.length, "highlight", "highlights") : `${shown} of ${count(rows.length, "highlight", "highlights")}`;
        }
      });
      host.querySelectorAll(".rm-group").forEach((group) => {
        group.hidden = !group.querySelector(".rm-item:not([hidden]), .rm-release:not([hidden])");
      });
      const tally = {};
      host.querySelectorAll(".rm-lane").forEach((lane) => {
        const items = lane.querySelectorAll(".rm-item").length;
        const shownItems = lane.querySelectorAll(".rm-item:not([hidden])").length;
        const shownHighlights = all ? 0 : lane.querySelectorAll(".rm-release:not([hidden]) li[data-area]:not([hidden])").length;
        const shown = shownItems + shownHighlights;
        const badge = lane.querySelector(".lane-head [data-count]");
        if (badge) badge.textContent = all ? badge.dataset.count : lane.dataset.lane === "done" ? `${shown} shown` : `${shownItems} of ${items}`;
        const none = lane.querySelector(".rm-none");
        if (none) none.hidden = all || shown > 0;
        tally[lane.dataset.lane] = shown;
      });
      if (views) views.counts(tally, all);
      row.querySelectorAll("[data-area]").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.area === area)));
      if (said) {
        said.textContent = all ? "Showing every area."
          : `Showing ${names.get(area)}: ${tally.done || 0} done, ${tally.working || 0} being worked on, ${tally.planned || 0} planned.`;
      }
      if (fromUser && history.replaceState) {
        try {
          const url = new URL(location.href);
          if (all) url.searchParams.delete("area"); else url.searchParams.set("area", area);
          history.replaceState(history.state, "", url.pathname + url.search + url.hash);
        } catch (e) { /* ignore */ }
      }
    }

    row.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-area]");
      if (!chip || !row.contains(chip)) return;
      area = chip.dataset.area;
      apply(true);
    });
    apply(false);
    return { reset() { if (area !== "all") { area = "all"; apply(true); } } };
  }

  // The board draws after the page loads, so the browser's own jump to
  // #an-item has nothing to land on. Do it here: show the item's lane, clear a
  // filter or fold that hides it, and open its details. Later in-page links
  // (the "On this page" row too) use the same path.
  function initTargets(host, filters, views) {
    function go() {
      if (location.hash.length < 2) return;
      let id = "";
      try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
      const el = document.getElementById(id);
      if (!el || !host.contains(el)) return;
      const lane = el.closest(".rm-lane");
      if (lane && views) views.show(lane.id);
      if (el.closest("[hidden]") && filters) filters.reset();
      const folded = el.closest(".rm-group.is-folded");
      if (folded && getComputedStyle(el).display === "none") folded.querySelector(".rm-unfold")?.click();
      const box = el.querySelector(":scope > details");
      if (box) box.open = true;
      host.querySelectorAll(".is-target").forEach((t) => t.classList.remove("is-target"));
      if (el.matches(".rm-item, .rm-release")) el.classList.add("is-target");
      el.scrollIntoView({ block: "start" });
    }
    go();
    window.addEventListener("hashchange", go);
    // A link to the #hash already in the address bar fires no hashchange.
    document.addEventListener("click", (event) => {
      const a = event.target.closest && event.target.closest('a[href^="#"]');
      if (a && a.hash && a.hash === location.hash) setTimeout(go, 0);
    });
  }

  // "Most wanted": the open enhancement issues with the most 👍 on GitHub.
  function initWanted() {
    const box = document.querySelector("[data-wanted]");
    if (!box) return;
    const S = window.SITE;
    const urls = (S && S.urls) || {};
    const every = urls.enhancements || `${GITHUB}/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc`;
    const ask = urls.featureRequest || `${GITHUB}/issues/new?template=feature_request.md`;
    const note = (html) => { box.innerHTML = `<p class="rm-wanted-note">${html}</p>`; box.removeAttribute("aria-busy"); };
    if (!S || typeof S.fetchFeatureRequests !== "function") {
      note(`<a href="${esc(every)}" rel="noopener">See the open requests on GitHub</a>, most 👍 first.`);
      return;
    }
    box.setAttribute("aria-busy", "true");
    box.innerHTML = '<p class="rm-wanted-note"><span class="spinner" aria-hidden="true"></span>Loading requests from GitHub…</p>';
    S.fetchFeatureRequests(6).then((rows) => {
      rows = list(rows).slice(0, 6);
      if (!rows.length) {
        note(`No open requests yet. <a href="${esc(ask)}" rel="noopener">Yours could be the first</a>.`);
        return;
      }
      box.innerHTML = '<ol class="rm-wanted-list">' + rows.map((r) => {
        const votes = Number(r.votes) || 0;
        const comments = Number(r.comments) || 0;
        return '<li class="rm-want">'
          + `<span class="rm-votes"><span aria-hidden="true">👍 ${votes}</span><span class="visually-hidden">${count(votes, "vote", "votes")}</span></span>`
          + `<a class="rm-want-title" href="${esc(href(r.url))}" rel="noopener">${esc(r.title)}</a>`
          + `<span class="rm-want-meta">#${Number(r.number) || ""}${comments ? ` · ${count(comments, "comment", "comments")}` : ""}</span>`
          + "</li>";
      }).join("") + "</ol>";
      box.removeAttribute("aria-busy");
    }).catch(() => note(`GitHub didn't answer just now. <a href="${esc(every)}" rel="noopener">See the requests on GitHub</a>.`));
  }

  function init() {
    initWanted();
    const host = document.querySelector("[data-roadmap]");
    if (!host) return;
    const state = document.querySelector("[data-rm-state]");
    if (state) state.hidden = false;
    fetch(host.getAttribute("data-roadmap") || "assets/roadmap.json", { cache: "no-cache" })
      .then((res) => { if (!res.ok) throw new Error(`roadmap.json answered ${res.status}`); return res.json(); })
      .then((data) => {
        host.innerHTML = board(data);
        host.hidden = false;
        host.removeAttribute("aria-busy");
        if (state) state.hidden = true;
        facts(data);
        initFolds(host);
        const views = initViews(host);
        initTargets(host, initFilters(data, host, views), views);
      })
      .catch(() => {
        host.removeAttribute("aria-busy");
        if (!state) return;
        state.classList.add("is-error");
        state.innerHTML = `The roadmap couldn't load just now. Reload the page, or read <a href="assets/roadmap.json">its data</a> and the <a href="${GITHUB}/blob/main/CHANGELOG.md" rel="noopener">changelog</a>.`;
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
