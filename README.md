# Mefi Studio website

Public site: https://nateecho32-stack.github.io/mefi-studio/

GitHub Pages publishes the root of this repository's `gh-pages` branch. The `main` branch holds the Electron application. The site is plain HTML, CSS and JavaScript: no build step, no framework, no secrets.

## Pages

| Page | Files | What it is |
| --- | --- | --- |
| Home | `index.html`, `assets/home.css`, `assets/home.js`, `assets/demo.css`, `assets/demo.js` | Community first: what Studio is, a quick look, a few roadmap items, the Discord |
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

## Motion and themes

Decoration only: every page reads the same without it, and `prefers-reduced-motion` stops it.
- `assets/theme.js` (loaded from `<head>` so a saved choice paints first) holds Studio's twelve palettes, copied from `THEMES` in the app's `renderer/music.js`. It rewrites the colour tokens on `<html>`. Chrome, the site's own look (matte black and brushed metal, like Studio's Chrome theme), is applied by clearing them, so its values are the defaults in `site.css`. The pick is kept in `localStorage` (`mefiSite.theme.v1`), and `?theme=abyss` on any URL selects one.
- Every translucent colour in the CSS is written `rgb(var(--accent-rgb) / .2)` (also `--bg-rgb`, `--bg-2-rgb`, `--panel-rgb`, `--panel-2-rgb`, `--accent-2-rgb`, `--accent-3-rgb`) so it follows the theme. Don't hard-code a palette colour. The violet, gold and status colours stay fixed on purpose: badges use them as meaning.
- `assets/chrome.css`, on every page after `fx.css`: the Chrome finish. Every rule starts with `:root:not([data-theme])`, so it applies only while Chrome is the theme: matte panels (`--matte`, a diagonal gradient), brushed metal (`--metal`) on primary buttons and active tabs, chrome headlines (`--metal-text`, one band per line), a fine grain on the page and underlined links in running text. Over that sits an iridescent layer (`--holo`, `--holo-text`, `--holo-line`, `--holo-bar`, `--holo-edge`: silver-white, ice blue, lilac and pale aqua, the same values as Studio's `--chrome-holo` tokens): the haze and drifting blooms behind the page, the highlighted headline words, rims on cards and the metal buttons, hairlines between sections, the icon chips, the halo behind the hero window and the turning rim on a card under the cursor (`@property --holo-angle`, still with motion off). The tokens live in `site.css`.
- `assets/fx.css` and `assets/fx.js`, on every page: drifting background glows, the scroll progress bar, cards that light up under the cursor, button sheen, and the theme picker in the header.
- `assets/demo.css` and `assets/demo.js`, on Home only: the "works with" marquee, the animated Studio walkthrough (drawn in HTML and CSS, driven by `data-show`, `data-map` and `data-w` attributes per "beat"), the count-up numbers, and the theme section. That section swaps in the real `thumb-command-<theme>.webp` screenshots; themes without one keep the default theme's shot.

## Status labels

Every feature and roadmap item says where it stands. Keep the labels honest:
- Before a release: **In 0.4.4** (in the download today) and **Coming in 0.5** (built on `main`, ships with the next release). 0.4.5 and 0.4.6 were folded into 0.5.
- After it: **In Studio** (in the download) and **New in 0.5** (new in the latest release).
- **In progress** (with the release it's meant for, such as "In progress for 0.5"): being built now, not in a download yet.
- **Rolling out**: built, but it needs a part outside Studio to be live first (today, the Studio bot’s side of Reach this PC from Discord and of `/nowplaying`, which wait for the bot to be linked to the relay).
- **Planned**, and ideas with no date.

The download stays on the latest published release.

## Editing the roadmap

`assets/roadmap.json` holds every roadmap item; the comment field at the top of the file explains the fields. To move an item, change its status there. The roadmap page and its timeline read that file. The Home page shows a few items as plain HTML, so update them there too.

## Adding to the Made with Studio wall

`assets/showcase.json` is a list of projects; the field list is in a comment in `community.html`. Add a project by pull request, or share it in the Discord first, and add it only with the maker's OK. An empty list shows the "Be the first" card.

## Wiki pages

Add a markdown file under `wiki/pages/` and list it in `wiki/pages.json` (title, section and a one-line summary). Link between pages with `#/slug`. Mark what the next release adds with `<span class="status next">Coming in 0.5</span>` (it becomes `New in 0.5` once 0.5 is out), and work that isn't built yet with `<span class="status progress">In progress</span>` or `<span class="status planned">Planned</span>`. A mark inside a heading doesn't change that heading's link, so other pages' `#/page/heading` links keep working when a mark changes.

## Names and assets

- The public name is **Mefi Studio**. Keep `SITE.portableName` and the executable, launcher and release asset filenames unchanged: they identify the existing desktop build and its settings.
- Open Graph and Twitter metadata use `assets/studio-community-card.jpg` (1200×630). Its editable HTML/CSS source is beside it. Sharing services cache previews, so a new filename refreshes the image.
- Screenshots in `assets/shots/` use the real renderer with synthetic "Notes app" sample data (`tools/promo/prepare.cjs` on `main`). They contain no live user data.
- The earlier showreel and Discord post copy stay in `media/`.

## Checking a change

Preview with a loopback-only static server. Before pushing, check pages at 1440 and 390 px wide with no console errors, no missing files and no sideways scrolling.
