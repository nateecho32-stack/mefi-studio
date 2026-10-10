# Contributing and feature requests

You can help Vibe Studio with ideas, bug reports, documentation or code. Start small: a change you can explain and check.

## Suggest a feature

1. Look at the [roadmap](../roadmap.html) first: it may already be planned or being built. It also shows the most-wanted requests.
2. If someone already asked for it, add a 👍 to their request, or a comment with your own reason.
3. Otherwise, [open a feature request](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=feature_request.md). Say what you're trying to do, what gets in the way today, and what you'd expect instead.

You can also suggest it in the [Discord](https://discord.gg/nTU3pxhgq). Feature requests get the **enhancement** label.

## Report a problem

Use the [bug report](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=bug_report.md) template. Include your version, install type, the coding agent you picked, the steps, and what happened. [Troubleshooting](troubleshooting.md) and [Trace, logs and diagnostics](trace.md) help you gather the details.

Keep keys and private project content out of posts. Report security problems privately through GitHub's [vulnerability report form](https://github.com/nateecho32-stack/mefi-studio/security/advisories/new), as [SECURITY.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/SECURITY.md) explains.

## Good first contributions

Look for issues labelled **good first issue**, **help wanted**, **documentation** or **accessibility**. A fix to this guide is a great first step too: see [Change the website or guide](#change-the-website-or-guide).

## Change the application

Application code lives on the repository's `main` branch. Read [CONTRIBUTING.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/CONTRIBUTING.md) before you start: it has the current conventions and required checks. The [code map](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/code-map.md) helps you find the right file.

You need Node.js 24 or newer: on `main`, `npm ci` stops on an older one.

1. Check for existing local changes and other sessions before you switch branches. Use a separate worktree when you need an isolated checkout.
2. Make the change. If you edit `renderer/`, run `npm run build-booklet` and include the generated `renderer/booklet.html`.
3. Read [TESTRUNS.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/TESTRUNS.md) before testing, then run the required checks from the application folder:

   ```powershell
   npm run check
   npm test
   npm run audit
   ```

4. Open a pull request that says what changed, how to see it and which checks passed. Update the app's docs and changelog when behavior changes.

`npm run test:fast` and `npm run lint` help while you work. The full test run needs Python 3, found as `python`, `py -3` or `python3`, and a real desktop for the Electron tests. Follow the contribution guide to record your test runs.

## Change the website or guide

The website and this guide live on the `gh-pages` branch of the same repository. Every guide page has an **Edit this page on GitHub** link at the bottom. [About this guide](about-this-wiki.md) explains how pages are written and marked, and how to preview your change.

For a site-only change, check the links and look at the pages on a desktop and on a narrow screen. The application's test commands belong to the application checkout.

## Keep local work safe

- Keep other people's uncommitted changes and active sessions intact.
- Don't commit local settings, keys, databases, screenshots of private work or migration backups. Only `data/curated.json` and `data/models.json` belong in Git.
- Keep Ruins Runner in its own repository.
- Keep the application's package identifiers and executable names, so saved settings and updates keep working. The public name is Vibe Studio.
