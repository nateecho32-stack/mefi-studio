# About this wiki

This wiki helps you get started with Mefi Studio 0.4.4 and find the next step when something is unclear. For conversation, ideas and works in progress, join the [Discord community](https://discord.gg/xgfKc5pVxG).

## Fix a page

Use **Edit this page on GitHub** at the bottom of the page. Make your change and follow GitHub's steps to propose it as a pull request. A typo, missing step or clearer example is enough to help.

Application code lives on `main`; this website and its wiki live on `gh-pages` in the [same repository](https://github.com/nateecho32-stack/mefi-studio).

## Add a page

1. Add `wiki/pages/your-topic.md` on `gh-pages`, starting with one `#` title.
2. Add its `slug`, `title` and short `summary` to the appropriate section in `wiki/pages.json`.
3. Link it from a related wiki page using a relative link such as `[Installation](installation.md)`.
4. Preview the page and check its links, navigation and appearance on a narrow screen.

A page called `installation.md` opens at `wiki/#/installation`. Link to a heading with `installation.md#heading-name`. Use full GitHub URLs for repository documents that are outside the wiki.

## Write for the person using it

Give the action first, then explain what should happen. Use the control names shown in the app. Keep detailed implementation notes in the repository docs.

Describe released behavior accurately. Mark features that are still rolling out or only being considered. Use sample data for screenshots and leave out private paths, keys and settings files.

Check the current app, [release notes](https://github.com/nateecho32-stack/mefi-studio/releases) and [application docs](https://github.com/nateecho32-stack/mefi-studio/tree/main/docs) when a page looks out of date.

## Preview locally

From a checkout of the site's `gh-pages` branch:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/wiki/`. The wiki loads Markdown over HTTP, so opening its HTML file directly from disk will not work. Stop the server with `Ctrl+C` when finished.

GitHub Pages publishes the root of `gh-pages`. The site has no build step; its [README](https://github.com/nateecho32-stack/mefi-studio/blob/gh-pages/README.md) describes the layout.
