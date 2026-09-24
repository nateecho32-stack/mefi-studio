/* Mefi's Studio AI+ wiki — markdown pages rendered in the browser.
   Pages live in wiki/pages/*.md and are listed in wiki/pages.json.
   Routing is hash-based: #/<slug> or #/<slug>/<heading-id>. */
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
    results: document.getElementById("results"),
    toggle: document.getElementById("toggle"),
    crumb: document.getElementById("crumb-current"),
    notice: document.getElementById("notice"),
    article: document.getElementById("article"),
    pagenav: document.getElementById("pagenav"),
    foot: document.getElementById("foot"),
    toc: document.getElementById("toc"),
  };

  let manifest = null;
  let flat = [];
  let current = null;
  const cache = new Map();
  let scrollSpy = null;

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
    const h = decodeURIComponent(location.hash || "").replace(/^#\/?/, "");
    const [slug, ...rest] = h.split("/");
    return { slug: slug || "home", anchor: rest.join("/") };
  }
  function pageHref(slug, anchor) { return `#/${slug}${anchor ? "/" + anchor : ""}`; }
  function showNotice(html, kind) {
    el.notice.className = `notice ${kind || ""}`;
    el.notice.innerHTML = html;
    el.notice.hidden = false;
  }
  function hideNotice() { el.notice.hidden = true; }
  function pagesBase() { return new URL(PAGES_DIR, location.href); }

  // ---------- data ----------
  async function loadManifest() {
    const res = await fetch("pages.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`pages.json answered ${res.status}`);
    const data = await res.json();
    const sections = Array.isArray(data.sections) ? data.sections : [];
    flat = [];
    sections.forEach((sec) => {
      (sec.pages || []).forEach((p) => {
        const page = { slug: p.slug, title: p.title || p.slug, file: p.file || `${p.slug}.md`, summary: p.summary || "", section: sec.title || "" };
        flat.push(page);
      });
    });
    manifest = { sections, title: data.title || "Wiki" };
    return manifest;
  }
  async function getPage(page) {
    if (cache.has(page.slug)) return cache.get(page.slug);
    const res = await fetch(PAGES_DIR + page.file, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${page.file} answered ${res.status}`);
    const text = await res.text();
    cache.set(page.slug, text);
    return text;
  }

  // ---------- sidebar ----------
  function buildSidebar() {
    const parts = [];
    manifest.sections.forEach((sec) => {
      parts.push(`<h4>${esc(sec.title || "")}</h4><ul>`);
      (sec.pages || []).forEach((p) => {
        parts.push(`<li><a href="${pageHref(p.slug)}" data-slug="${esc(p.slug)}">${esc(p.title || p.slug)}</a></li>`);
      });
      parts.push("</ul>");
    });
    el.sidenav.innerHTML = parts.join("");
  }
  function markActive(slug) {
    el.sidenav.querySelectorAll("a[data-slug]").forEach((a) => {
      if (a.dataset.slug === slug) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  // ---------- rendering ----------
  function renderMarkdown(md) {
    if (window.marked) {
      try {
        window.marked.use({ gfm: true, breaks: false });
        return window.marked.parse(md);
      } catch (e) { /* fall through to the plain fallback */ }
    }
    return `<div class="notice warn"><p>The markdown renderer could not be loaded (offline?). Showing the page source instead.</p></div><pre><code>${esc(md)}</code></pre>`;
  }

  function postProcess(page) {
    const root = el.article;
    const base = pagesBase();
    const seen = new Set();

    // Heading ids and anchor links.
    root.querySelectorAll("h1, h2, h3, h4").forEach((h) => {
      let id = slugify(h.textContent);
      let n = 2;
      while (seen.has(id)) { id = `${slugify(h.textContent)}-${n++}`; }
      seen.add(id);
      h.id = id;
      if (h.tagName !== "H1") {
        const a = document.createElement("a");
        a.className = "anchor"; a.href = pageHref(page.slug, id); a.textContent = "#"; a.setAttribute("aria-label", "Link to this section");
        h.appendChild(a);
      }
    });

    // Links: other wiki pages, in-page anchors, relative files, external sites.
    root.querySelectorAll("a[href]").forEach((a) => {
      if (a.classList.contains("anchor")) return;
      const href = a.getAttribute("href");
      if (!href) return;
      const mdLink = href.match(/^(?![a-z]+:)([^#?]*?)([\w-]+)\.md(#(.*))?$/i);
      if (mdLink) {
        const anchor = mdLink[4] ? slugify(decodeURIComponent(mdLink[4])) : "";
        a.setAttribute("href", pageHref(mdLink[2], anchor));
        return;
      }
      if (href.startsWith("#")) {
        if (!href.startsWith("#/")) a.setAttribute("href", pageHref(page.slug, slugify(decodeURIComponent(href.slice(1)))));
        return;
      }
      if (/^[a-z]+:/i.test(href)) {
        if (!href.startsWith(location.origin)) { a.target = "_blank"; a.rel = "noopener"; }
        return;
      }
      a.setAttribute("href", new URL(href, base).href);
    });

    // Images relative to wiki/pages/.
    root.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !/^[a-z]+:/i.test(src) && !src.startsWith("/")) img.setAttribute("src", new URL(src, base).href);
      img.loading = "lazy";
    });

    // Tables scroll on narrow screens.
    root.querySelectorAll("table").forEach((t) => {
      if (t.parentElement && t.parentElement.classList.contains("table-wrap")) return;
      const wrap = document.createElement("div"); wrap.className = "table-wrap";
      t.replaceWith(wrap); wrap.appendChild(t);
    });
  }

  function buildToc(page) {
    if (scrollSpy) { scrollSpy.disconnect(); scrollSpy = null; }
    const heads = Array.from(el.article.querySelectorAll("h2, h3"));
    if (heads.length < 2) { el.toc.innerHTML = ""; return; }
    el.toc.innerHTML = `<h4>On this page</h4><ul>${heads.map((h) => `<li class="${h.tagName.toLowerCase()}"><a href="${pageHref(page.slug, h.id)}" data-target="${esc(h.id)}">${esc(h.firstChild ? h.firstChild.textContent : h.textContent)}</a></li>`).join("")}</ul>`;
    if (!("IntersectionObserver" in window)) return;
    const links = new Map(Array.from(el.toc.querySelectorAll("a[data-target]")).map((a) => [a.dataset.target, a]));
    scrollSpy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.remove("active"));
        const a = links.get(entry.target.id);
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
      prev ? `<a class="prev" href="${pageHref(prev.slug)}"><small>← Previous</small>${esc(prev.title)}</a>` : "<span></span>",
      next ? `<a class="next" href="${pageHref(next.slug)}"><small>Next →</small>${esc(next.title)}</a>` : "<span></span>",
    ].join("");
  }

  function buildFoot(page) {
    let edit;
    if (S.siteRepo) {
      const root = S.siteRoot ? `${S.siteRoot.replace(/\/+$/, "")}/` : "";
      edit = `<a href="https://github.com/${esc(S.siteRepo)}/edit/${esc(S.siteBranch)}/${root}wiki/pages/${esc(page.file)}" rel="noopener">Edit this page on GitHub</a>`;
    } else {
      const body = `Page: ${page.slug} (wiki/pages/${page.file})\n\nWhat should change:\n`;
      edit = `<a href="${S.urls.newIssue(`wiki: ${page.title}`, body)}" rel="noopener">Suggest a change to this page</a>`;
    }
    el.foot.innerHTML = `<span>${edit}</span><span>Source of truth: the <a href="${S.urls.repo}" rel="noopener">repository docs</a>. Found a mismatch? The docs win.</span>`;
  }

  function renderMissing(slug) {
    current = null;
    markActive("");
    el.crumb.textContent = "Not found";
    document.title = `Not found · Wiki · ${S.appName}`;
    el.article.innerHTML = `<h1>No page called “${esc(slug)}”</h1><p>Pick one from the list, or start at the <a href="#/home">wiki home</a>.</p><ul>${flat.map((p) => `<li><a href="${pageHref(p.slug)}">${esc(p.title)}</a>${p.summary ? ` <span class="dim">— ${esc(p.summary)}</span>` : ""}</li>`).join("")}</ul>`;
    el.pagenav.innerHTML = ""; el.foot.innerHTML = ""; el.toc.innerHTML = "";
  }

  async function show(slug, anchor) {
    const page = flat.find((p) => p.slug === slug);
    if (!page) { renderMissing(slug); return; }
    if (current && current.slug === slug) {
      jump(anchor);
      return;
    }
    current = page;
    markActive(slug);
    el.crumb.textContent = page.title;
    document.title = `${page.title} · Wiki · ${S.appName}`;
    el.article.innerHTML = `<p class="dim"><span class="spinner" aria-hidden="true"></span>Loading ${esc(page.title)}…</p>`;
    try {
      const md = await getPage(page);
      if (current !== page) return; // navigated away while loading
      el.article.innerHTML = renderMarkdown(md);
      postProcess(page);
      buildToc(page);
      buildPageNav(page);
      buildFoot(page);
      jump(anchor, true);
    } catch (e) {
      el.article.innerHTML = `<h1>${esc(page.title)}</h1><div class="notice warn"><p>This page could not be loaded: ${esc(e.message)}.</p></div>`;
    }
    el.side.classList.remove("open");
    el.toggle.setAttribute("aria-expanded", "false");
  }

  function jump(anchor, fresh) {
    const go = () => {
      if (anchor) {
        const target = document.getElementById(anchor);
        if (target) { target.scrollIntoView({ block: "start", behavior: "instant" }); return true; }
      }
      if (fresh) window.scrollTo(0, 0);
      return false;
    };
    go();
    if (!anchor) return;
    // On a fresh navigation the document "load" event (which waits for the
    // CDN renderer script) can fire after the page rendered and cancel or
    // reset the scroll, so repeat the jump once everything has settled.
    requestAnimationFrame(() => setTimeout(go, 60));
    if (document.readyState !== "complete") window.addEventListener("load", () => setTimeout(go, 0), { once: true });
  }

  // ---------- search ----------
  let searchTimer = null;
  async function ensureIndex() {
    await Promise.all(flat.map((p) => getPage(p).catch(() => "")));
  }
  function stripMd(md) {
    return md
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
      .replace(/[#>*_`|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function runSearch(q) {
    const query = q.trim().toLowerCase();
    if (!query) { el.results.hidden = true; el.results.innerHTML = ""; el.sidenav.hidden = false; return; }
    const hits = [];
    flat.forEach((p) => {
      const text = stripMd(cache.get(p.slug) || "");
      const lower = text.toLowerCase();
      const inTitle = p.title.toLowerCase().includes(query);
      const at = lower.indexOf(query);
      if (!inTitle && at < 0) return;
      let snippet = "";
      if (at >= 0) {
        const start = Math.max(0, at - 60), end = Math.min(text.length, at + query.length + 80);
        snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
      } else if (p.summary) snippet = p.summary;
      let count = 0, idx = 0;
      while ((idx = lower.indexOf(query, idx)) >= 0 && count < 50) { count++; idx += query.length; }
      hits.push({ page: p, snippet, score: (inTitle ? 100 : 0) + count });
    });
    hits.sort((a, b) => b.score - a.score);
    const mark = (s) => esc(s).replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), (m) => `<mark>${m}</mark>`);
    el.results.innerHTML = hits.length
      ? hits.slice(0, 12).map((h) => `<a href="${pageHref(h.page.slug)}"><strong>${mark(h.page.title)}</strong><small>${h.snippet ? mark(h.snippet) : esc(h.page.section)}</small></a>`).join("")
      : `<div class="none">Nothing matches “${esc(q.trim())}”.</div>`;
    el.results.hidden = false;
    el.sidenav.hidden = true;
  }
  el.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = el.search.value;
    if (!q.trim()) { runSearch(""); return; }
    searchTimer = setTimeout(async () => { await ensureIndex(); runSearch(el.search.value); }, 160);
  });
  el.search.addEventListener("keydown", (e) => { if (e.key === "Escape") { el.search.value = ""; runSearch(""); } });
  el.results.addEventListener("click", () => { el.search.value = ""; runSearch(""); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); el.search.focus(); }
  });

  // ---------- mobile sidebar ----------
  el.toggle.addEventListener("click", () => {
    const open = el.side.classList.toggle("open");
    el.toggle.setAttribute("aria-expanded", String(open));
  });

  // ---------- boot ----------
  async function boot() {
    if (location.protocol === "file:") {
      showNotice(`<p><strong>The wiki needs to be served over HTTP.</strong> Browsers block <code>fetch()</code> for <code>file://</code> pages, so the markdown cannot load from disk. From the <code>website</code> folder run <code>python -m http.server 8080</code> (or <code>npx serve</code>) and open <code>http://localhost:8080/wiki/</code>. On GitHub Pages this just works.</p>`, "warn");
    }
    const [hasMarked] = await Promise.all([ensureMarked(), loadManifest().catch((e) => { throw e; })]);
    if (!hasMarked) showNotice(`<p>The markdown renderer could not be fetched from its CDN, so pages are shown as plain text. Check the network connection and reload.</p>`, "warn");
    buildSidebar();
    const route = parseHash();
    await show(route.slug, route.anchor);
    window.addEventListener("hashchange", () => { const r = parseHash(); show(r.slug, r.anchor); });
  }

  boot().catch((e) => {
    el.article.innerHTML = `<h1>The wiki could not start</h1><div class="notice warn"><p>${esc(e.message)}</p></div><p>If you opened this file directly from disk, serve the folder over HTTP instead (see the note above). Otherwise check that <code>wiki/pages.json</code> exists beside this page.</p>`;
    if (location.protocol !== "file:") hideNotice();
  });
})();
