# Agent tools and skills

Besides its model, each agent can use a few tools while it works: web search, reading your project's files, MCP tools you trust, and skills with extra instructions. You choose them agent by agent.

## Choose tools for an agent

1. Open **Agents › Setup › Team & models**.
2. Press the **+** on an agent. Its **Skills & tools** panel opens.
3. Tick the skills and tools you want that agent to have.
4. Choose **Apply changes** to save the team.

Each project's team, the Studio defaults and your saved team presets keep their own choices.

> <span class="status next">New in 0.4.5</span> The panel becomes **Skills, tools & habits**, and the [setup helper](setup-helper.md)'s **Tools & skills** section holds the same choices for every agent.

## Web search

**Search the web** is on by default for the assistant and the seats. Your search queries leave your PC, and answers can cite the links that come back. Bing search is built in. To use Brave Search instead, set `BRAVE_SEARCH_API_KEY` in Studio's environment.

Studio never downloads whole result pages. When a search fails, the agent is told it failed, so it can't pass it off as research.

## Read project files

**Read project files** is off by default. When you turn it on, the agent can read small text files, up to 32 KB each, inside the open project. Hidden files, credentials, Studio's local data, binary files and anything outside the project are refused. It's a small research tool, not a way to browse your whole disk or run commands.

## Skills

A skill is a folder holding a `SKILL.md` file of instructions. Studio finds skills in the `.agents/skills`, `.claude/skills`, `.codex/skills` and `.opencode/skills` folders of your project or your user folder.

To add one, put its folder there, choose **Reload saved settings** in Agents, then tick the skill on the agent. An agent can have up to eight skills. Skills guide how an agent answers: they never give it permission to do more.

## MCP tools

To use an MCP server's tools, register the server in `mcp.json` inside the `.mefi-studio` folder in your user folder. Studio doesn't read a project's own `.mcp.json`. Choose **Reload saved settings**, then tick tools under **MCP tool allowlist**, up to sixteen per agent.

Studio runs local servers that talk over stdio. Remote servers and OAuth aren't supported. Keep secrets in your environment, not in the file: besides a few basic system variables, the server receives only the ones you name. The [agent tools reference](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/agent-tools.md) shows the file's format.

Ticking a tool trusts its server: it can read or change data with its own credentials. Check tools that write files, run commands or send messages before you allow them.

## Coding workers

OpenCode and Claude Code workers get Studio's search, project reads and your chosen MCP tools on every run. They can also get **Studio desk · ask_desk**, which lets a stuck worker ask the desk agent for help. Grok, Codex and Antigravity keep their own tools.

These checkboxes only limit Studio's tools. A coding CLI also has its own tools, and Studio runs it with automatic approval and broad access to files and commands. Manage those tools in the CLI's own settings.

Studio's other agents get only the tools you tick. They can't write files or run commands unless an MCP tool you chose lets them.

> <span class="status next">New in 0.4.5</span> Codex workers get Studio's tools too. **Habits** give each agent short rules of behaviour, such as explaining its changes, testing, working in small steps, matching the code around it, the shape of its report and keeping a to-do list. Each habit is off, brief or full, and the panel shows how many tokens they add to every prompt.

## Other tools in Studio

Looking for Studio's own views rather than the agents' tools?

- **Activity**, **Sessions** and **Overhead** are under **Agents › Live**: see [Command view](command-center.md#other-live-views).
- **Trace**, the performance profiler and the Connection log: see [Trace, logs and diagnostics](trace.md).
- **Analyzer** compares your plans with your code: see [Plans and ideas](planning.md#check-plans-against-your-code).
- Every setting, and where it lives: see [Settings](settings.md).
