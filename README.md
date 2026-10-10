# Vibe Studio website

Public site: https://nateecho32-stack.github.io/mefi-studio/

GitHub Pages publishes the root of this repository's `gh-pages` branch. The `main` branch holds the Electron application. The site is plain HTML, CSS and JavaScript: no build step, no framework, no secrets.

## Pages

| Page | Files | What it is |
| --- | --- | --- |
| Home | `index.html`, `assets/home.css`, `assets/home.js`, `assets/play.css`, `assets/play.js`, `assets/orb.js` | Studio as the social app for vibe coders, kept short: the gate (Try the demo or Skip to the site), the guided demo, a room playing a made-up evening (with the Lobby in its points), how Studio works with the AI you already use, how a build goes, why together, the weekly Build Jam, the real screens, the builder's tools (with the twelve looks as a card) and the download (with the trust points) |
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

## Home: the gate, the demo and the orb

- **The gate** (`index.html` `#gate`, styled in `home.css`, run by `home.js`) is optional: **Try the demo** or **Skip to the site**. A small script in `<head>` decides before the first paint: only `?intro=1` shows it. The normal entry opens the launch page, with the demo available from its buttons. Without script, or if `home.js` never starts, the gate steps aside by itself after eight seconds. Skip opens the page through a circle from the button and the orb flies into the hero.
- **Try the demo** (`assets/play.js`, `assets/play.css`, `window.MefiPlay.open`) is a playable, made-up copy of Social mode that fills the screen and opens out of the orb. It is guided from start to end. A **Guided demo** banner under its top bar says what it is (made-up friends and projects, press the glowing button or wait), and a press anywhere else explains it again in a line at the bottom. The visitor picks one of six ready-made projects (`IDEAS`: a game-night page, a tiny arcade game, a band's site, a pixel art tool, a study timer and a plant tracker; the box types the pick and can't be typed in, so every build makes sense) and presses Send (Social's one box, as in the app), Mefi answers in a line under it; three builders work while friends chat; one asks a question, and the answer changes what gets built; the checks pass; Accept (or Revert, then bring them back); the finished site opens in a preview window over the board and works (an RSVP with confetti, Star Catch to play with the mouse, a finger or the arrow keys, a song list, a pixel canvas that saves a real PNG, a focus timer that runs a minute a second, plants to water); put it on the Project hub and the friends in the room react. Only what the current step asks for can be pressed (a capture-phase click guard; anything else bounces the hint), and every step plays itself after a quiet while (`waitClick`). The explaining waits for the end card, whose "Try another project" starts again in the same window with the finished ones marked Built. Skip and Escape always leave, and nothing is sent anywhere. The hero's and the room section's "Try the demo" buttons and the walkthrough's "Play it yourself" open it again, without the gate. When the visitor built something, the last call names it ("Ready to build your game-night page for real?", `sessionStorage` `mefiSite.idea.v1`).
- **The orb** (`assets/orb.js`, `window.MefiOrb.mount`) is Studio's companion as a liquid chrome sphere with four friends' orbs that melt into it and part again: one small ray-marched WebGL shader, lit by soft boxes in the theme's colours (it follows the picker), drawn only while on screen and the tab is visible, with fewer pixels on a slow GPU, one still frame under reduced motion and a CSS pearl without WebGL. `hold()` pauses it while the demo covers it. The hero's name chips follow the friends' orbs (`friend(i)` gives their place on the page).
- `assets/og-site.html` is the source of the link preview `assets/shots/vibe-launch.jpg` (1200x630): open it at that size, wait for the orb and capture it. Sharing services cache previews, so a new picture needs a new file name.

## Motion and themes

Decoration only: every page reads the same without it, and `prefers-reduced-motion` stops it (the gate and the demo still work, without the movement).
- `assets/theme.js` (loaded from `<head>` so a saved choice paints first) holds Studio's twelve palettes, copied from `THEMES` in the app's `renderer/music.js`. It rewrites the colour tokens on `<html>` and sets `<html class="motion">` when motion is allowed. Vibe, the public lime-and-mint look, is applied by clearing the tokens; `assets/vibe.css` loads last on every page. The internal `chrome` palette key is retained for existing saved preferences. The pick is kept in `localStorage` (`mefiSite.theme.v1`), and `?theme=abyss` on any URL selects one.
- Every translucent colour in the CSS is written `rgb(var(--accent-rgb) / .2)` (also `--bg-rgb`, `--bg-2-rgb`, `--panel-rgb`, `--panel-2-rgb`, `--accent-2-rgb`, `--accent-3-rgb`) so it follows the theme. Don't hard-code a palette colour. The violet, gold and status colours stay fixed on purpose: badges use them as meaning.
- `assets/site.css` is the look of every page: glass surfaces with a lit edge, the floating header, the type scale, a wide layout (`--max` 1640px, fluid `--gutter`) and a fine grain (plain blending, so canvases and pictures show no box).
- `assets/chrome.css`, on every page after `fx.css`: the Chrome finish. Every rule starts with `:root:not([data-theme])`: brushed metal (`--metal`) on the main buttons, an iridescent gradient (`--grad`, silver-white, ice blue, lilac and pale aqua, Studio's `--chrome-holo` values) on the highlighted words, and a turning iridescent rim on cards under the cursor (`@property --holo-angle`). Headlines stay solid text so the words that rise one by one keep their colour.
- `assets/fx.css` and `assets/fx.js`, on every page: the light drifting behind the page, the header's scrolled state, the scroll bar, headlines that rise word by word (`[data-split]`; `[data-split-manual]` waits for its page), reveals (`[data-reveal]`, `="iris"` opens a window through a circle, `[data-stagger]` steps a group), section labels that light up like a node on the Map, a glint on gradient words, count-ups, parallax (`[data-parallax]`) and scroll scenes (`[data-scene]`, `="pin"` for a pinned stage; both send a `scene` event with `p` from 0 to 1), the magnetic main button, tilting windows, the cursor's light on cards and the theme picker, whose switch spreads out from the click (View Transitions).
- `assets/home.css` and `assets/home.js`, on Home only: the gate, the hero, the room (`room()`: a made-up evening in a hangout played on a loop while on screen, with the room's real parts only: plain-text chat with @mentions, Listen together, your own build beside the chat as on Social's Home, and a pop-up when a friend plays your project; no cards are posted into rooms, and there is no voice or DMs), the "works with your AI" section and its marquee, the "why together" cards, the window of real screens (auto-advancing tabs), rolling words in two headlines (`rotators()`: a `.rot` with `data-rot="a|b|c"` rolls to its next word every 2.6 s while on screen; each line of such a headline is its own block, so a word changing width never re-wraps it, and on phones the keep headline puts each rolling phrase on its own line; the last call's list starts with what the visitor built in the demo), the pinned walkthrough (an HTML copy of the app whose beat follows the scroll), Studio's animated cards (the Map, Changes, the Inbox, Skills and Connectors, and the twelve looks, whose swatches dress the page), this week's Build Jam theme and the co-work hours (worked out the way the relay does, `relay/src/events.mjs`, with no request) and the last call.
- Screens in `assets/shots/site/` (1920 and 960 wide) come from the app's real-renderer test fixtures on `main` with made-up people and projects. Social proof on the page is only ever real: the live Discord count and the latest release. No made-up user numbers, reviews or quotes; a quote from a real person goes in with their OK.

## Status labels

Every feature and roadmap item says where it stands. Keep the labels honest:
- Before a release: **In 0.4.4** (in the download today) and **Coming in 0.5** (built on `main`, ships with the next release). 0.4.5 and 0.4.6 were folded into 0.5.
- After it: **In Studio** (in the download) and **New in 0.5** (new in the latest release).
- **In progress** (with the release it's meant for, such as "In progress for 0.5"): being built now, not in a download yet.
- **Rolling out**: built, but it needs a part outside Studio to be live first (today, the Studio bot’s side of Reach this PC from Discord and of `/nowplaying`, which wait for the bot to be linked to the relay).
- **Planned**, and ideas with no date.

The download stays on the latest published release.

Copy meant only for before a release, or only for after it, carries `data-until="0.5"` or `data-from="0.5"` (`SITE.applyRelease` in `assets/site.js`, on every page). The static HTML shows the before copy, and once GitHub's latest release reaches that version the after copy takes its place, so release day needs no edit for it. Home uses it for its "Coming in 0.5" labels and its "until then the download is 0.4.4" lines (the demo's end card too), and the download page for its 0.5 notes. Without an answer from GitHub a page keeps the before copy.

## Editing the roadmap

`assets/roadmap.json` holds every roadmap item; the comment field at the top of the file explains the fields. To move an item, change its status there. The roadmap page and its timeline read that file. Home doesn't list roadmap items.

## Adding to the Made with Studio wall

`assets/showcase.json` is a list of projects; the field list is in a comment in `community.html`. Add a project by pull request, or share it in the Discord first, and add it only with the maker's OK. An empty list shows the "Be the first" card.

## Wiki pages

Add a markdown file under `wiki/pages/` and list it in `wiki/pages.json` (title, section and a one-line summary). Link between pages with `#/slug`. Mark what the next release adds with `<span class="status next">Coming in 0.5</span>` (it becomes `New in 0.5` once 0.5 is out), and work that isn't built yet with `<span class="status progress">In progress</span>` or `<span class="status planned">Planned</span>`. A mark inside a heading doesn't change that heading's link, so other pages' `#/page/heading` links keep working when a mark changes.

## Names and assets

- The public name is **Vibe Studio**. Keep `SITE.portableName` and the executable, launcher and release asset filenames unchanged: they identify the existing desktop build and its settings.
- Open Graph and Twitter metadata use `assets/shots/vibe-launch.jpg` (1200×630). Its editable source is `assets/og-site.html`. Older share cards are retained for cached previews. Sharing services cache previews, so a new filename refreshes the image.
- Screenshots in `assets/shots/` use the real renderer with synthetic "Notes app" sample data (`tools/promo/prepare.cjs` on `main`). They contain no live user data.
- The earlier showreel and Discord post copy stay in `media/`.

## Checking a change

Preview with a loopback-only static server. Before pushing, check pages at 1440 and 390 px wide with no console errors, no missing files and no sideways scrolling.

## Vibe Studio launch refresh

`assets/vibe-mark.svg` is the public V/spark mark; `assets/vibe.css` supplies the new identity and responsive reward/support cards. Existing page URLs, demo controls, app executable names and storage keys stay compatible.

The homepage separates announced launch rewards from the current downloadable app. First-week and first-month windows begin at launch, with no invented date or user counts. First-week members retain the monthly Donor rank free for life; first-month members receive free Supporter status. Optional support is $5 for first-time donors (lifetime rank, half off the first subscription month) and $10/month for Builder support. The lifetime rank does not promise an unspecified lifetime credit allocation. There is no payment form; Discord carries claim and checkout details. These offers replace the previous participation-only credit policy.
