# Mefi's Studio AI+ website

Public site: https://nateecho32-stack.github.io/mefi-studio/

GitHub Pages publishes the root of this repository's `gh-pages` branch. The `main` branch holds the Electron application.

The landing page (`index.html`, `assets/home.css`, `assets/home.js`) is how Studio is presented: what it does, the media player, Friends and linking, what's new in 0.4.4, privacy and an FAQ. `download.html` gives direct 0.4.4 ZIP and checksum links without JavaScript, then asks GitHub for a newer release; if that lookup fails, the published download still works. The wiki lives in `wiki/`.

Screenshots in `assets/shots/` come from the real renderer with synthetic "Notes app" sample data (`tools/promo/prepare.cjs` on `main`), captured offscreen with no network access. They contain no live user data. Features that are not live yet are tagged on the page ("Rolling out", "On the roadmap"): Listen together and the Discord link need the rooms hub address and the Discord app id set in a release build.

Preview with a loopback-only static server. Edit these static files on `gh-pages` and push to update the site. No build tooling or secrets are required. The earlier showreel and Discord post copy remain in `media/`.
