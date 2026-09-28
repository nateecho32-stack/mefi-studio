# Guided CLI setup

Open **Start here** from Help or **Agents › Setup › Connections**. The same
connection controls appear at Scan and First map, so a missing tool never
sends a new user back through the walkthrough.

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
   the current project (a project that inherits the defaults follows them; one
   with its own team gets the same change). It replaces conflicting
   routine/heavy and seat choices,
   makes subtasks follow the builder, sets Auto coding tier and provider model
   defaults, and turns cross-provider fallback off. Saved per-provider models
   and keys remain. Other projects with explicitly saved teams retain them.
   This choice starts a map if a project is selected, or waits for a folder.
   The scan's **Use this setup** and Settings' **Auto setup** save to the same
   places, so folders added later inherit the route.

No subscription tool? **I have an API key or a local model server** walks to
Agents › Setup › Connections, where a z.ai, OpenRouter, OpenCode Go or Zen key,
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
