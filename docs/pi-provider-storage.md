# Pi coding agent provider storage — study notes

Investigation record for task `task_idea_mucpv6bo_0`, re-checked under the
duplicate idea card `task_idea_mud7ldcn_0` (no application code changed).
Question: how does the pi coding agent store providers and related config, and how
does that compare with Studio's provider handling?

Version studied: upstream `main` of `earendil-works/pi` (npm `@earendil-works/pi-coding-agent`),
docs read on 2026-09-22 from `packages/coding-agent/docs/` and re-verified the same
day against the published `providers.md` / `settings.md` / `models.md` /
`custom-provider.md` at `https://pi.dev/docs/latest/` and
`https://github.com/earendil-works/pi`. Nothing pi-related is installed on this
machine (no `~/.pi`, no global npm package), so every pi claim below is sourced
from the upstream docs, not local files. Pi's layout changes across releases;
re-verify before relying on details.

## How pi stores providers and config

Pi splits config across plain JSON files in the agent directory (default
`~/.pi/agent`, movable via `PI_CODING_AGENT_DIR`):

| Path | Responsibility |
|---|---|
| `<agent-dir>/settings.json` | User settings: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `modelThinkingLevels`, `enabledModels`, retry/transport tuning, resource lists (packages, extensions, skills, prompts, themes). |
| `<agent-dir>/auth.json` | Saved credentials per provider: `{ "<provider>": { "type": "api_key", "key": "...", "env": { ... } } }`. Holds API keys and OAuth tokens from `/login`. Created with `0600` permissions, but still plaintext JSON — the docs only warn "keep it private", no OS-keystore encryption. |
| `<agent-dir>/models.json` | Compatible endpoints and model overrides: `providers: { <name>: { baseUrl, api (e.g. "openai-completions"), apiKey, models: [{ id, input, inputLimits, promptCache }] } }` plus `modelOverrides` that patch built-in models without replacing the list. |
| `<agent-dir>/models-store.json` | Cache of provider catalogs refreshed from pi.dev and configured providers, so offline startup still has a model list. Separate from the user-edited `models.json`. |
| `<agent-dir>/trust.json` | Saved project-trust decisions keyed by folder (or a parent), consulted before loading `.pi/` settings, resources or project extensions. |
| `.pi/settings.json` (project) | Project-level settings and resources, loaded only after project trust is granted. No project-level auth or models file. |

Credential values in `auth.json` and `models.json` accept three forms: a literal,
`$NAME`/`${NAME}` environment interpolation, or a leading `!command` that shells
out to a secret manager at need (`auth.json` commands are cached for the process
lifetime; `models.json` commands run per request).

Credential precedence (pi): runtime `--api-key` → stored `auth.json` credential →
`apiKey` in `models.json` → provider environment variable (e.g. `ANTHROPIC_API_KEY`,
`ZAI_API_KEY`, `OPENCODE_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`) or
ambient cloud credentials (AWS profile/IRSA, `gcloud` ADC).

Beyond static endpoints, pi supports provider *extensions* (`pi.registerProvider()`)
that can add OAuth login flows, dynamic model discovery (`refreshModels`), or
custom streaming; their OAuth tokens also land in `auth.json`. The built-in
model catalog ships with the CLI and can be refreshed from pi.dev
(`pi update --models`); a cached copy keeps offline startup working.

## How Studio stores providers and config

- At study time (2026-09-22) Studio kept one store:
  `%APPDATA%\Mefi's Studio AI+\settings.json`, mixing preferences and provider
  credentials. This study's takeaway changed that the same day (commit
  `2457a7d`): ciphertext now persists to `auth.json` beside `settings.json`
  (`main.cjs:123-127`, `scripts/auth-store.cjs`), and `readSettings()` serves
  callers one merged view with a one-time migration off the legacy fields.
- Keys are DPAPI-encrypted through Electron `safeStorage` and kept as separate
  base64 fields in `auth.json` — `zaiApiKeyEncrypted`, `apiKeyEncrypted` (OpenCode Go),
  `customApiKeyEncrypted`, `gatewayApiKeyEncrypted`, `jevApiKeyEncrypted`,
  `zenApiKeyEncrypted`, `openrouterApiKeyEncrypted`, `githubTokenEncrypted`
  (`main.cjs:12761-12789`, `:13847-13990`).
