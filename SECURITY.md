# Security

## What Studio does with your data

- **Keys stay on your machine.** API keys entered in Settings are encrypted
  with the OS keystore (DPAPI on Windows) inside
  `%APPDATA%\Mefi's Studio AI+\auth.json`, a credentials file kept separate
  from the `settings.json` preferences so the two never travel together. Only
  "key present / absent" status crosses into the renderer. Keys are bound to
  the Windows account that saved them and cannot be decrypted elsewhere.
- **No telemetry, no hosted account.** Studio only talks to the providers and
  CLIs you connect, and to GitHub's release API when it checks for updates.
- **Local state is never committed or packaged.** Tasks, conversations,
  databases, captures and settings live under `data/` (source install) or the
  portable build's own `resources/app/data`; both are ignored by git and
  skipped by the packager. The saved-key file `auth.json` sits beside
  `settings.json` in the same local data folder and is equally never committed
  or packaged.
- **Agents run real commands.** Coding workers (`opencode`, `claude`, `codex`,
  `grok`, `agy`) edit files in the project folder you chose. Use **Verify
  first** (Auto build off) if you want to approve each task before it runs.

## Reporting a vulnerability

Please do not open a public issue for anything that could expose keys,
project files or the machine Studio runs on. Instead, use GitHub's private
vulnerability reporting on this repository ("Security" tab → "Report a
vulnerability"), or email the maintainer address shown on the GitHub profile
of `nateecho32-stack`. Include the Studio version (Settings › App updates),
whether you run the portable build or from source, and steps to reproduce.

You will get an acknowledgement within a week. Fixes ship as a normal release;
the CHANGELOG entry credits the reporter unless they ask otherwise.

## Scope notes

- Keys passed through `MEFI_STUDIO_*_KEY` environment variables for headless
  setup are read once and copied into the keystore; clear them from your shell
  afterwards.
- The browser fallback (`npm run start:web`) serves the renderer over plain
  HTTP on localhost and cannot launch workers; do not expose that port.
