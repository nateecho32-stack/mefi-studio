# Agent skills, web search and MCP

Open **Agents → Setup**, then the **+** on a role. Each role can select its
own installed skills, web search, project file reads and individual MCP tools.
Save the team to apply the draft. Project teams, Studio defaults, presets and
captured attempts retain these choices separately. Skills provide instructions;
they do not grant permissions. Up to eight skills and sixteen MCP tools can be
selected per role.

Web search is available by default to routine/heavy calls, the companion, desk,
lead, scout and overseer. Planning, ideas, analyzer and support calls use their
assigned role's policy. Connectivity probes and the short internal scout
classifier remain single calls. The shared reference lookup uses the same search
backend. Search queries leave the device; results include titles, excerpts and
source URLs. Bing's public RSS search requires no key, but can be unavailable or
rate limited. Set `BRAVE_SEARCH_API_KEY` in Studio's process environment to use
the [Brave Search API](https://api-dashboard.search.brave.com/app/documentation/web-search).
Neither backend downloads arbitrary result pages. Search failures are returned
to the agent explicitly, never presented as successful research.

Studio's tool loop works with HTTP model routes and the tool-disabled Claude
reply CLI. It requests a JSON tool envelope for intermediate turns, executes
the request in the host and returns to the original final answer format. This
does not require provider-native function calling. There are at most four tool
rounds, eight tool calls and three calls per round, followed by a final answer.
Models must support following this protocol; malformed requests and exhausted
budgets fail visibly. Every model round still passes the provider usage tracker
and fallback handling. Tool results are bounded, scrubbed by the host's outbound
filter, and labelled untrusted. The application log records tool names and
success/failure, without arguments or results.

Project reads are off by default. Enabling them allows text files up to 32 KB
inside the selected project. Traversal, symlinks outside the project, hidden
paths, `data`, `dist`, `node_modules`, common credential files, binary files and
alternate data streams are rejected. This is a limited research tool, not a
general filesystem or shell interface.

## Register a trusted MCP server

Create `~/.mefi-studio/mcp.json` in your user home directory. This is a device
configuration, outside project repositories and exported team presets. It is
not read from a project's `.mcp.json`. Example (replace the command and script
with your installed server):

```json
{
  "servers": {
    "docs": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/Tools/docs-server/server.js"],
      "envKeys": ["DOCS_API_KEY"],
      "tools": [
        {
          "name": "search_docs",
          "description": "Search the documentation index",
          "inputSchema": {
            "type": "object",
            "properties": { "query": { "type": "string" } },
            "required": ["query"]
          }
        }
      ]
    }
  }
}
```

Reload saved settings, select `docs · search_docs` on the intended role and
save. Declarations should match the server's tool names and argument schemas.
Listing the setup screen never starts a server. A selected tool call starts
the configured executable without a shell, initializes MCP, verifies the tool
through `tools/list`, calls it and closes the connection. Calls time out after
20 seconds and server output is capped. Pagination is supported for up to eight
tool-list pages. MCP client sampling, elicitation, resources, OAuth and remote
HTTP/SSE transports are not implemented; this integration supports
[stdio MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
Use a real executable such as `node.exe`, not a Windows `.cmd` launcher.

Only basic process variables and explicitly named `envKeys` are forwarded.
Secrets belong in the device environment, never in the tool descriptions or
team configuration. Selecting a tool trusts its server executable and allows
its side effects; MCP is not an operating-system sandbox. Review tools that can
write, run commands or send messages before selecting them. Removed/unselected
tools are denied by the host even if a model asks for them.

## Coding workers

OpenCode and Claude Code receive a per-run MCP attachment exposing Studio
search, project reads and selected MCP tools alongside the optional desk tool.
Temporary configurations are cleaned up when the attempt ends or is canceled.
Other coding CLIs retain their own native tool and search configuration; Studio
does not inject its tool bridge into them.

**The Studio checkboxes do not restrict native coding CLI tools.** Existing
workers run with automatic approvals and broad command/file access. Configure
native CLI permissions and MCP servers in that CLI; the setup UI explicitly
shows this distinction. Tool-less Studio agents have no built-in write or shell
tool, but an explicitly selected MCP server can provide those capabilities.

Skills are discovered from project/user `.agents/skills`, `.claude/skills`,
`.codex/skills` and `.opencode/skills` (user OpenCode uses
`.config/opencode/skills`). Add a named folder containing `SKILL.md`, reload
saved settings and choose it on the agent. Selected skills are capped at 16 KB
of prompt content; oversized or unavailable entries are skipped.