- Each field has environment fallbacks behind it: `MEFI_STUDIO_*` names plus
  shared aliases other tools already use (`AI_GATEWAY_API_KEY`, `TYPESAFE_API_KEY`,
  `OPENCODE_ZEN_API_KEY`, `OPENROUTER_API_KEY`, `GH_TOKEN`/`GITHUB_TOKEN`)
  (`scripts/credentials.cjs`). Environment wins for headless runs; otherwise the
  encrypted settings field (`scripts/decision-client.mjs:179-185`).
- Provider set is fixed in the UI: z.ai GLM, OpenCode Go, LM Studio (local, no
  key), one custom OpenAI-compatible endpoint (URL + key), plus CLI builders that
  run on their own logins (OpenCode, Grok, Claude Code, Codex, Antigravity)
  (`renderer/booklet.template.html:392-487`).
- Per-provider model settings (routine/heavy), auto-provider order and fallback
  live in the same settings store; the committed `data/models.json` is the model
  catalog. Credentials are app-wide, never scoped per project
  (`scripts/projects.cjs:89`), and are stripped from child-process environments
  (`scripts/platform.cjs`).
- OpenCode integration keeps two credential worlds deliberately separate: Studio's
  DPAPI fields vs OpenCode's own `~/.local/share/opencode/auth.json`
  (`docs/first-run-opencode.md:60`).

## Comparison

| Aspect | pi | Studio |
|---|---|---|
| Config files | Split: `settings.json`, `auth.json`, `models.json`, `models-store.json`, `trust.json` in `~/.pi/agent` | Split since this study: `settings.json` + `auth.json` in Electron `userData` |
| Keys at rest | Plaintext `auth.json` (docs: keep private) | DPAPI/`safeStorage`-encrypted base64 fields in `auth.json` |
| Key sources | `--api-key` → `auth.json` → `models.json` → env var / ambient cloud | Env var (headless) → encrypted `auth.json` field; env aliases for shared names |
| Secret managers | `!command` values in `auth.json`/`models.json` | None (env aliases only) |
| Provider set | Many built-ins + arbitrary entries in `models.json` + extensions | Fixed catalog + one custom OpenAI-compatible endpoint + CLI builders |
| Per-model metadata | Rich, user-editable (`baseUrl`, `api`, `inputLimits`, `promptCache`, cost) | Catalog in `data/models.json`; per-provider routine/heavy picks in settings |
| Project scope | `.pi/settings.json` after a trust gate (decisions kept in `trust.json`); resources combine | Project overrides for agent settings; credentials and catalog stay app-wide |
| Catalog refresh | Bundled + pi.dev overlay, cached offline | `npm run data` refresh into committed `data/models.json` |

## Takeaways for Studio

- pi's file split (settings vs auth vs models) keeps machine-bound credentials out
  of files users are encouraged to edit and diff. Studio's single `settings.json`
  mixed encrypted blobs with ordinary preferences; a separate auth file makes the
  machine-bound-key warning easier to honor. Adopted 2026-09-22
  (`task_88a18406f34104ca`, commit `2457a7d`): ciphertexts now persist to
  `auth.json` beside `settings.json` (same DPAPI encryption, new home), with a
  one-time migration on load; the env-alias tiers and precedence are unchanged
  (GETTING_STARTED.md:102-105 now warns about copying `auth.json`, not
  `settings.json`).
- pi's `!command` key form is a cheap pattern for secret-manager users; Studio's
  env-alias mechanism covers the CI case but not OS keychains/1Password.
- pi's project-trust gate before loading `.pi/` config is a deliberate contrast to
  Studio's app-wide credentials; relevant only if Studio ever reads provider
  config from project folders.

Sources: `packages/coding-agent/docs/configuration.md`, `providers.md`,
`settings.md`, `models.md`, `custom-provider.md`, `security.md` in
`earendil-works/pi` @ `main` (2026-09-22), independently re-read as the published
docs at `https://pi.dev/docs/latest/providers`, `.../settings` and
`https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/`.
The re-check under `task_idea_mud7ldcn_0` confirmed every claim above and added
`models-store.json`, `trust.json` and the `auth.json` `0600` permissions; no
Studio code changed on that pass. `task_idea_mucpv6bo_0` and
`task_idea_mud7ldcn_0` are duplicate cards for this one idea.
