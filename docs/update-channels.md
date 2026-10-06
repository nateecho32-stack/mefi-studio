# GitHub update channels

Settings > System > Updates is the single home for channel controls.
Stable is the default. It checks GitHub's published latest release every
20 minutes and offers the exact Windows x64 portable ZIP. It excludes drafts,
prereleases and raw commits. Stable installation remains a manual action.

Development / beta requires a native confirmation whose default is Cancel.
The warning names untested changes, instability, possible data loss, automatic
installation and restart, and the need to back up work. The setting is stored
atomically in the existing release settings. It survives restart; old and
unknown settings select Stable. It never enables itself just because a build
version contains a prerelease suffix.

ci.yml publishes the development builds (the owner turned this on on
6 October 2026). After all its checks pass, every run packages a fresh portable
build with the existing release packager (`scripts/package-development.mjs`),
so a broken packager fails the branch that broke it. Only a push to main
uploads that build, as an immutable Actions artifact named
mefi-studio-development-win32-x64. Review branches and pull requests publish no
development executables. This workflow creates no release and no version tag.
Artifacts expire after 14 days. The check examines the most recent 20
successful main push runs; it reports when no supported, unexpired artifact
exists. It never substitutes source code for a missing build.

A new PC gets its first build by hand: sign in to github.com, open the
repository's Actions tab, pick the newest green "Studio checks" run on main,
download the mefi-studio-development-win32-x64 artifact, unzip it, unzip the
Mefi-Studio-AI+-v…-win32-x64.zip inside it, and start Mefi Studio AI+.exe. Then
Settings › System › Updates › Development / beta keeps that copy on the newest
green main build. Studio needs a GitHub login with Actions read access for
that (Set up this PC installs and signs in the GitHub CLI); it never asks for
new grants by itself.

Once the publishing workflow is available, development downloads use an existing GitHub login or stored token with Actions
read access. No authentication or new grants are performed automatically. The
version is X.Y.Z-dev.RUN.ATTEMPT, using package.json at the exact built commit.
Numeric semver ordering handles run numbers and reruns, and an explicit opt-in
can move from stable X.Y.Z to development X.Y.Z-dev.N. A later stable version
is not replaced by an older development base.

Only completed successful push runs through .github/workflows/ci.yml on main
in the selected repository are eligible; fork and PR artifacts are excluded.
Both channels restrict executable asset URLs to that repository's GitHub API
asset endpoints before supplying credentials. GitHub's API digest or the
published SHA-256 is required. Development verifies the outer Actions archive,
the inner portable ZIP checksum, and version/commit/run metadata. After
extraction the app name, product name, version, entry point, executable and
renderer must match. This retains the repository publisher's existing trust
boundary; checksums do not establish an independent code signature.

An interrupted or truncated download removes partial bytes. Staging is isolated
by process and version, and a failed download never starts the installer. ZIP
extraction retains the existing traversal checks. Development requires the
existing backup and boot-health rollback machinery. The installer keeps local
data out of the replacement, and existing PowerShell rehearsal tests cover
failed launches, copy failures and manual rollback. Jobs are checked before
download and again before replacement. A verified build waits for running jobs
or Love2D to finish; the next poll retries. It does not interrupt them.

Turning development off clears cached and staged eligibility and fences any old
check response. Stable then offers the latest published release even if it is
lower than the running prerelease. Installing that lower version requires a
second native confirmation: older code may not understand development data.
Turning the switch off alone does not immediately replace the installed code.
No schema down-migration is promised. Rollback restores code while retaining
data, so backups remain necessary. Installed builds cannot activate the live
source updater, even beside a checkout; source checkouts keep their editor loop.

## Multi-PC follow-on

Update delivery is separate from work scheduling. The requested next phase has
Maxwell as an always-online coordinator, paired PCs taking GitHub-backed jobs,
and operation across LAN and different networks. Existing Fleet, cowork claims,
project revisions, resumable attempts and GitHub synchronization are the seams
to reuse. Pairing identity, job authorization, encrypted secrets, lease/heartbeat
ownership, duplicate execution and reconnect recovery need explicit contracts
before remote execution. This change does not open ports, change networking,
grant credentials or introduce a remote worker service.
