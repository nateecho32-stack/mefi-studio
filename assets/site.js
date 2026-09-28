/* Mefi's Studio AI+ website — shared script. No build step, no framework.
   Edit the SITE block to point the site at a different repository. */
(function () {
  "use strict";

  const SITE = {
    appName: "Mefi Studio",
    // The application repository (releases, issues, source).
    repo: "nateecho32-stack/mefi-studio",
    // The repository that hosts THIS website. When set, every wiki page gets
    // an "Edit this page on GitHub" link. Leave empty to offer "Suggest a
    // change" (a prefilled issue on the app repository) instead.
    siteRepo: "nateecho32-stack/mefi-studio",
    siteBranch: "gh-pages",
    // Folder inside siteRepo that holds index.html ("" for the repo root,
    // "docs" when the site is published from a docs/ folder).
    siteRoot: "",
    // Must match scripts/release-updater.mjs in the app repository.
    portableName: "Mefi Studio AI+",
    platform: "win32",
    arch: "x64",
  };

  const blob = (file) => `https://github.com/${SITE.repo}/blob/main/${file}`;
  SITE.urls = {
    repo: `https://github.com/${SITE.repo}`,
    releases: `https://github.com/${SITE.repo}/releases`,
    latest: `https://github.com/${SITE.repo}/releases/latest`,
    issues: `https://github.com/${SITE.repo}/issues`,
    discussions: `https://github.com/${SITE.repo}/discussions`,
    bugReport: `https://github.com/${SITE.repo}/issues/new?template=bug_report.md`,
    featureRequest: `https://github.com/${SITE.repo}/issues/new?template=feature_request.md`,
    contributing: blob("CONTRIBUTING.md"),
    security: blob("SECURITY.md"),
    changelog: blob("CHANGELOG.md"),
    gettingStarted: blob("GETTING_STARTED.md"),
    architecture: blob("docs/architecture.md"),
    siteRepo: SITE.siteRepo ? `https://github.com/${SITE.siteRepo}` : "",
    api: `https://api.github.com/repos/${SITE.repo}`,
    newIssue(title, body) {
      const q = new URLSearchParams();
      if (title) q.set("title", title);
      if (body) q.set("body", body);
      return `https://github.com/${SITE.repo}/issues/new?${q.toString()}`;
    },
  };

  // Mirrors releaseAssetName() in the app's scripts/release-updater.mjs.
  SITE.releaseAssetName = function (version) {
    const clean = String(version || "").trim().replace(/^v/i, "");
    return `${SITE.portableName.replace(/\s+/g, "-")}-v${clean}-${SITE.platform}-${SITE.arch}.zip`;
  };

  // Reads releases/latest from the GitHub API. Resolves to { none: true } when
  // the repository has no published release yet; rejects on network errors.
  let latestPromise = null;
  SITE.fetchLatestRelease = function () {
    if (latestPromise) return latestPromise;
    latestPromise = fetch(`${SITE.urls.api}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    }).then(async (res) => {
      if (res.status === 404) return { none: true };
      if (!res.ok) throw new Error(`GitHub API answered ${res.status}`);
      const r = await res.json();
      const assets = Array.isArray(r.assets) ? r.assets : [];
      const wanted = SITE.releaseAssetName(r.tag_name || r.name || "").toLowerCase();
      const zips = assets.filter((a) => typeof a.name === "string" && /\.zip$/i.test(a.name));
      const asset = zips.find((a) => a.name.toLowerCase() === wanted) || zips[0] || null;
      const checksum = asset
        ? assets.find((a) => typeof a.name === "string" && a.name.toLowerCase() === `${asset.name.toLowerCase()}.sha256`) || null
        : null;
      return {
        none: false,
        tag: r.tag_name || "",
        name: r.name || r.tag_name || "",
        publishedAt: r.published_at || null,
        htmlUrl: r.html_url || SITE.urls.latest,
        body: r.body || "",
        prerelease: Boolean(r.prerelease),
        asset,
        checksum,
      };
    });
    latestPromise.catch(() => { latestPromise = null; });
    return latestPromise;
  };

  // Repository facts the community page adapts to (Discussions on or off).
  let repoPromise = null;
  SITE.fetchRepo = function () {
    if (repoPromise) return repoPromise;
    repoPromise = fetch(SITE.urls.api, { headers: { Accept: "application/vnd.github+json" } })
      .then((res) => { if (!res.ok) throw new Error(`GitHub API answered ${res.status}`); return res.json(); });
    repoPromise.catch(() => { repoPromise = null; });
    return repoPromise;
  };

  SITE.formatBytes = function (n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB"];
    let i = -1;
    do { n /= 1024; i += 1; } while (n >= 1024 && i < units.length - 1);
    return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
  };

  SITE.formatDate = function (iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  };

  SITE.escapeHtml = function (s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  };

  // The community's own places. Discord is the easiest way in, never a requirement.
  SITE.discord = {
    invite: "https://discord.gg/xgfKc5pVxG",
    code: "xgfKc5pVxG",
  };
  SITE.urls.discord = SITE.discord.invite;
  SITE.urls.enhancements = `https://github.com/${SITE.repo}/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc`;

  // Live member and online counts from the invite (counts only; the server
  // widget, which would publish names, stays off). Rejects on any failure.
  let pulsePromise = null;
  SITE.fetchDiscordCounts = function () {
    if (pulsePromise) return pulsePromise;
    pulsePromise = fetch(`https://discord.com/api/v10/invites/${SITE.discord.code}?with_counts=true`)
      .then((res) => { if (!res.ok) throw new Error(`Discord answered ${res.status}`); return res.json(); })
      .then((data) => {
        const members = Number(data.approximate_member_count), online = Number(data.approximate_presence_count);
        if (!Number.isFinite(members) || members <= 0) throw new Error("no counts");
        return { members, online: Number.isFinite(online) ? online : null };
      });
    pulsePromise.catch(() => { pulsePromise = null; });
    return pulsePromise;
  };

  // Open feature requests, most 👍 first (the vote count is GitHub's own
  // reactions). Unauthenticated GitHub API: 60 requests an hour per visitor.
  SITE.fetchFeatureRequests = function (limit = 8) {
    const q = encodeURIComponent(`repo:${SITE.repo} is:issue is:open label:enhancement`);
    return fetch(`https://api.github.com/search/issues?q=${q}&sort=reactions-%2B1&order=desc&per_page=${limit}`, { headers: { Accept: "application/vnd.github+json" } })
      .then((res) => { if (!res.ok) throw new Error(`GitHub API answered ${res.status}`); return res.json(); })
      .then((data) => (Array.isArray(data.items) ? data.items : []).map((issue) => ({
        title: issue.title, url: issue.html_url, number: issue.number,
        votes: Number(issue.reactions?.["+1"]) || 0, comments: Number(issue.comments) || 0, created: issue.created_at,
      })));
  };

  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  SITE.plural = plural;

  window.SITE = SITE;

  // ---- behaviours every page shares ---------------------------------------
  function initMenu() {
    // The phone menu is a <details>: close it on Escape, on an outside click
    // and when one of its links is followed.
    document.querySelectorAll("details.menu").forEach((menu) => {
      const close = () => { if (menu.open) menu.open = false; };
      document.addEventListener("click", (e) => { if (!menu.contains(e.target)) close(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.open) { close(); menu.querySelector("summary")?.focus(); } });
      menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
    });
  }

  function initPulse() {
    const pulses = document.querySelectorAll("[data-discord-pulse]");
    if (!pulses.length) return;
    SITE.fetchDiscordCounts().then(({ members, online }) => {
      pulses.forEach((el) => {
        const text = online != null ? `<b>${plural(members, "member", "members")}</b> · ${online.toLocaleString()} online now` : `<b>${plural(members, "member", "members")}</b> in the Discord`;
        const slot = el.querySelector("[data-pulse-text]") || el;
        slot.innerHTML = text;
        el.hidden = false;
      });
    }).catch(() => { pulses.forEach((el) => { el.hidden = true; }); });
  }

  // Grouped sections become tabs: <div class="tabset" data-tabs="Label"> holding
  // <section data-tab-label="Name" id="…">. Without script they simply stack.
  function initTabsets() {
    document.querySelectorAll("[data-tabs]").forEach((set, setIndex) => {
      const panels = [...set.querySelectorAll(":scope > [data-tab-label]")];
      if (panels.length < 2) return;
      const list = document.createElement("div");
      list.setAttribute("role", "tablist");
      list.setAttribute("aria-label", set.dataset.tabs || "Sections");
      list.className = "chips";
      const tabs = panels.map((panel, i) => {
        if (!panel.id) panel.id = `tabpanel-${setIndex}-${i}`;
        const tab = document.createElement("button");
        tab.type = "button"; tab.className = "chip"; tab.id = `${panel.id}-tab`;
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", panel.id);
        tab.textContent = panel.dataset.tabLabel;
        panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", tab.id); panel.tabIndex = 0;
        list.append(tab);
        return tab;
      });
      const select = (index, focus) => {
        tabs.forEach((tab, i) => {
          const on = i === index;
          tab.setAttribute("aria-selected", String(on)); tab.setAttribute("aria-pressed", String(on)); tab.tabIndex = on ? 0 : -1;
          panels[i].hidden = !on;
        });
        if (focus) tabs[index].focus();
      };
      list.addEventListener("keydown", (e) => {
        const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
        const next = e.key === "ArrowRight" ? (current + 1) % tabs.length : e.key === "ArrowLeft" ? (current - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
        if (next >= 0) { e.preventDefault(); select(next, true); }
      });
      tabs.forEach((tab, i) => tab.addEventListener("click", () => {
        select(i, false);
        if (history.replaceState) history.replaceState(null, "", `#${panels[i].id}`);
      }));
      set.prepend(list);
      set.classList.add("is-tabs");
      // A link to a panel, or to anything inside one, opens that tab.
      let fromHash = -1;
      if (location.hash.length > 1) {
        const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        fromHash = target ? panels.findIndex((panel) => panel === target || panel.contains(target)) : -1;
      }
      select(fromHash >= 0 ? fromHash : 0, false);
    });
  }

  function initReveal() {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = document.querySelectorAll("[data-reveal]");
    if (still || !targets.length || !("IntersectionObserver" in window)) return;
    document.documentElement.classList.add("js-reveal");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    targets.forEach((el, i) => { el.style.transitionDelay = `${(i % 3) * 70}ms`; io.observe(el); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMenu();
    initPulse();
    initTabsets();
    initReveal();

    // Footer year.
    document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = String(new Date().getFullYear()); });

    // Any element with data-repo-link="key" becomes a link into SITE.urls.
    document.querySelectorAll("[data-repo-link]").forEach((el) => {
      const url = SITE.urls[el.dataset.repoLink];
      if (typeof url === "string" && url) el.setAttribute("href", url);
    });

    // Small "latest release" hints (landing page hero, footer badges).
    const hints = document.querySelectorAll("[data-latest-hint]");
    if (hints.length) {
      SITE.fetchLatestRelease().then((rel) => {
        hints.forEach((el) => {
          if (rel.none) {
            el.innerHTML = `No public release yet — <a href="${el.dataset.sourceHref || "wiki/#/installation"}">build from source</a>.`;
          } else {
            const size = rel.asset ? ` · ${SITE.formatBytes(rel.asset.size)} zip` : "";
            el.innerHTML = `Latest release: <a href="${SITE.escapeHtml(rel.htmlUrl)}">${SITE.escapeHtml(rel.tag)}</a>${rel.publishedAt ? ` · ${SITE.formatDate(rel.publishedAt)}` : ""}${size}`;
          }
        });
      }).catch(() => {
        hints.forEach((el) => { el.innerHTML = `See <a href="${SITE.urls.releases}">releases on GitHub</a>.`; });
      });
    }
  });
})();
