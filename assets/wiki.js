/* Vibe Studio guide: markdown pages rendered in the browser.
   Pages live in wiki/pages/*.md and are listed in wiki/pages.json, which also
   holds the release the guide describes ("release"), the next one ("next"),
   an optional per-page "status" and old slug "aliases".
   Routing is hash-based: #/<slug> or #/<slug>/<heading-id>. When the browser
   has same-document view transitions and motion is allowed, a page swap
   morphs: the header and the page list hold still and the article fades
   across (site.css names wiki-main and wiki-side; wiki.css has the rest). */
(function () {
  "use strict";

  const MARKED_CDNS = [
    "https://cdnjs.cloudflare.com/ajax/libs/marked/18.0.13/lib/marked.umd.min.js",
    "https://cdn.jsdelivr.net/npm/marked@18.0.13/lib/marked.umd.min.js",
  ];
  const PAGES_DIR = "pages/";
  const S = window.SITE;
  const esc = S.escapeHtml;

  const el = {
    side: document.getElementById("side"),
    sidenav: document.getElementById("sidenav"),
    search: document.getElementById("search"),
    searchStatus: document.getElementById("search-status"),
    results: document.getElementById("results"),
    toggle: document.getElementById("toggle"),
    crumb: document.getElementById("crumb-current"),
    crumbSection: document.getElementById("crumb-section"),
    crumbSectionSep: document.getElementById("crumb-section-sep"),
    notice: document.getElementById("notice"),
    article: document.getElementById("article"),
    pagenav: document.getElementById("pagenav"),
    foot: document.getElementById("foot"),
    toc: document.getElementById("toc"),
    main: document.querySelector(".wiki-main"),
    bar: document.querySelector(".wiki-bar"),
  };
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = window.matchMedia("(max-width: 720px)");
  const wikiDir = new URL("./", location.href);
  const pagesDir = new URL(PAGES_DIR, wikiDir);
  const metaDescription = document.querySelector('meta[name="description"]');
  const baseDescription = metaDescription ? metaDescription.getAttribute("content") : "";

  let manifest = { title: "Vibe Studio guide", sections: [], aliases: {}, release: "0.4.4", next: "0.5" };
  let flat = [];
  let current = null;   // the page being shown or loaded
  let rendered = null;  // the slug whose content is in the article
  let booted = false;
  let navToken = 0;
  let scrollSpy = null;
  let transition = null;
  const cache = new Map();
  const pending = new Map();

  // Keep the skip link out of the hash router while moving keyboard focus.
  document.querySelector(".skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    el.article.focus({ preventScroll: true });
    el.article.scrollIntoView({ block: "start" });
  });

  // ---------- helpers ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.appendChild(s);
    });
  }
  async function ensureMarked() {
    if (window.marked) return true;
    for (const src of MARKED_CDNS) {
      try { await loadScript(src); if (window.marked) return true; } catch (_) { /* try the next one */ }
    }
    return false;
  }
  function slugify(text) {
    return String(text).toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-") || "section";
  }
  function parseHash() {
    let h = location.hash || "";
    try { h = decodeURIComponent(h); } catch (_) { /* keep it raw */ }
    const [slug, ...rest] = h.replace(/^#\/?/, "").split("/");
    return { slug: slug || "home", anchor: rest.join("/") };
  }
  function pageHref(slug, anchor) { return `#/${slug}${anchor ? "/" + anchor : ""}`; }
  function findPage(slug) { return flat.find((p) => p.slug === slug) || null; }
  function showNotice(html, kind) {
    el.notice.className = `notice ${kind || ""}`;
    el.notice.innerHTML = html;
    el.notice.hidden = false;
  }
  function hideNotice() { el.notice.hidden = true; }
  // A heading's words without its "#" link or status badge (ids stay stable
  // when a "Coming in 0.5" badge is later removed).
  function headingText(h) {
    const copy = h.cloneNode(true);
    copy.querySelectorAll(".anchor, .status").forEach((n) => n.remove());
    return copy.textContent.replace(/\s+/g, " ").trim();
  }
  function findAnchor(anchor) {
    if (!anchor) return null;
    const quoted = window.CSS && CSS.escape ? CSS.escape(anchor) : anchor.replace(/["\\]/g, "\\$&");
    return el.article.querySelector(`[data-anchor="${quoted}"]`) || document.getElementById(anchor);
  }
  // Links in a page are relative to wiki/pages/ ("../../roadmap.html"), but a
  // link written relative to the guide itself ("../roadmap.html") works too:
  // anything that would land in wiki/ outside wiki/pages/ is re-read from wiki/.
  function resolveRelative(href) {
    const fromPages = new URL(href, pagesDir);
    const inWiki = fromPages.origin === wikiDir.origin && fromPages.pathname.startsWith(wikiDir.pathname);
    if (inWiki && !fromPages.pathname.startsWith(pagesDir.pathname)) return new URL(href, wikiDir).href;
    return fromPages.href;
  }

  // ---------- data ----------
  async function loadManifest() {
    const res = await fetch("pages.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`pages.json answered ${res.status}`);
    const data = await res.json();
    const sections = Array.isArray(data.sections) ? data.sections : [];
    flat = [];
    sections.forEach((sec) => {
      (sec.pages || []).forEach((p) => {
        flat.push({ slug: p.slug, title: p.title || p.slug, file: p.file || `${p.slug}.md`, summary: p.summary || "", status: p.status || "", section: sec.title || "" });
      });
    });
    manifest = {
      sections,
      title: data.title || "Vibe Studio guide",
      aliases: data.aliases && typeof data.aliases === "object" ? data.aliases : {},
      release: data.release || "0.4.4",
      next: data.next || "0.5",
    };
    return manifest;
  }
  function getPage(page) {
    if (cache.has(page.slug)) return Promise.resolve(cache.get(page.slug));
    if (pending.has(page.slug)) return pending.get(page.slug);
    const request = fetch(PAGES_DIR + page.file, { cache: "no-cache" })
      .then((res) => { if (!res.ok) throw new Error(`${page.file} answered ${res.status}`); return res.text(); })
      .then((text) => { cache.set(page.slug, text); return text; })
      .finally(() => { pending.delete(page.slug); });
    pending.set(page.slug, request);
    return request;
  }
  // Fetch a page when a link to it is hovered or focused, so the swap is instant.
  function prefetchFrom(event) {
    const a = event.target && event.target.closest ? event.target.closest('a[href^="#/"]') : null;
    if (!a) return;
    const page = findPage(a.getAttribute("href").slice(2).split("/")[0]);
    if (page && !cache.has(page.slug)) getPage(page).catch(() => {});
  }

  // ---------- sidebar ----------
  function sideTag(status) {
    if (status === "next") return ` <span class="side-tag next"><span class="visually-hidden">Coming in </span>${esc(manifest.next)}</span>`;
    if (status === "rolling") return ' <span class="side-tag rolling">Rolling out</span>';
    return "";
  }
  function buildSidebar() {
    el.sidenav.innerHTML = manifest.sections.map((sec, i) => {
      const id = `side-group-${i}`;
      const items = (sec.pages || []).map((p) => `<li><a href="${pageHref(p.slug)}" data-slug="${esc(p.slug)}">${esc(p.title || p.slug)}${sideTag(p.status)}</a></li>`).join("");
      return `<p class="side-group" id="${id}">${esc(sec.title || "")}</p><ul aria-labelledby="${id}">${items}</ul>`;
    }).join("");
  }
  function markActive(slug) {
    el.sidenav.querySelectorAll("a[data-slug]").forEach((a) => {
      if (a.dataset.slug === slug) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    revealActive();
  }
  // Keep the current page's link in view inside the (separately scrolling) list.
  function revealActive() {
    const a = el.sidenav.querySelector('a[aria-current="page"]');
    if (!a || !el.side.getClientRects().length || el.side.scrollHeight <= el.side.clientHeight + 1) return;
    const box = el.side.getBoundingClientRect(), r = a.getBoundingClientRect();
    if (r.top < box.top + 48 || r.bottom > box.bottom - 24) el.side.scrollTop += (r.top - box.top) - el.side.clientHeight / 3;
  }
  // On phones the list is a drawer under the page bar.
  function setSide(open) {
    if (open) {
      const top = el.bar ? Math.max(0, Math.round(el.bar.getBoundingClientRect().bottom)) : 0;
      el.side.style.setProperty("--drawer-top", `${top}px`);
    }
    el.side.classList.toggle("open", open);
    document.documentElement.classList.toggle("wiki-drawer-open", open);
    el.toggle.setAttribute("aria-expanded", String(open));
    if (open && narrow.matches) {
      el.side.focus({ preventScroll: true });
      revealActive();
    }
  }
  const sideOpen = () => el.side.classList.contains("open");

  // ---------- rendering ----------
  function renderMarkdown(md) {
    if (window.marked) {
      try { return window.marked.parse(md); } catch (_) { /* fall through to the plain fallback */ }
    }
    return `<div class="notice warn"><p>The markdown renderer could not be loaded (offline?). Showing the page source instead.</p></div><pre><code>${esc(md)}</code></pre>`;
  }

  function noteKind(text) {
    const t = String(text || "").trim().toLowerCase();
    if (t.startsWith("coming in")) return "next";
    if (t.startsWith("rolling out")) return "rolling";
    if (t.startsWith("planned")) return "planned";
    if (t.startsWith("in progress")) return "progress";
    if (t.startsWith("idea")) return "idea";
    return "";
  }

  function postProcess(page) {
    const root = el.article;
    const seen = new Set();
    const shellOwns = (id) => { const other = document.getElementById(id); return Boolean(other) && !root.contains(other); };

    // Heading ids and anchor links. data-anchor is the route anchor; the id
    // only differs when the page shell already uses that id (e.g. "search").
    root.querySelectorAll("h1, h2, h3, h4").forEach((h) => {
      const base = slugify(headingText(h));
      let anchor = base, n = 2;
      while (seen.has(anchor)) anchor = `${base}-${n++}`;
      seen.add(anchor);
      h.dataset.anchor = anchor;
      h.id = shellOwns(anchor) ? `section-${anchor}` : anchor;
      if (h.tagName !== "H1") {
        const a = document.createElement("a");
        a.className = "anchor"; a.href = pageHref(page.slug, anchor); a.textContent = "#"; a.setAttribute("aria-label", `Link to “${headingText(h)}”`);
        h.appendChild(a);
      }
    });

    // Links: other guide pages, in-page anchors, site pages, external sites.
    root.querySelectorAll("a[href]").forEach((a) => {
      if (a.classList.contains("anchor")) return;
      const href = a.getAttribute("href");
      if (!href) return;
      const mdLink = href.match(/^(?![a-z]+:)([^#?]*?)([\w-]+)\.md(#(.*))?$/i);
      if (mdLink) {
        const anchor = mdLink[4] ? slugify(decodeURIComponent(mdLink[4])) : "";
        const slug = findPage(mdLink[2]) ? mdLink[2] : (manifest.aliases[mdLink[2]] || mdLink[2]);
        a.setAttribute("href", pageHref(slug, anchor));
        return;
      }
      if (href.startsWith("#")) {
        if (!href.startsWith("#/")) a.setAttribute("href", pageHref(page.slug, slugify(decodeURIComponent(href.slice(1)))));
        return;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        if (/^https?:/i.test(href) && !href.startsWith(location.origin)) {
          a.target = "_blank"; a.rel = "noopener";
          const note = document.createElement("span");
          note.className = "visually-hidden"; note.textContent = " (opens in a new tab)";
          a.appendChild(note);
        }
        return;
      }
      if (href.startsWith("/")) return;
      a.setAttribute("href", resolveRelative(href));
    });

    // Images: resolved like links, loaded lazily.
    root.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("/")) img.setAttribute("src", resolveRelative(src));
      img.loading = "lazy";
      img.decoding = "async";
    });

    // "> **Coming in 0.5:** …" and friends take the status colours.
    root.querySelectorAll("blockquote").forEach((q) => {
      const p = q.firstElementChild;
      const lead = p && p.firstChild && p.firstChild.nodeType === 1 ? p.firstChild : null;
      if (!lead) return;
      let kind = "";
      if (lead.classList.contains("status")) kind = ["next", "rolling", "planned", "progress", "idea", "released"].find((k) => lead.classList.contains(k)) || "";
      else if (/^(strong|b)$/i.test(lead.tagName)) kind = noteKind(lead.textContent);
      if (kind) q.classList.add("note", `note-${kind}`);
    });

    // Tables scroll on narrow screens; a table that does scroll can be reached by keyboard.
    root.querySelectorAll("table").forEach((t) => {
      if (t.parentElement && t.parentElement.classList.contains("table-wrap")) return;
      const wrap = document.createElement("div"); wrap.className = "table-wrap";
      t.replaceWith(wrap); wrap.appendChild(t);
      if (wrap.scrollWidth > wrap.clientWidth + 1) {
        wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", "Table, scrolls sideways");
      }
    });
  }

  function buildToc(page) {
    if (scrollSpy) { scrollSpy.disconnect(); scrollSpy = null; }
    const heads = Array.from(el.article.querySelectorAll("h2, h3"));
    if (heads.length < 2) { el.toc.innerHTML = ""; el.toc.hidden = true; return; }
    el.toc.hidden = false;
    el.toc.innerHTML = `<p class="toc-title">On this page</p><ul>${heads.map((h) => `<li class="${h.tagName.toLowerCase()}"><a href="${pageHref(page.slug, h.dataset.anchor)}">${esc(headingText(h))}</a></li>`).join("")}</ul>`;
    if (!("IntersectionObserver" in window)) return;
    const links = el.toc.querySelectorAll("a");
    const byHeading = new Map(heads.map((h, i) => [h, links[i]]));
    scrollSpy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.remove("active"));
        const a = byHeading.get(entry.target);
        if (a) a.classList.add("active");
      });
    }, { rootMargin: "-70px 0px -70% 0px", threshold: 0 });
    heads.forEach((h) => scrollSpy.observe(h));
  }

  function buildPageNav(page) {
    const i = flat.findIndex((p) => p.slug === page.slug);
    const prev = i > 0 ? flat[i - 1] : null;
    const next = i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;
    el.pagenav.innerHTML = [
      prev ? `<a class="prev" rel="prev" href="${pageHref(prev.slug)}"><small>← Previous</small>${esc(prev.title)}</a>` : "<span></span>",
      next ? `<a class="next" rel="next" href="${pageHref(next.slug)}"><small>Next →</small>${esc(next.title)}</a>` : "<span></span>",
    ].join("");
  }

  function buildFoot(page) {
    const links = [];
    if (S.siteRepo) {
      const root = S.siteRoot ? `${S.siteRoot.replace(/\/+$/, "")}/` : "";
      links.push(`<a href="https://github.com/${esc(S.siteRepo)}/edit/${esc(S.siteBranch)}/${root}wiki/pages/${esc(page.file)}" rel="noopener">Edit this page on GitHub</a>`);
    }
    const body = `Page: ${page.slug} (wiki/pages/${page.file})\n\nWhat should change:\n`;
    links.push(`<a href="${esc(S.urls.newIssue(`wiki: ${page.title}`, body))}" rel="noopener">Suggest a change</a>`);
    links.push(`<a href="${esc(S.urls.architecture)}" rel="noopener">Technical reference</a>`);
    el.foot.innerHTML = `<span class="wf-links">${links.join("")}</span>`
      + `<span class="wf-version">Guide for Studio ${esc(manifest.release)} · items marked <span class="status next">Coming in ${esc(manifest.next)}</span> arrive in the next release</span>`;
  }

  function setCrumbs(title, section) {
    el.crumb.textContent = title;
    const showSection = Boolean(section) && section !== title;
    el.crumbSection.textContent = showSection ? section : "";
    el.crumbSection.hidden = !showSection;
    el.crumbSectionSep.hidden = !showSection;
  }

  function setMeta(title, summary) {
    document.title = title ? `${title} · ${manifest.title}` : manifest.title;
    if (metaDescription) metaDescription.setAttribute("content", summary ? `${summary}. ${manifest.title}.` : baseDescription);
  }

  function renderMissing(slug) {
    current = null; rendered = null;
    markActive("");
    setCrumbs("Not found", "");
    setMeta("Not found", "");
    const groups = manifest.sections.map((sec) => `<h2>${esc(sec.title || "")}</h2><ul>${(sec.pages || []).map((p) => `<li><a href="${pageHref(p.slug)}">${esc(p.title || p.slug)}</a>${p.summary ? ` <span class="dim">· ${esc(p.summary)}</span>` : ""}</li>`).join("")}</ul>`).join("");
    el.article.innerHTML = `<h1>No page called “${esc(slug)}”</h1><p>Pick one below, or start at <a href="#/home">Start here</a>.</p>${groups}`;
    el.pagenav.innerHTML = ""; el.foot.innerHTML = ""; el.toc.innerHTML = ""; el.toc.hidden = true;
    if (scrollSpy) { scrollSpy.disconnect(); scrollSpy = null; }
  }

  function renderError(page, error) {
    rendered = null;
    const source = S.siteRepo ? `https://github.com/${esc(S.siteRepo)}/blob/${esc(S.siteBranch)}/wiki/pages/${esc(page.file)}` : "";
    el.article.innerHTML = `<h1>${esc(page.title)}</h1><div class="notice warn"><p>This page could not be loaded (${esc(error.message)}). Check your connection and reload${source ? `, or <a href="${source}" rel="noopener">read it on GitHub</a>` : ""}.</p></div>`;
    el.toc.innerHTML = ""; el.toc.hidden = true;
    if (scrollSpy) { scrollSpy.disconnect(); scrollSpy = null; }
  }

  // ---------- page swaps ----------
  // Runs update() inside a view transition when one is available and motion
  // is allowed. When the article would jump (scrolled deep, or the phone
  // drawer closes), it leaves its name so it fades where it was instead of
  // sliding across the screen.
  function swap(update) {
    const root = document.documentElement;
    root.classList.remove("wiki-flat");
    let ran = false, settle = null;
    const done = new Promise((resolve) => { settle = resolve; });
    const run = () => {
      if (ran) return false;
      ran = true;
      try { update(); } finally { settle(); }
      return true;
    };
    const animate = booted && typeof document.startViewTransition === "function" && !still.matches && document.visibilityState === "visible";
    if (!animate) { run(); return done; }
    const before = el.main.getBoundingClientRect().top;
    let t = null;
    try {
      t = document.startViewTransition(() => {
        if (!run()) return;
        const after = el.main.getBoundingClientRect().top;
        if (transition === t && Math.abs(after - before) > 24) root.classList.add("wiki-flat");
      });
    } catch (_) {
      run();
      return done;
    }
    transition = t;
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    const end = () => { if (transition === t) { transition = null; root.classList.remove("wiki-flat"); } };
    t.finished.then(end, end);
    // A transition waits for a painted frame. A view that paints none (a
    // throttled or embedded one) must still get the new page, so skip it.
    setTimeout(() => {
      if (ran) return;
      try { t.skipTransition(); } catch (_) { /* already over */ }
      setTimeout(run, 0);
    }, 400);
    return done;
  }

  function focusTarget(anchor) {
    const target = findAnchor(anchor) || el.article.querySelector("h1") || el.article;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    try { target.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
  }

  function jump(anchor, fresh) {
    const smooth = !fresh && !still.matches;
    const go = () => {
      const target = findAnchor(anchor);
      if (target) { target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "instant" }); return true; }
      if (fresh) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return false;
    };
    go();
    if (!anchor || !fresh) return;
    // On a fresh navigation the document "load" event (which waits for the
    // CDN renderer script) can fire after the page rendered and cancel or
    // reset the scroll, so repeat the jump once everything has settled.
    requestAnimationFrame(() => setTimeout(go, 60));
    if (document.readyState !== "complete") window.addEventListener("load", () => setTimeout(go, 0), { once: true });
  }

  async function show(slug, anchor) {
    const token = ++navToken;
    if (!findPage(slug) && manifest.aliases[slug] && findPage(manifest.aliases[slug])) {
      slug = manifest.aliases[slug];
      history.replaceState(null, "", pageHref(slug, anchor));
    }
    const page = findPage(slug);
    if (!page) {
      await swap(() => { renderMissing(slug); setSide(false); jump("", true); if (booted) focusTarget(""); });
      return;
    }
    if (current === page && rendered === slug) {
      jump(anchor, false);
      if (anchor) focusTarget(anchor);
      return;
    }
    current = page;
    markActive(slug);
    // Keep the old page on screen while the next one loads; dim it if that is slow.
    const slow = setTimeout(() => { if (token === navToken) el.article.setAttribute("aria-busy", "true"); }, 200);
    let md = null, error = null;
    try { md = await getPage(page); } catch (e) { error = e; }
    clearTimeout(slow);
    if (token !== navToken) return; // another page was picked meanwhile
    await swap(() => {
      el.article.removeAttribute("aria-busy");
      setCrumbs(page.title, page.section);
      setMeta(page.title, page.summary);
      if (error) {
        renderError(page, error);
      } else {
        el.article.innerHTML = renderMarkdown(md);
        postProcess(page);
        buildToc(page);
        rendered = slug;
      }
      buildPageNav(page);
      buildFoot(page);
      setSide(false);
      jump(anchor, true);
      if (booted) focusTarget(anchor);
    });
  }

  // ---------- search ----------
  let searchTimer = null;
  let hitsShown = [];
  function ensureIndex() {
    return Promise.all(flat.map((p) => getPage(p).catch(() => "")));
  }
  function stripMd(md) {
    return md
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
      .replace(/[#>*_`|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function highlight(text, words) {
    if (!words.length) return esc(text);
    const re = new RegExp(`(${words.map(reEscape).join("|")})`, "ig");
    return String(text).split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
  }
  function countOf(haystack, needle) {
    let count = 0, idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) >= 0 && count < 50) { count++; idx += needle.length; }
    return count;
  }
  function announce(text) { if (el.searchStatus) el.searchStatus.textContent = text; }
  function clearSearch() {
    el.search.value = "";
    hitsShown = [];
    el.results.hidden = true; el.results.innerHTML = "";
    el.sidenav.hidden = false;
    announce("");
  }
  function runSearch(q) {
    const phrase = q.trim().toLowerCase().replace(/\s+/g, " ");
    const words = phrase.split(" ").filter(Boolean).slice(0, 6);
    if (!words.length) { clearSearch(); return; }
    const hits = [];
    flat.forEach((p) => {
      const text = stripMd(cache.get(p.slug) || "");
      const lower = text.toLowerCase(), title = p.title.toLowerCase(), summary = p.summary.toLowerCase();
      let score = 0;
      for (const w of words) {
        const count = countOf(lower, w), inTitle = title.includes(w), inSummary = summary.includes(w);
        if (!count && !inTitle && !inSummary) return; // every word must appear somewhere
        score += (inTitle ? 60 : 0) + (inSummary ? 15 : 0) + Math.min(count, 25);
      }
      if (words.length > 1 && title.includes(phrase)) score += 100;
      if (words.length > 1 && lower.includes(phrase)) score += 20;
      let at = lower.indexOf(phrase), len = phrase.length;
      if (at < 0) words.forEach((w) => { const i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; } });
      let snippet = p.summary;
      if (at >= 0) {
        const start = Math.max(0, at - 60), end = Math.min(text.length, at + len + 80);
        snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
      }
      hits.push({ page: p, snippet, score });
    });
    hits.sort((a, b) => b.score - a.score);
    hitsShown = hits.slice(0, 12);
    el.results.innerHTML = hitsShown.length
      ? hitsShown.map((h) => `<a href="${pageHref(h.page.slug)}"><strong>${highlight(h.page.title, words)}</strong><small><span class="hit-section">${esc(h.page.section)}</span>${h.snippet ? ` · ${highlight(h.snippet, words)}` : ""}</small></a>`).join("")
      : `<div class="none">Nothing matches “${esc(q.trim())}”. Try fewer words, or <a href="${esc(S.urls.discord)}" rel="noopener">ask on Discord</a>.</div>`;
    el.results.hidden = false;
    el.sidenav.hidden = true;
    announce(hits.length ? `${S.plural(hits.length, "page matches", "pages match")}${hits.length > hitsShown.length ? `, showing the first ${hitsShown.length}` : ""}.` : "No pages match.");
  }
  el.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = el.search.value;
    if (!q.trim()) { clearSearch(); return; }
    searchTimer = setTimeout(async () => { await ensureIndex(); if (el.search.value.trim()) runSearch(el.search.value); }, 160);
  });
  el.search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.search.value) { e.stopPropagation(); clearSearch(); return; }
    if (e.key === "Enter" && hitsShown.length) {
      e.preventDefault();
      const slug = hitsShown[0].page.slug;
      clearSearch();
      if (location.hash === pageHref(slug)) show(slug, ""); else location.hash = pageHref(slug);
      return;
    }
    if (e.key === "ArrowDown" && !el.results.hidden) {
      const first = el.results.querySelector("a");
      if (first) { e.preventDefault(); first.focus(); }
    }
  });
  el.results.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = Array.from(el.results.querySelectorAll("a[href^='#/']"));
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp" && i === 0) el.search.focus();
    else links[Math.max(0, Math.min(links.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
  });
  el.results.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("a[href^='#/']")) clearSearch(); });

  // ---------- keys, drawer and prefetch ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      e.preventDefault();
      if (!el.side.getClientRects().length) setSide(true);
      el.search.focus();
      return;
    }
    if (e.key === "Escape" && sideOpen() && narrow.matches) {
      setSide(false);
      el.toggle.focus();
    }
  });
  el.toggle.addEventListener("click", () => setSide(!sideOpen()));
  narrow.addEventListener?.("change", () => { if (sideOpen()) setSide(false); });
  document.addEventListener("pointerover", prefetchFrom, { passive: true });
  document.addEventListener("focusin", prefetchFrom);

  // ---------- boot ----------
  async function boot() {
    if (location.protocol === "file:") {
      showNotice(`<p><strong>The guide needs to be served over HTTP.</strong> Browsers block <code>fetch()</code> for <code>file://</code> pages, so the markdown cannot load from disk. From the site folder run <code>python -m http.server 8080</code> and open <code>http://localhost:8080/wiki/</code>. On GitHub Pages this just works.</p>`, "warn");
    }
    const [hasMarked] = await Promise.all([ensureMarked(), loadManifest()]);
    if (hasMarked) {
      try { window.marked.use({ gfm: true, breaks: false }); } catch (_) { /* defaults are fine */ }
    } else {
      showNotice(`<p>The markdown renderer could not be fetched from its CDN, so pages are shown as plain text. Check the network connection and reload.</p>`, "warn");
    }
    buildSidebar();
    window.addEventListener("hashchange", () => { const r = parseHash(); show(r.slug, r.anchor); });
    const route = parseHash();
    await show(route.slug, route.anchor);
    booted = true;
  }

  boot().catch((e) => {
    el.article.removeAttribute("aria-busy");
    el.article.innerHTML = `<h1>The guide could not start</h1><div class="notice warn"><p>${esc(e.message)}</p></div><p>If you opened this file directly from disk, serve the folder over HTTP instead (see the note above). Otherwise check that <code>wiki/pages.json</code> exists beside this page, or read the pages <a href="https://github.com/nateecho32-stack/mefi-studio/tree/gh-pages/wiki/pages" rel="noopener">on GitHub</a>.</p>`;
    if (location.protocol !== "file:") hideNotice();
  });
})();
