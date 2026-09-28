# Contributing

You can help Mefi Studio with code, documentation, bug reports or feedback. Start with a small change that you can explain and verify.

## Report a problem or suggest an idea

Use the [bug report](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=bug_report.md) or [feature request](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=feature_request.md) template. For bugs, include the version, install type, selected agent, steps and what happened. For an idea, explain what you want to do and what gets in the way.

Keep credentials and private project content out of posts. Report security problems through [SECURITY.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/SECURITY.md).

## Change the application

Application code lives on the repository's `main` branch. Read [CONTRIBUTING.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/CONTRIBUTING.md) before starting; it has the current conventions and check requirements. The [code map](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/code-map.md) helps you find the relevant file.

1. Check for existing local changes and other sessions before changing branches. Use a separate worktree when you need an isolated checkout.
2. Make the change. If you edit `renderer/`, run `npm run build-booklet` and include the generated `renderer/booklet.html`.
3. Read [TESTRUNS.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/TESTRUNS.md) before testing, then run the required checks from the application root:

   ```powershell
   npm run check
   npm test
   npm run audit
   ```

4. Open a pull request explaining the change, how to try it and which checks passed. Update the app docs and changelog when behavior changes.

`npm run test:fast` and `npm run lint` help while you iterate. The full test run needs Python 3 on PATH and a usable desktop for Electron tests. Follow the contribution guide for recording test runs.

## Change the website or wiki

The website lives on `gh-pages` in the same repository. Each wiki page has an **Edit this page on GitHub** link. See [About this wiki](about-this-wiki.md) for adding pages and previewing changes.

For a site-only change, check links and view the affected pages on desktop and a narrow screen. Application test commands belong to the application checkout.

## Keep local work safe

- Preserve other people's uncommitted changes and active sessions.
- Do not commit local settings, keys, databases, screenshots of private work or migration backups. Only `data/curated.json` and `data/models.json` belong in Git.
- Keep Ruins Runner in its own repository.
- Preserve the application's existing package identifiers and executable names so saved settings and updates keep working. The public name is Mefi Studio.
