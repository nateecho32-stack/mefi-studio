# Updates

The current release is **0.5.0**, from __RELEASE_DATE__. It took in what was planned for 0.4.5 and 0.4.6, which were never released on their own: see [everything new in 0.5](#/coming-in-0-5/what-will-and-wont-ship). The next updates are 0.5.x. A source install gets new work by pulling `main`.

Open **Settings › System › Updates** to see your version and look for a newer one.

> **In 0.4.4, in-app updates don't finish installing.** Studio downloads and verifies the new release, but the step that installs it after Studio closes never runs. So to move from 0.4.4 to 0.5, [update by hand](#update-from-044-by-hand), just this once. <span class="status next">New in 0.5</span> The install step works, so from 0.5 on, updates install themselves.

## How the portable build updates

Studio checks GitHub for a new release every 20 minutes. When one is out, a notice says **Update available** and points to **Settings › Updates**. To look right away:

1. Open **Settings › System › Updates** and choose **Check GitHub**.
2. If a newer release is out, choose **Update to vX.Y.Z**.
3. The button shows **Downloading…**, then **Installing…** while Studio restarts.

Studio updates only when no build is running; if one is, it asks you to try again once it finishes. It downloads the release zip and checks its published SHA-256 when there is one. Then a helper replaces the app files after Studio closes, keeps your `resources\app\data` folder, and opens Studio again. In 0.4.4 that helper never runs, which is why you update by hand this once.

> <span class="status next">New in 0.5</span> Studio keeps a copy of the build it updated from. If the new one misbehaves, **Roll back** in **Settings › Updates** goes back to it.

The zip and the executable keep the older **Mefi Studio AI+** names. That's expected: the public name is Mefi Studio.

## Update from 0.4.4 by hand

Moving from 0.4.4 to 0.5 takes these steps, once. The [0.5 release notes](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.5.0) have them too.

1. Download the new release zip from the [download page](../../download.html) or [GitHub releases](https://github.com/nateecho32-stack/mefi-studio/releases). You can [check its SHA-256](installation.md#check-the-download) first.
2. Quit Studio. Closing the window only hides it in the tray, so right-click the tray icon and choose **Quit**.
3. Extract the new zip into a **new** folder. Don't extract it over the old one.
4. Copy everything in the old folder's `resources\app\data` into the new folder's `resources\app\data`, except `curated.json` and `models.json`. Those two hold the new release's model catalog, so keep the new copies. This brings your tasks, ideas, plans and conversations along.
5. Open `Mefi Studio AI+.exe` in the new folder.

Your settings, saved keys, project list and Discord link live in `%APPDATA%\Mefi's Studio AI+`, so they carry over by themselves. Keep the old folder until you've checked that everything is there.

## Studio is moving to Rust

Studio is moving from Electron to Rust with Tauri 2, in stages. The work started on 3 October 2026. The Electron build is unchanged and is still what ships. The screens, settings and API keys stay the same, and there's no date for the switch. A source install can already run the Rust host with `npm run host`. See [Studio is moving to Rust](#/coming-in-0-5/studio-is-moving-to-rust).

## Update a source install

A source install runs your checkout. To get the newest version, pull `main`, then run `npm ci`. Studio's own **Check GitHub** only reports new releases in a source install: it never replaces your checkout with a portable build.

While Studio runs, **Live update** applies changes to its source files:

| Change | What happens |
| --- | --- |
| Styles | The look updates in place. |
| Supported host scripts | The running app reloads the module. |
| Renderer code or preload | The page reloads and restores your view. |
| The main process (`main.cjs`) | Studio restarts. |

Changes are grouped and syntax-checked before they apply. A broken file, or several restarts within a minute, holds the update. Fix the source, then choose **Apply update**. When an update needs a restart, the button reads **Restart now**: it stops the coding agents, saves their latest work and relaunches Studio paused. Press **Resume** to carry on.

Turn off **Apply updates automatically** if you'd rather choose when changes apply.

## If no update appears

**Check GitHub** shows the result of the latest check. Compare your version with the [GitHub releases](https://github.com/nateecho32-stack/mefi-studio/releases).

A public release needs no GitHub token. A private repository needs a read-only token, saved in **Settings › System › Updates**.

> <span class="status next">New in 0.5</span> The [setup helper](setup-helper.md)'s **Machine & app** section also holds **Install updates automatically** and the GitHub token.

## Publishing a release

This part is for maintainers. Follow [CONTRIBUTING.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/CONTRIBUTING.md) and the repository's [release workflow](https://github.com/nateecho32-stack/mefi-studio/blob/main/.github/workflows/release.yml).

Set the version and release notes in the application repository, run the required checks on that commit, then tag and publish it. The updater expects the existing `Mefi-Studio-AI+-vX.Y.Z-win32-x64.zip` name and its checksum file.

If an update can't be installed, open an issue with your version and the updater's error.
