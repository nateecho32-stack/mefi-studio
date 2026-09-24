# About this wiki

This wiki is a folder of markdown files rendered in your browser. There is no build step, no database and no account: the site is static and lives in its own repository, [nateecho32-stack/mefi-studio](https://github.com/nateecho32-stack/mefi-studio), published with GitHub Pages.

## Where things are

```text
index.html          landing page
download.html       latest release (read live from the GitHub API), install steps
community.html      where to ask, report and contribute
404.html            served by GitHub Pages for unknown paths
assets/
  site.css          the one stylesheet
  site.js           shared config (repository names) and helpers
  wiki.js           the wiki renderer: sidebar, routing, search, table of contents
  screens/          screenshots, taken from seeded sample data
wiki/
  index.html        the wiki shell
  pages.json        the list of pages and sections (the sidebar)
  pages/*.md        one markdown file per page
```

Routing uses the address hash: `wiki/#/installation` opens `pages/installation.md`, and `wiki/#/installation/from-source` scrolls to that heading.

## Editing a page

Every page ends with **Edit this page on GitHub**. It opens the file in GitHub's editor; save, and GitHub offers to fork the repository and open a pull request for you.

## Adding a page

1. Create `wiki/pages/<slug>.md`. Start with a single `#` title; the sidebar title comes from `pages.json`.
2. Add the page to `wiki/pages.json` under the right section, with a `slug`, a `title` and a one-line `summary` that search and the not-found list use.
3. Link to it from a related page with a relative markdown link: `[Installation](installation.md)`. Links ending in `.md` become wiki routes, and `installation.md#from-source` links to a heading.
4. Put images in `assets/screens/` and reference them as `../../assets/screens/name.webp`, so they also work when the file is read on GitHub.

Search indexes every page's text on the first query, so nothing else needs updating.

## Writing guidelines

- Describe what Studio does today. When unsure, check [docs/architecture.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/architecture.md) and the [CHANGELOG](https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md).
- Say when something is in source but not yet in a release, as the other pages do.
- Use the names Studio shows on screen, in bold: **Give a task**, **Verify first**, **Live work**, **Awaiting verification**.
- Show the exact command or control, then say what happens next.
- Keep provider prices and quotas out of pages; they change faster than docs.
- Screenshots come from seeded sample data, never from a real project. Never paste keys, `settings.json`, `auth.json` or paths from your machine.
- The repository docs win. If a page and the README disagree, fix the page.

## Previewing locally

Browsers block `fetch()` for `file://` pages, so the wiki needs a local HTTP server. From a clone of the site repository:

```powershell
python -m http.server 8080
# then open http://localhost:8080/
```

`npx serve` works too. The landing, download and community pages open fine straight from disk; only the wiki needs the server.

## Hosting

The site's `README.md` covers how it is published and the alternatives: GitHub Pages from its own repository (the current setup), a `gh-pages` branch, GitHub Actions, or a static host such as Netlify or Cloudflare Pages, plus how to attach a custom domain.
