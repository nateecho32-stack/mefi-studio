# Code signing

Windows warns before it opens an unsigned program downloaded from the
internet ("Windows protected your PC", then **More info › Run anyway**), and
Smart App Control on Windows 11 blocks one outright. Studio's Windows builds
are going to be signed through the SignPath Foundation's free programme for
open-source projects.

**Status:** every release so far is unsigned. Since 6 October 2026
[`.github/workflows/release.yml`](../.github/workflows/release.yml) carries
the signing steps, the packaged-app smoke launch and the hosted-runner gate
(they were kept in a separate proposal file until a credential allowed to
change workflows could land them). The signing steps stay off until
SignPath Foundation accepts the project and the variables below are set.
Until then the download page's SmartScreen steps still apply.

Free code signing provided by [SignPath.io](https://signpath.io), certificate
by [SignPath Foundation](https://signpath.org).

## Policy

**What is signed.** One file, `Mefi Studio AI+.exe`, inside the portable zip
attached to this repository's
[GitHub Releases](https://github.com/nateecho32-stack/mefi-studio/releases).
It is the Electron runtime's executable, stamped while packaging with Studio's
product name, version, copyright and icon (`scripts/stamp-exe.mjs`). SignPath
signs it only when its product name is `Mefi's Studio AI+` and its product
version is the release's version. Every other file in the zip is either
Studio's own source (JavaScript, HTML, CSS and data, which are not signed
code) or Electron's upstream runtime, shipped exactly as Electron publishes
it. A Rust-host build (`host: tauri`, see
[rust-migration.md](rust-migration.md)) ships the Rust host's program under
the same name and stamp, so the same configuration signs it; the `node.exe`
beside it is Node's own build, copied as Node publishes it.

**Where it is built.** Only by
[`.github/workflows/release.yml`](../.github/workflows/release.yml), on a
GitHub-hosted runner, from a `v*` tag of this repository. That run checks the
source, packages it, and opens the packaged app once (`--smoke`) before
asking SignPath to sign it. It then checks the signature and publishes. Builds
made anywhere else, including the maintainer's own PCs, are never signed.

**Who.**

| Role | People |
| --- | --- |
| Committers and reviewers | [nateecho32-stack](https://github.com/nateecho32-stack) (the maintainer) |
| Approvers | [nateecho32-stack](https://github.com/nateecho32-stack) |

Only the maintainer's account can push to this repository. That includes work
the maintainer does with AI coding assistants. Anyone else contributes
through pull requests, which only the maintainer can merge. Each signing
request waits for an approver's approval in SignPath. Everyone in these roles uses multi-factor
authentication on GitHub and on SignPath.

**Privacy.** Studio has no telemetry and no hosted account. It talks only to:

- the services you connect or use;
- GitHub, for its update check (every 20 minutes);
- the `origin` remote of the project you have open.

[SECURITY.md › What Studio does with your data](../SECURITY.md#what-studio-does-with-your-data)
lists every destination and when each one is contacted.

## Setting it up (maintainer)

The workflow already has the signing steps. They stay switched off until the
repository has the variables below, and releases are published unsigned until
then, as before.

1. Turn on two-factor authentication on GitHub if it is not on already.
2. Apply at <https://signpath.org> (Apply for the open-source programme). Use
   this repository, the download page and this page as the code signing
   policy. The review is manual and takes one to two weeks.
3. After acceptance, in SignPath:
   - Link the predefined trusted build system **GitHub.com** to the project,
     and install the SignPath GitHub App on this repository.
   - Use a **release-signing** policy that needs your approval for every
     request.
   - Set the project's artifact configuration to:

     ```xml
     <?xml version="1.0" encoding="utf-8"?>
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <parameters>
         <parameter name="version" required="true" />
       </parameters>
       <zip-file>
         <pe-file path="Mefi Studio AI+.exe" product-name="Mefi's Studio AI+" product-version="${version}">
           <authenticode-sign description="Mefi's Studio AI+" description-url="https://github.com/nateecho32-stack/mefi-studio" />
         </pe-file>
       </zip-file>
     </artifact-configuration>
     ```

     The workflow uploads the executable on its own, so it is the only file in
     the zip SignPath receives, and it passes `version` without the `v`
     (`0.4.6`), which matches the stamped ProductVersion.
   - Make an API token for a CI user with the submitter role.
4. In this repository's **Settings › Secrets and variables › Actions**:
   - secret `SIGNPATH_API_TOKEN`: that token;
   - variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and
     `SIGNPATH_SIGNING_POLICY_SLUG`, from SignPath.

   Setting `SIGNPATH_ORGANIZATION_ID` switches signing on. From then on a
   release run that cannot sign fails instead of publishing an unsigned build.
5. A push that changes `.github/workflows/` needs a GitHub login with the
   `workflow` scope: `gh auth refresh -h github.com -s workflow`.

## Releasing a signed build

1. Gate the release commit as usual, tag it and push the tag. The tag push
   runs the full `npm test` on the runner.
2. If the run stops at the Electron render fixtures that only fail on hosted
   runners, start **Publish portable release** by hand with the tag and
   `gate: hosted`. Use this only for a tag that passed the full local gate
   (its TESTRUNS row).
3. Approve the signing request in SignPath. The run waits up to an hour, then
   checks the signature and publishes the zip and its `.sha256`.
   A tag push always builds on Electron (`TAG_HOST` in the workflow). To add
   the Rust-host zip to the same release, start the workflow by hand with the
   tag and `host: tauri`; it is signed and published the same way.
4. Check the published executable:
   `Get-AuthenticodeSignature "Mefi Studio AI+.exe"` should say `Valid`, and
   its signer should name SignPath Foundation.

The warning can still appear for the first few weeks. Windows builds a
publisher's reputation from downloads, and a new signing certificate starts
with none. Signing keeps that reputation from one release to the next; an
unsigned build starts from nothing every time. After the first signed release,
update the site's SmartScreen steps (Home, Download, and the wiki's
Installation and Troubleshooting pages) and the roadmap entry that says the
build is unsigned.
