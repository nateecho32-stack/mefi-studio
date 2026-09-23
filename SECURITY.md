# Security

## What Studio does with your data

- **Keys stay on your machine.** API keys entered in Settings are encrypted
  with the OS keystore (DPAPI on Windows) inside
  `%APPDATA%\Mefi's Studio AI+\auth.json`, a credentials file kept separate
  from the `settings.json` preferences so the two never travel together. Only
  "key present / absent" status crosses into the renderer. Keys are bound to
  the Windows account that saved them and cannot be decrypted elsewhere.
- **No telemetry, no hosted account.** Studio only talks to the providers and
  CLIs you connect, to GitHub's release API when it checks for updates, and to
  `discord.com` if you choose to link a Discord account (next point).
- **Optional Discord link.** Nothing contacts Discord until you press **Link
  my Discord** in Settings › Community. Linking reads your Discord user id,
  username and display name, and your role ids and join date in the Void
  Engine server (scopes `identify` and `guilds.members.read`; no messages,
  email or other servers, and nothing about your projects). It reads them when
  you link, then about once a week (sooner, backing off to daily, after a
  failed check) and when you press **Check now**. The sign-in redirect lands
  on a one-shot listener bound to `127.0.0.1` (ports 53134–53136) that checks
  the `Host` header and the OAuth `state`, and the login uses PKCE with no
  client secret. The link's public fields and check times are kept in
  `settings.json`. The refresh token is encrypted with the OS keystore through
  `safeStorage` in its own `community-auth.json` in the same folder (not
  `auth.json`). The access token is held in memory only, and no token crosses
  into the renderer. Without a keystore nothing is written and the link lasts
  for the session. To revoke, press **Unlink**, which revokes the grant at
  Discord and deletes `community-auth.json`, or remove "Mefi Studio Link"
  under Discord › User Settings › Authorized Apps. See
  [docs/community.md](docs/community.md).
- **Local state is never committed or packaged.** Tasks, conversations,
  databases and captures live under `data/` (source install) or the portable
  build's own `resources/app/data`; both are ignored by git and skipped by the
  packager. Settings live outside the install, in Electron's per-user folder
  `%APPDATA%\Mefi's Studio AI+`: the `settings.json` preferences, the
  saved-key file `auth.json`, the Discord sign-in `community-auth.json` and the
  resume record `session.json`. That folder belongs to the Windows account,
  not to one install, so a source checkout and a portable build run by the
  same account share it. It is never committed or packaged either.
- **Agents run real commands.** Coding workers (`opencode`, `claude`, `codex`,
  `grok`, `agy`) edit files in the project folder you chose. Use **Verify
  first** (Auto build off) if you want to approve each task before it runs.

## Reporting a vulnerability

Please do not open a public issue for anything that could expose keys,
project files or the machine Studio runs on. Instead, use GitHub's private
vulnerability reporting on this repository ("Security" tab → "Report a
vulnerability"), or email the maintainer address shown on the GitHub profile
of `nateecho32-stack`. Include the Studio version (Settings › Updates),
whether you run the portable build or from source, and steps to reproduce.

You will get an acknowledgement within a week. Fixes ship as a normal release;
the CHANGELOG entry credits the reporter unless they ask otherwise.

## Scope notes

- Studio reads its own `MEFI_STUDIO_*_KEY` variables (and
  `MEFI_STUDIO_GITHUB_TOKEN`) every time it needs a key, and a variable that
  is set wins over the key saved in Settings. That lets a host with no
  keystore run at all. The headless `--set-*-key` commands are the one-time
  path: they copy the variable into the keystore once. After running one,
  unset the variable. Otherwise the plaintext copy stays in your shell, any
  later launch from that shell keeps using it, and a key you change in
  Settings is silently ignored.
- The browser fallback (`npm run start:web`) serves the renderer over plain
  HTTP on 127.0.0.1 only and cannot launch workers. It serves `renderer/`,
  `assets/` and the public `data/models.json` catalog, never the rest of
  `data/`, sources or dotfiles; do not forward or proxy that port.
- Links the renderer asks the host to open (`shell:open`) must be `http` or
  `https`; any other scheme is refused. Discord links never take that path:
  the renderer names a target (`invite`, `server`) and the host opens a
  hard-coded `https://discord.gg` or `https://discord.com` URL.
- The Studio window only ever shows its own page. A link that asks for a new
  window opens in your default browser, and only if it is `http` or `https`;
  nothing opens as a child window of the app. Anything that would navigate
  the window itself away from the bundled page (a dropped link, a stray
  `href`, a script) is refused. `setWindowOpenHandler` and the `will-navigate`
  guard in `main.cjs` enforce this.
