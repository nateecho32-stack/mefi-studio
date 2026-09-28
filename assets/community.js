/* Community page behaviour (community.html). Loaded after assets/site.js.
   1. Renders the Made with Studio wall from assets/showcase.json (the field
      list is documented in a comment in community.html). The static
      "Be the first" card stays when the file is empty or can't be read.
   2. In-page links to anything inside a tab (e.g. "Share your work" →
      #show-your-work) open that tab first, then scroll to it.
   3. Switching tabs from further down the page brings the tab bar back into
      view, and each panel ends with a link to the next one. */
(function () {
  "use strict";

  const S = window.SITE || {};
  const esc = S.escapeHtml || ((s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- 1. Made with Studio wall -------------------------------------------
  const text = (value, max) => {
    const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
  };
  // Only https links, and only screenshots stored with the site (no
  // third-party image requests).
  const httpsUrl = (value) => {
    if (typeof value !== "string") return "";
    try {
      const u = new URL(value.trim());
      return u.protocol === "https:" ? u.href : "";
    } catch { return ""; }
  };
  const localImage = (value) => (typeof value === "string" && /^assets\/showcase\/[a-z0-9][a-z0-9._-]*\.(webp|png|jpe?g|avif)$/i.test(value) && !value.includes("..") ? value : "");
  const isoDate = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");

  function normalise(raw) {
    if (!raw || typeof raw !== "object") return null;
    const item = {
      title: text(raw.title, 60),
      by: text(raw.by, 60),
      url: httpsUrl(raw.url),
      description: text(raw.description, 200),
      image: localImage(raw.image),
      alt: text(raw.alt, 180),
      tags: (Array.isArray(raw.tags) ? raw.tags : []).map((t) => text(t, 20)).filter(Boolean).slice(0, 4),
      source: httpsUrl(raw.source),
      thanks: text(raw.thanks, 80),
      added: isoDate(raw.added),
    };
    return item.title && item.by && item.url && item.description ? item : null;
  }

  function projectCard(item) {
    const el = document.createElement("article");
    el.className = "cm-project";
    const img = item.image
      ? `<img src="${esc(item.image)}" width="1200" height="750" loading="lazy" decoding="async" alt="${esc(item.alt || `Screenshot of ${item.title}`)}">`
      : "";
    const tags = item.tags.length ? `<ul class="cm-tags" aria-label="Tags">${item.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
    const thanks = item.thanks ? `<p class="cm-thanks">With thanks to ${esc(item.thanks)}</p>` : "";
    const source = item.source && item.source !== item.url ? `<a href="${esc(item.source)}" rel="noopener nofollow">Source <span aria-hidden="true">↗</span></a>` : "";
    el.innerHTML = `${img}<div class="cm-project-body">
      <h4><a href="${esc(item.url)}" rel="noopener nofollow">${esc(item.title)}</a></h4>
      <p class="cm-by">by ${esc(item.by)}</p>
      <p>${esc(item.description)}</p>
      ${thanks}${tags}
      <p class="cm-project-links"><a href="${esc(item.url)}" rel="noopener nofollow" aria-label="Open ${esc(item.title)}">Open <span aria-hidden="true">↗</span></a>${source}</p>
    </div>`;
    return el;
  }

  function renderWall() {
    const wall = document.querySelector("[data-showcase]");
    if (!wall || !window.fetch) return;
    const first = wall.querySelector("[data-showcase-first]");
    const count = document.querySelector("[data-showcase-count]");
    fetch(wall.dataset.showcase || "assets/showcase.json", { cache: "no-cache" })
      .then((res) => { if (!res.ok) throw new Error(`showcase.json answered ${res.status}`); return res.json(); })
      .then((list) => {
        const items = (Array.isArray(list) ? list : []).map(normalise).filter(Boolean);
        items.sort((a, b) => b.added.localeCompare(a.added));
        if (!items.length) return;
        const frag = document.createDocumentFragment();
        items.forEach((item) => frag.append(projectCard(item)));
        wall.insertBefore(frag, first);
        if (first) {
          const title = first.querySelector("[data-first-title]");
          const body = first.querySelector("[data-first-text]");
          if (title) title.textContent = "Add yours";
          if (body) body.textContent = "Made something with Studio? Add it with a pull request, or share it in the Discord first.";
        }
        if (count) count.textContent = `${items.length === 1 ? "One project" : `${items.length.toLocaleString()} projects`} so far.`;
      })
      .catch(() => { /* keep the static "Be the first" card */ });
  }

  // ---- 2 and 3. Tabs ---------------------------------------------------------
  const tabFor = (panel) => document.getElementById(`${panel.id}-tab`);

  function openTarget(hash, smooth) {
    if (!hash || hash.length < 2) return false;
    let target = null;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return false; }
    const panel = target && target.closest(".tabset.is-tabs > [role='tabpanel']");
    if (!panel) return false;
    const tab = tabFor(panel);
    if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
    // A whole panel scrolls to the tab bar above it; anything inside scrolls to itself.
    const to = target === panel ? panel.closest(".tabset") : target;
    if (target instanceof HTMLDetailsElement) target.open = true;
    to.scrollIntoView({ behavior: smooth && !still() ? "smooth" : "auto", block: "start" });
    return true;
  }

  function initTabs() {
    document.querySelectorAll(".cm-tabset.is-tabs").forEach((set) => {
      const panels = [...set.querySelectorAll(":scope > [role='tabpanel']")];
      // A "Next" link at the foot of every panel but the last.
      panels.slice(0, -1).forEach((panel, i) => {
        const next = panels[i + 1];
        const p = document.createElement("p");
        p.className = "cm-next";
        p.innerHTML = `<a href="#${esc(next.id)}">Next: ${esc(next.dataset.tabLabel || "")} <span aria-hidden="true">→</span></a>`;
        panel.append(p);
      });
      // Changing tab from far down the page brings the tab bar back into view.
      const list = set.querySelector(":scope > [role='tablist']");
      if (list) {
        list.addEventListener("click", (e) => {
          if (!e.target.closest("[role='tab']")) return;
          if (set.getBoundingClientRect().top < 0) set.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" });
        });
      }
    });

    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest("a[href^='#']");
      if (!a) return;
      const hash = a.getAttribute("href");
      if (openTarget(hash, true)) {
        e.preventDefault();
        if (history.replaceState) history.replaceState(null, "", hash);
      }
    });
    window.addEventListener("hashchange", () => openTarget(location.hash, false));
    // site.js opens the right tab for a deep link on load; also reveal a
    // target that sits inside a panel (e.g. #showcase-fields).
    if (location.hash.length > 1) requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target instanceof HTMLDetailsElement) target.open = true;
    });
  }

  function start() {
    renderWall();
    initTabs();
  }
  // site.js builds the tabs on DOMContentLoaded; this file loads after it, so
  // its listener runs second.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
