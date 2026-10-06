# Agent tools and skills

Besides its model, each agent can use a few tools while it works: web search, reading your project's files, MCP tools you trust, and skills with extra instructions. You choose them agent by agent.

## Choose tools for an agent

1. Open **Team › Seats and models**, then **More settings**.
2. Press the **+** on an agent. Its **Skills, tools & habits** panel opens.
3. Tick the skills and tools you want that agent to have.
4. Choose **Apply changes** to save the team.

Each project's team, the Studio defaults and your saved team presets keep their own choices.

> <span class="status next">New in 0.5</span> The [setup helper](setup-helper.md)'s **Tools & skills** section holds the same choices for every agent. **Team › Skills** gives skills a page of their own, and **Team › Connectors** adds, approves, tests and imports MCP servers, local or online.

## Web search

**Search the web** is on by default for the assistant and the seats. Your search queries leave your PC, and answers can cite the links that come back. Bing search is built in. To use Brave Search instead, set `BRAVE_SEARCH_API_KEY` in Studio's environment.

Studio never downloads whole result pages. When a search fails, the agent is told it failed, so it can't pass it off as research.

## Read project files

**Read project files** is off by default. When you turn it on, the agent can read small text files, up to 32 KB each, inside the open project. Hidden files, credentials, Studio's local data, binary files and anything outside the project are refused. It's a small research tool, not a way to browse your whole disk or run commands.

## Skills

A skill is a folder holding a `SKILL.md` file of instructions. Studio finds skills in the `.agents/skills`, `.claude/skills`, `.codex/skills` and `.opencode/skills` folders of your project or your user folder.

To add one, put its folder there, or write one with **New skill** on **Team › Skills**. **How skills are used**, on the same page, decides for the **Chat**, the **Agents** and the **Builders** whether each skill is **Always on**, used **When it fits** or **Only when called**. You can also tick up to eight skills on one agent: after you add a folder, choose **Reload saved settings** on the Team page first. Skills guide how an agent answers: they never give it permission to do more.

## MCP tools

MCP servers are called connectors in Studio, and **Team › Connectors** is their home. **Add a connector** takes the command or address you'd type, and nothing runs until you approve it. **Approve and test** starts the server and finds its tools. **Import from other apps** brings in the servers Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex, OpenCode and Gemini CLI already use. Online servers work too.

**Who can use it** decides whether the chat, the helper agents or the builders get each connector. Values such as tokens are kept encrypted by Studio on this PC and never shown again. If a connector's command ever changes, Studio asks you again. For one agent, you can still tick tools under **MCP tool allowlist**, up to sixteen per agent. The [agent tools reference](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/agent-tools.md) has the details.

Ticking a tool trusts its server: it can read or change data with its own credentials. Check tools that write files, run commands or send messages before you allow them.

## Coding workers

OpenCode, Claude Code and Codex workers get Studio's search, project reads and the connectors you chose for builders on every run. OpenCode and Claude Code workers can also get **Studio desk · ask_desk**, which lets a stuck worker ask the desk agent for help. Grok and Antigravity keep their own tools.

These checkboxes only limit Studio's tools. A coding CLI also has its own tools, and Studio runs it with automatic approval and broad access to files and commands. Manage those tools in the CLI's own settings.

Studio's other agents get only the tools you tick. They can't write files or run commands unless an MCP tool you chose lets them.

> <span class="status next">New in 0.5</span> **Habits** give each agent short rules of behaviour, such as explaining its changes, testing, working in small steps, matching the code around it, the shape of its report and keeping a to-do list. Each habit is off, brief or full, and the panel shows how many tokens they add to every prompt.

## Other tools in Studio

Looking for Studio's own views rather than the agents' tools?

- **Sessions**, **Activity and evidence** and **Overhead** are under **Team › Inspect**: see [The Map](command-center.md#other-live-views).
- **Trace**, the performance profiler and the Connection log: see [Trace, logs and diagnostics](trace.md).
- **Analyzer** compares your plans with your code: see [Plans and ideas](planning.md#check-plans-against-your-code).
- Every setting, and where it lives: see [Settings](settings.md).
