# Guided CLI setup

Open **Start here** from Help, or **Install a coding tool or use one
subscription for Studio** in **Team › Providers**. The same connection controls
appear at the tour's Your AI (scan) and First map stops, so a missing tool
never sends a new user back through the walkthrough.

1. Choose Codex, Claude Code, Grok, Antigravity or OpenCode. Installed tools
   are detected locally; detection alone does not claim that a login works.
2. **Install and sign in** opens an interactive Windows setup window. The
   host runs a fixed vendor command, installs Node.js LTS through Windows
   Package Manager if an npm install needs it, and opens the vendor's login.
   **Sign in** opens only login. Installation and account creation are never
   triggered by the automatic scan.
   The window searches the per-user folders installers use (`~\.local\bin`,
   `%LOCALAPPDATA%\agy\bin`, `%APPDATA%\npm`, `~\.grok\bin`), the same ones
   Studio's own PATH refresh adds, so an installer that did not update the
   user PATH still reaches its login.
3. Close the setup window. Studio re-reads PATH and detects the tools again by
   itself (**Refresh installed tools** does the same by hand), then choose
   **Check connection**.
   This explicit check sends a small prompt using the selected account's
   allowance and the same restricted adapter used by planning. Failures keep
   sign-in, update and instructions available. Passwords and tokens stay with
   the CLI; the renderer receives no credentials.
4. **Use for the whole studio** saves the subscription for Studio defaults and
   every project: a project that inherits the defaults follows them, and each
   project that saved a team of its own gets the same change (its rules and
   name stay, and the message says how many project teams moved). It replaces
   conflicting routine/heavy and seat choices,
   makes subtasks follow the builder, sets Auto coding tier and provider model
   defaults, and turns cross-provider fallback off. Saved per-provider models
   and keys remain. While a team stays on that one subscription, Jev's intake
   and work shaping ask it too (the assistant stand-in), and Jev keys, saved
   or in the environment, are set aside for them.
   This choice starts a map if a project is selected, or waits for a folder.
   The scan's **Use this setup** and Settings' **Auto setup** save to the
   defaults and the open project's own team, so folders added later inherit
   the route.

## More than one login

Two Claude or ChatGPT subscriptions work side by side. Under **Setup › Connect
an AI › More than one login**, **Add a Claude Code login** (or Codex) makes the
login a folder of its own under Studio's user data
(`cli-logins/<id>`), then opens the vendor's sign-in window with
`CLAUDE_CONFIG_DIR` (Codex: `CODEX_HOME`) pointed at it; sign in there with the
other account. The CLI's own folder stays the **Main login** and always comes
first. **Check** sends the same small prompt as Check connection on that login,
**Sign in** reopens its window, and **Remove** forgets it and deletes its folder
with the sign-in in it.

- Every Claude Code or Codex call (chat, planning, seats, the first project
  map, coding workers and the usage read) runs on the first login that is not
  topped out.
- A login that reports its usage limit ("5-hour limit reached ∙ resets 3pm",
  "You've hit your limit", Codex's "try again in 4 days 3 hours") is set
  aside until the reset it names, or for half an hour while a usage reading
  learns the real one. Rate limits and outages are not a login's limit and
  move nothing. An assistant call is asked again on the next login at once;
  a coding worker's card goes back to the queue with no backoff and no
  attempt charged, and runs on the next login.
- Only when every login is topped out does anything else answer, and only
  through fallbacks you already allowed (the fallback switch in routing, and
  not a team set up with **Use for the whole studio**). Otherwise workers wait
  for the first reset, and the reason is on the feed.
- The marks outlive a restart (`cli-account-limits.json`), and a usage reading
  that shows room again lifts one early. Usage › Provider accounts shows one
  row per login.
- A Claude Code login links its `projects/` folder to the main login's, so
  every login works from the same session transcripts and project memory.
  Removing a login takes the link away first and checks it is gone, so the
  delete never reaches the main login's folder. Codex logins keep their own
  `sessions/`: those carry that login's plan windows.
- Your own settings, plugins and `CLAUDE.md` in the main folder are not
  copied; Studio passes what its runs need on the command line.

Implementation: `scripts/cli-accounts.cjs` (pure: the logins, which one
answers, the reset readings) and main.cjs's "Several logins per coding CLI"
block (the folders, the marks file, `cliAccountTurn` for assistant calls,
`cliAccountLimitHit` in the executor's `finish`).

No subscription tool? **I have an API key or a local model server** walks to
Team › Providers, where a z.ai, OpenRouter, OpenCode Go or Zen key,
a custom endpoint or LM Studio can be set up. A saved key that gives the
assistant a working route (or **Back to the scan**, e.g. after picking LM
Studio) returns to Scan and scans again; **Use this setup** then saves the
route auto setup found and maps the folder through it.

The provider's own model access, subscriptions and rate limits apply. Studio
does not promise access to every model or unlimited parallel requests. Choose
available models per role in Team setup; empty model values use CLI defaults.
OpenCode remains an optional route for its linked and free models; scan and
apply its choices after installation. Manual planning and the tour remain
available while connecting an account.

Mapping on a subscription uses the local analyzer's inventory and bounded,
redacted project excerpts. It saves parsed suggestions as ideas, never starts
build work, and discards cancelled or project-switched results. OpenCode can
still run its existing plan explorer and show native session todos.

Text adapters run outside the project in disposable directories. Claude uses
no native tools or inherited MCP configuration. Grok disables built-in tools,
MCP calls and delegation. Codex uses read-only execution, ignores user config
and rules for the turn, and disables execution, hooks, MCP and app tools.
Antigravity uses a no-tools custom main agent and receives no prompt until its
initial event confirms that agent and an empty tool roster. Incompatible CLI
versions fail the connection check; Studio never retries with fewer controls.
A text call whose caller stops waiting (the Jev stand-in after 15 s, the
Daily editor after 60 s, the chat at its budget, the outside-work check)
stops the CLI's process tree at that moment instead of letting it run on to
its own three-minute limit; a call stopped that way is not counted toward
pausing the tool, and the usage ledger keeps it as cancelled.
Studio's configured research tools remain available through its host tool loop.
Coding workers retain their existing execution paths and project permissions.

Implementation: `scripts/cli-setup.cjs` owns the fixed install/login catalog
and subscription configuration; `scripts/cli-text.cjs` owns restricted text
sessions; `scripts/first-run-service.mjs` owns mapping and its cancellation;
`renderer/onboarding.js` owns the guided UI.

Vendor instructions checked September 26, 2026:

- [Codex CLI](https://developers.openai.com/codex/cli) and [configuration](https://learn.chatgpt.com/docs/config-file/config-reference).
- [Claude Code setup](https://code.claude.com/docs/en/setup).
- [Grok installation and authentication](https://docs.x.ai/build/enterprise), [CLI flags](https://docs.x.ai/build/cli/reference) and [permissions](https://docs.x.ai/build/features/permissions).
- [Antigravity installation](https://www.antigravity.google/docs/cli/install/), [headless protocol](https://www.antigravity.google/docs/cli/headless/) and [custom agents](https://www.antigravity.google/docs/subagents/).
- [OpenCode installation](https://opencode.ai/docs/).
