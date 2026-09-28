# Update Mefi Studio

Open **Settings › System › Updates** to check your version and find available updates. Portable downloads use GitHub releases. A source installation can reload local source changes while it is running.

## Update a portable installation

1. Open **Updates** and choose **Check GitHub**.
2. If a newer release is available, choose **Update to vX.Y.Z**.
3. Let Studio finish downloading and preparing the update, then follow the status shown in the app.

Studio also checks for published builds periodically. The update downloads the portable ZIP and checks its published checksum or API digest when available. A helper replaces the application files after Studio exits, preserves `resources/app/data`, and relaunches it.

The archive and executable still use the existing **Mefi Studio AI+** filenames. That is expected: the public name is Mefi Studio.

If the in-app update fails, the [download page](../../download.html) links to the current release and checksum. Keep your existing portable data folder when moving to a fresh extracted copy. [Installation](installation.md) explains the folder layout.

## Update a source installation

Source installs read the files in their checkout. Getting a newer version from Git is separate from Studio's live update feature.

Live update applies local changes according to what changed:

| Change | What happens |
| --- | --- |
| Renderer styling | The appearance updates in place. |
| Supported host scripts | The running app reloads the module. |
| Renderer code or preload | The page reloads and restores the saved view. |
| Main application process | Studio restarts. |

Edits are grouped and syntax-checked before application. A broken file or repeated restart puts the update on hold. Fix the source, then use **Apply update**. A restart uses **Restart now**, which saves agent progress before relaunching.

Turn off **Apply updates automatically** if you want to choose when local changes are applied.

## If no update appears

**Check GitHub** reports the result of the latest check. Compare the running version with the [GitHub releases](https://github.com/nateecho32-stack/mefi-studio/releases).

A public release does not need a GitHub token. Private repositories may need a read-only token configured for the updater. In a source checkout, the release checker reports availability; it does not replace the checkout with a portable build.

## Publishing a release

This section is for maintainers. Follow [CONTRIBUTING.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/CONTRIBUTING.md) and the repository's [release workflow](https://github.com/nateecho32-stack/mefi-studio/blob/main/.github/workflows/release.yml).

Set the version and release notes in the application repository, run the required gates on that commit, then tag and publish it. The updater expects the existing `Mefi-Studio-AI+-vX.Y.Z-win32-x64.zip` naming and its checksum file.

Include the running version and the updater's error in an issue if an update cannot be installed.
