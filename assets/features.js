/* Features page: search, status filters and the sticky area chips.
   Every feature is plain HTML in features.html; this script only filters it.
   Without script everything stays visible and the area chips are plain links.
   The counts are recounted from the page, so editing the HTML keeps them true. */
(function () {
  "use strict";

  const WORDS = { released: "in 0.4.4", next: "coming in 0.5", rolling: "rolling out", experimental: "experimental" };

  const norm = (s) => String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, " ").trim();

  function init() {
    const items = Array.from(document.querySelectorAll(".feat"));
    const areas = Array.from(document.querySelectorAll("[data-area]"));
    if (!items.length) return;

    // Recount from the list itself.
    const counts = { all: items.length };
    items.forEach((li) => { counts[li.dataset.status] = (counts[li.dataset.status] || 0) + 1; });
    document.querySelectorAll("[data-count]").forEach((el) => { el.textContent = String(counts[el.dataset.count] || 0); });

    const jumpItems = new Map();
    document.querySelectorAll("[data-jump]").forEach((a) => jumpItems.set(a.dataset.jump, a));

    const perAreaTotal = new Map();
    areas.forEach((area) => {
      const n = area.querySelectorAll(".feat").length;
      perAreaTotal.set(area, n);
      area.dataset.total = String(n);
      const chip = jumpItems.get(area.id);
      const count = chip && chip.querySelector("[data-jump-count]");
      if (count) count.textContent = String(n);
      const meta = area.querySelector("[data-area-count]");
      if (meta) meta.dataset.default = meta.textContent;
    });

    const index = items.map((li) => ({
      li,
      area: li.closest("[data-area]"),
      text: norm(li.textContent + " " + (li.closest("[data-area]")?.querySelector("h2")?.textContent || "")),
    }));

    initFilters(index, areas, perAreaTotal, jumpItems, counts);
    initScrollSpy(areas, jumpItems);
  }

  function initFilters(index, areas, perAreaTotal, jumpItems, counts) {
    const tools = document.querySelector("[data-feat-tools]");
    if (!tools) return;
    const input = tools.querySelector("input[type='search']");
    const chips = Array.from(tools.querySelectorAll("[data-filter]"));
    const result = tools.querySelector("[data-result]");
    const none = document.querySelector("[data-none]");
    tools.hidden = false;

    let status = "all";
    let query = "";

    // Deep links: features.html?status=next or ?q=rooms
    try {
      const params = new URLSearchParams(location.search);
      const s = params.get("status");
      if (s && (s === "all" || WORDS[s])) status = s;
      const q = params.get("q");
      if (q) { query = q; input.value = q; }
    } catch (e) { /* ignore */ }

    let announceTimer = 0;
    function announce(text) {
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => { result.textContent = text; }, 250);
    }

    function apply(fromUser) {
      const words = norm(query).split(" ").filter(Boolean);
      const filtering = status !== "all" || words.length > 0;
      const shownPerArea = new Map();
      let shown = 0;
      for (const it of index) {
        const ok = (status === "all" || it.li.dataset.status === status) && words.every((w) => it.text.includes(w));
        it.li.hidden = !ok;
        if (ok) { shown += 1; shownPerArea.set(it.area, (shownPerArea.get(it.area) || 0) + 1); }
      }
      for (const area of areas) {
        const n = shownPerArea.get(area) || 0;
        const total = perAreaTotal.get(area) || 0;
        area.hidden = n === 0;
        const meta = area.querySelector("[data-area-count]");
        if (meta) meta.textContent = filtering ? `${n} of ${total} features shown` : meta.dataset.default;
        const chip = jumpItems.get(area.id);
        if (chip) {
          chip.parentElement.hidden = n === 0;
          const c = chip.querySelector("[data-jump-count]");
          if (c) c.textContent = String(filtering ? n : total);
        }
      }
      chips.forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.filter === status)));
      if (none) none.hidden = shown > 0;

      let text;
      if (!filtering) text = `Showing all ${counts.all} features.`;
      else {
        text = `Showing ${shown} of ${counts.all} features`;
        if (status !== "all") text += ` ${WORDS[status]}`;
        if (words.length) text += ` matching “${query.trim()}”`;
        text += ".";
      }
      if (fromUser) announce(text); else result.textContent = text;

      if (fromUser && history.replaceState) {
        try {
          const url = new URL(location.href);
          if (query.trim()) url.searchParams.set("q", query.trim()); else url.searchParams.delete("q");
          if (status !== "all") url.searchParams.set("status", status); else url.searchParams.delete("status");
          history.replaceState(null, "", url.pathname + url.search + url.hash);
        } catch (e) { /* ignore */ }
      }
    }

    let inputTimer = 0;
    input.addEventListener("input", () => {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => { query = input.value; apply(true); }, 120);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; query = ""; apply(true); }
    });
    chips.forEach((chip) => chip.addEventListener("click", () => { status = chip.dataset.filter; apply(true); }));
    document.querySelectorAll("[data-clear]").forEach((btn) => btn.addEventListener("click", () => {
      status = "all"; query = ""; input.value = ""; apply(true); input.focus();
    }));

    apply(false);
  }

  // Marks the area chip for the section being read and keeps it in view.
  function initScrollSpy(areas, jumpItems) {
    if (!("IntersectionObserver" in window) || !areas.length) return;
    const row = document.querySelector(".jump-list");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const visible = new Set();
    let current = null;

    function mark(id) {
      if (id === current) return;
      current = id;
      jumpItems.forEach((a, key) => {
        if (key === id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
      });
      const chip = id && jumpItems.get(id);
      if (chip && row && row.scrollWidth > row.clientWidth) {
        const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
        row.scrollTo({ left: Math.max(0, left), behavior: still ? "auto" : "smooth" });
      }
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
      const first = areas.find((a) => visible.has(a) && !a.hidden);
      mark(first ? first.id : null);
    }, { rootMargin: "-140px 0px -55% 0px", threshold: 0 });
    areas.forEach((a) => io.observe(a));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
