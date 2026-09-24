# Privacy and security

Studio is local-first. There is no telemetry and no hosted account, and nothing leaves your machine except to the providers and CLIs you connect and to GitHub's release API. The repository's [SECURITY.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/SECURITY.md) is the policy this page summarises.

## Keys

- Keys are encrypted with the OS keystore (`safeStorage`, which is DPAPI on Windows) and bound to the Windows account that saved them. They cannot be decrypted on another machine or account.
- **In source**, the encrypted keys live in `%APPDATA%\Mefi's Studio AI+\auth.json`, a credentials file kept apart from the `settings.json` preferences, so the two never travel together. **In v0.2.0**, they live inside `settings.json`.
- Only "saved" or "not saved" crosses into the interface. The UI never sees a key.
- Each Jev route keeps its own encrypted key.
- Keys passed as `MEFI_STUDIO_*_KEY` variables for headless setup are read once and copied into the keystore. Clear them from your shell afterwards. **In source**, child processes, including the coding workers, never inherit them.

## What stays on your computer

Tasks, conversations, plans (`planning.json`), brain maps, settings, databases, captures, profiler reports and build output all live locally. Git tracks only `data/curated.json` and `data/models.json`, and packaging never seeds a build with personal state. Profiler reports hold measurements, never task text or paths.

## What leaves your computer

- Prompts to the assistant and builder routes you selected, sent to those providers.
- Account readings from the usage tracker, over your own saved key, only while a usage view is open.
- A release check to GitHub's API every 20 minutes from a portable build.
- Web pages the assistant fetches while **useWeb** is on. Turn it off in Settings if you prefer.

The Analyzer and the Auditor run locally; the Analyzer's optional AI read sends bounded excerpts only when you ask. Activity & evidence only reads the OpenCode session store. The first-run scan never opens OpenCode's credential store and never sends a prompt. **Audio link** listens to desktop audio or the microphone only when you turn it on.

## Things to keep in mind

- **Agents run real commands.** Coding workers (`opencode`, `claude`, `codex`, `grok`, `agy`) edit files in the folder you chose. Start with a small project, and turn **Auto build** off (**Verify first**) to approve each task before it runs.
- **The scheduler is cooperative.** File claims prevent known collisions between Studio's own workers; it is not a filesystem sandbox.
- **Free models may learn from your prompts.** Free-tier models may use prompts to improve the model, so keep confidential work on a paid model. The catalog's privacy tags say which models train on prompts and how long they retain them.
- **The browser preview is plain HTTP.** `npm run start:web` serves the renderer on localhost and cannot launch workers; never expose that port.

## Asking for help safely

Never share `settings.json`, `auth.json`, your `data/` folder, or screenshots that show private paths. The [community page](../../community.html) lists what a useful bug report contains instead.

## Reporting a vulnerability

Please do not open a public issue for anything that could expose keys, project files or the machine Studio runs on. Follow [SECURITY.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/SECURITY.md) to reach the maintainer privately, and include the Studio version, the install kind and steps to reproduce. Expect an acknowledgement within a week; fixes ship as a normal release and the changelog credits the reporter unless they ask otherwise.
