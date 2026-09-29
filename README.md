# Mefi Studio website

Public site: https://nateecho32-stack.github.io/mefi-studio/

GitHub Pages publishes the root of this repository's `gh-pages` branch. The `main` branch holds the Electron application. The site is plain HTML, CSS and JavaScript: no build step, no framework, no secrets.

## Pages

| Page | Files | What it is |
| --- | --- | --- |
| Home | `index.html`, `assets/home.css`, `assets/home.js` | Community first: what Studio is, a quick look, a few roadmap items, the Discord |
| Features | `features.html`, `assets/features.css`, `assets/features.js` | Everything in Studio, by area, with a badge on each feature |
| Roadmap | `roadmap.html`, `assets/roadmap.css`, `assets/roadmap.js`, `assets/roadmap.json` | Done (with the release timeline), being worked on, and planned, plus ways to ask for something |
| Community | `community.html`, `assets/community.css`, `assets/community.js`, `assets/showcase.json` | Ways in, the live Discord count, the Made with Studio wall, how to help |
| Download | `download.html`, `assets/download.css` | The latest release (read live from GitHub, with static links as a fallback), install steps, updating, checking the download, running from source |
| Wiki | `wiki/index.html`, `wiki/pages.json`, `wiki/pages/*.md`, `assets/wiki.js`, `assets/wiki.css` | The guide. `pages.json` controls the navigation and search descriptions; each page is a markdown file |
| 404 | `404.html` | Uses absolute `/mefi-studio/` paths, because GitHub Pages serves it for any missing path |

`assets/site.css` and `assets/site.js` are the shared design system:
- the tab bar and phone menu;
- page transitions (`@view-transition`);
- status badges and buttons;
- the roadmap board and timeline styles;
- the live Discord member count;
- the `SITE` helpers: release lookup, feature requests by 👍, and links.

Every page uses the same header and footer markup.

## Status labels

Every feature and roadmap item says where it stands. Keep the labels honest:
- **In 0.4.4**: in the latest release.
- **Coming in 0.4.5**: built on `main`, not released yet.
- **In progress**: being built now.
- **Rolling out**: built, but it needs the community rooms hub and the Discord link to be online.
- **Planned**, and ideas with no date.

The download stays on the latest published release.

## Editing the roadmap

`assets/roadmap.json` holds every roadmap item; the comment field at the top of the file explains the fields. To move an item, change its status there. The page, the Home preview and the timeline all read the same file, so no HTML changes are needed.

## Adding to the Made with Studio wall

`assets/showcase.json` is a list of projects; the field list is in a comment in `community.html`. Add a project by pull request, or share it in the Discord first, and add it only with the maker's OK. An empty list shows the "Be the first" card.

## Wiki pages

Add a markdown file under `wiki/pages/` and list it in `wiki/pages.json` (title, section and a one-line summary). Link between pages with `#/slug`. Mark behaviour that isn't released yet with `<span class="status next">Coming in 0.4.5</span>`.

## Names and assets

- The public name is **Mefi Studio**. Keep `SITE.portableName` and the executable, launcher and release asset filenames unchanged: they identify the existing desktop build and its settings.
- Open Graph and Twitter metadata use `assets/studio-community-card.jpg` (1200×630). Its editable HTML/CSS source is beside it. Sharing services cache previews, so a new filename refreshes the image.
- Screenshots in `assets/shots/` use the real renderer with synthetic "Notes app" sample data (`tools/promo/prepare.cjs` on `main`). They contain no live user data.
- The earlier showreel and Discord post copy stay in `media/`.

## Checking a change

Preview with a loopback-only static server. Before pushing, check pages at 1440 and 390 px wide with no console errors, no missing files and no sideways scrolling.
