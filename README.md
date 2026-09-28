# Mefi Studio website

Public site: https://nateecho32-stack.github.io/mefi-studio/

GitHub Pages publishes the root of this repository's `gh-pages` branch. The `main` branch holds the Electron application.

The landing page (`index.html`, `assets/home.css`, `assets/home.js`) introduces Studio and the Discord community, then covers the desktop tools and version 0.4.4. `community.html` is the invitation and contribution guide. `download.html` gives direct ZIP and checksum links without JavaScript, then asks GitHub for a newer release. The wiki lives in `wiki/`; `wiki/pages.json` controls its navigation and search descriptions.

The public name is **Mefi Studio**. Keep `SITE.portableName` and the executable, launcher and release asset filenames unchanged: they identify the existing desktop build and its settings.

Open Graph and Twitter metadata use `assets/studio-community-card.jpg`, a 1200×630 image. Its editable HTML/CSS source is beside it. Render that source at 1200×630 after edits and check the output at small sizes. Sharing services cache previews; a new image filename refreshes the image when they fetch the page again.

Screenshots in `assets/shots/` use the real renderer with synthetic "Notes app" sample data (`tools/promo/prepare.cjs` on `main`). They contain no live user data. Shared playback is labeled "Rolling out" because it needs a configured rooms hub and Discord connection. Cowork rooms and "Hey Studio" voice activation are future ideas. All themes and node styles are free in 0.4.4.

Preview with a loopback-only static server. Edit these static files on `gh-pages` and push to update the site. No build tooling or secrets are required. The earlier showreel and Discord post copy remain in `media/`.
