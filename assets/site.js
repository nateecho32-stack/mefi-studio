/* Mefi's Studio AI+ website — shared script. No build step, no framework.
   Edit the SITE block to point the site at a different repository. */
(function () {
  "use strict";

  const SITE = {
    appName: "Mefi's Studio AI+",
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

  window.SITE = SITE;

  document.addEventListener("DOMContentLoaded", () => {
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
