# About this guide

This guide helps you get started with Mefi Studio and find the next step when something is unclear. Its pages describe **Studio 0.4.4**, the current download. For conversation, ideas and works in progress, join the [Discord community](https://discord.gg/xgfKc5pVxG).

## How pages mark what's new

Anything that isn't in the 0.4.4 download carries a mark, so you always know what you can use today:

| Mark | Meaning |
| --- | --- |
| <span class="status released">Released</span> | In the current download. Most pages leave this mark out. |
| <span class="status next">Coming in 0.5</span> | Finished on `main`, and ships with 0.5, the next release. |
| <span class="status rolling">Rolling out</span> | Built, but it needs a part outside Studio first, such as the Studio bot's side of Reach this PC from Discord. |
| <span class="status progress">In progress</span> | Being built right now. |
| <span class="status planned">Planned</span> | On the [roadmap](../roadmap.html), not started. |
| <span class="status idea">Idea</span> | Being thought about. The details are open. |

There was no 0.4.5 or 0.4.6 release. Both were folded into 0.5: what was marked for 0.4.5 is built on `main` and ships with 0.5, and so is most of what was in progress for 0.4.6.

Pages describe 0.4.4, so they use its names. In 0.5, Vibe is called **Social**, Build is called **Studio**, the Command view is **the Map** and Agents is **Team**; a page's 0.5 marks use the new names.

In a page's Markdown, write a mark as a span, for example `<span class="status next">Coming in 0.5</span>`. The classes are `released`, `next`, `rolling`, `progress`, `planned` and `idea`. A mark inside a heading doesn't change that heading's link.

To colour a whole note, start a quote with the mark, or with bold words that begin with the status:

```markdown
> <span class="status next">Coming in 0.5</span> The setup helper opens first.
> **Rolling out:** Reach this PC from Discord needs the Studio bot.
```

A page's `"status"` in `wiki/pages.json` (`"next"` or `"rolling"`) adds a tag beside it in the page list. When a release ships, a maintainer updates `release` and `next` in `pages.json` and removes the marks for what shipped.

## Fix a page

Use **Edit this page on GitHub** at the bottom of any page. Make your change and follow GitHub's steps to propose it as a pull request. A typo, a missing step or a clearer example is enough to help.

Application code lives on `main`. This website and its guide live on `gh-pages` in the [same repository](https://github.com/nateecho32-stack/mefi-studio).

## Add a page

1. Add `wiki/pages/your-topic.md` on `gh-pages`, starting with one `#` title.
2. Add its `slug`, `title` and a short `summary` to the right section of `wiki/pages.json`. The title and summary feed the page list, search and the browser tab, so keep the title the same as the page's `#` heading.
3. Link to it from a related page with a relative link, such as `[Install Studio](installation.md)`.
4. Preview the page, and check its links, the page list and how it looks on a narrow screen.

A page called `installation.md` opens at `wiki/#/installation`. Link to a heading with `installation.md#heading-name`. Use full GitHub links for repository documents outside the guide.

## Write for the person using it

Give the action first, then say what should happen. Use the control names the app shows, in bold. Keep implementation details in the repository's docs.

Describe released behavior exactly, and mark everything else. Use sample data for screenshots, and leave out private paths, keys and settings files. Check the current app, the [release notes](https://github.com/nateecho32-stack/mefi-studio/releases) and the [application docs](https://github.com/nateecho32-stack/mefi-studio/tree/main/docs) when a page looks out of date.

Before you publish:

- The control names match the app.
- New or future behavior carries a mark.
- Screenshots use sample data only.
- The page reads well on a narrow screen.
- `wiki/pages.json` lists the page, with a title that matches its heading.

## Preview locally

From a checkout of the site's `gh-pages` branch:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/wiki/`. The guide loads its Markdown over HTTP, so opening the HTML file straight from disk won't work. Stop the server with `Ctrl+C` when you're done.

GitHub Pages publishes the root of `gh-pages`. The site has no build step, and its [README](https://github.com/nateecho32-stack/mefi-studio/blob/gh-pages/README.md) describes the layout.

## The Discord bot's copy

The Void Engine bot's `/ask` command in the Discord answers from a copy of these pages. After big changes, a maintainer refreshes that copy.
