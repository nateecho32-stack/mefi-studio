# Live update and release updates

Studio updates itself in two ways, depending on how it was installed. A source checkout follows its own files; a portable build follows GitHub Releases. Neither ever writes to your data folder.

## Live update (source installs)

Studio watches its own source tree:

| You edit | Studio does |
| --- | --- |
| `renderer/styles.css` | Restyles in place |
| `scripts/*.mjs` | Hot-swaps the module inside the running app |
| Renderer files and `preload.cjs` | Reloads the page with tab, selection, scroll and focus restored |
| `main.cjs` | Restarts the app with the window where it was |

Edits are batched and changed scripts are syntax-checked first. A broken file, or three restarts within a minute, puts the update on **hold** instead of crashing. Fix the file and apply the update from **Settings › Updates & diagnostics**, where **Apply updates automatically** can also be switched off. The `data/` folder is never written by the updater or by packaging.

## Release updates (portable builds)

A packaged copy reads the repository's latest release every 20 minutes. When a newer build exists, **App updates** offers **Update to vX.Y.Z**:

1. It downloads the release zip.
2. It verifies the published `.sha256`, or the API digest, when one exists.
3. It stages the portable folder.
4. A helper waits for the app to exit, copies the payload into place, never touching `resources/app/data`, and relaunches.

In a source checkout the checker only reports; live update applies source changes there. A private repository needs a read-only token: save one in **App updates**, set `MEFI_STUDIO_GITHUB_TOKEN`, or let Studio reuse `gh auth token`. `MEFI_STUDIO_UPDATE_REPO` points the checker at another `owner/repo`.

## Publishing a release

For maintainers. Run the three gates on the exact commit you will tag, preferably in a clean checkout rather than a working tree other sessions are writing to.

The release workflow does not bump versions. The release commit sets the version in `package.json` and `package-lock.json` and turns the changelog's *Unreleased* section into a dated version with its links. Then either push a tag:

```powershell
git tag v0.3.0
git push origin v0.3.0
```

or build and publish locally:

```powershell
node scripts/package-release.mjs --version v0.3.0            # build and inspect the zip first
node scripts/package-release.mjs --version v0.3.0 --skip-build --publish
```

The tag runs `.github/workflows/release.yml` on a Windows runner: the check gate, the tests, then packaging and publishing. Every release carries `Mefi-Studio-AI+-vX.Y.Z-win32-x64.zip` and a sibling `.sha256`; the in-app updater and this site's [download page](../../download.html) both look for exactly those names.

## Checking what you have

**App updates** shows the running version and the result of the last check. That version is the first thing to put in a bug report.
