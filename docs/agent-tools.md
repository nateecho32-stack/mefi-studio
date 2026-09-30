# Agent skills, web search, web pages and MCP

Open **Agents → Setup**, then the **+** on a role. Each role can select its
own installed skills, web search, web page reads, project file reads and
individual MCP tools.
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
Neither search backend downloads the result pages; reading a page is the
separate `web_read` tool below. Search failures are returned to the agent
explicitly, never presented as successful research.

## Reading web pages (`web_read`)

**Read web pages you link** is on by default wherever search is, and has its
own switch. It lets chat, Vibe sizing, Plans and the other assistant roles read
a page you paste (or one a search returned), so "what's planned on
https://…/roadmap.html?" works without a coding worker. The page is fetched
from this computer:

- Only `http://` and `https://` addresses, and none with a user name or
  password in them.
- The host name is resolved first and refused when any address is loopback,
  private (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10),
  carrier-grade NAT (100.64/10), unique-local IPv6 (fc00::/7), unspecified
  (`0.0.0.0`, `::`), multicast or reserved, or a cloud metadata address;
  `localhost`, `*.local` and `*.internal` names are refused by name, and so
  is any address this PC's own network adapters hold (a public IPv6 address
  reaches services bound to every interface). Studio runs local services, so
  this is checked again when the connection opens: a name that re-resolves to
  a local address between the check and the connection is refused too.
- Only links the agent was given: a link named in the request (for chat, that
  includes the conversation it is shown, earlier replies too), a search
  result's link, and a page already read with its JSON files. Links inside a
  page are not opened, and an address the model makes up is refused, so it
  cannot put your data in a URL of its own. Search queries still leave the PC,
  as the search switch says.
- Redirects are followed by Studio itself, at most five, and every hop is
  checked the same way.
- 15 seconds for the whole read, 512 KB of body at most, and only
  `text/html`, `application/json`, `text/plain` and `text/markdown`.
- No cookies, no stored logins and none of Studio's keys are sent; the
  request carries only Accept, Accept-Encoding and a plain User-Agent.

HTML becomes text: scripts, styles, SVG and comments are dropped, `<noscript>`
content is kept, whitespace is collapsed and the `<title>` (and a meta
description) is returned alongside. When a page built by JavaScript has little
visible text, Studio follows up to three of the page's own same-origin JSON
files, found in `data-*` attributes, `<link rel="alternate"
type="application/json">` or `fetch("….json")` strings in inline scripts, under
the same limits. The result names the final URL, is marked as untrusted page
data, and holds about 9,000 characters of text; a longer page comes in parts
(`part` and `parts` in the result), and the agent reads on by asking for a
higher `part`, within the usual tool budget.

## The tool loop

Studio's tool loop works with HTTP model routes and the tool-disabled Claude
reply CLI. It requests a JSON tool envelope for intermediate turns, executes
the request in the host and returns to the original final answer format. This
does not require provider-native function calling. There are at most four tool
rounds, eight tool calls and three calls per round, followed by a final answer.
An envelope is found anywhere in a reply: inside a code fence, repeated, or
with stray text before or after it (identical calls in one reply run once).
Calls past the per-round or total cap are skipped and the model is told so.
A reply that still asks for tools when the budget is spent, or whose envelope
does not parse, is never shown as the answer: the model gets one more turn
without tools to give its final answer, and if that reply asks for tools again
the call fails with a plain error. Every model round still passes the provider
usage tracker and fallback handling. Tool results are bounded, scrubbed by the
host's outbound filter, and labelled untrusted. The application log records
tool names and success/failure, without arguments or results.

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

OpenCode, Claude Code and Codex receive a per-run MCP attachment exposing
Studio search, web page reads, project reads and selected MCP tools; OpenCode
and Claude Code also take the optional desk tool. OpenCode reads its config file through
`OPENCODE_CONFIG` and Claude Code through `--mcp-config`; Codex has no
per-run config file flag, so the server is passed as `-c mcp_servers.*`
overrides (TOML literal strings, quoted for `cmd.exe`). Those overrides are
on Codex's command line, which other processes can list, so a server whose
environment names a credential (the desk's token) is never passed there, and
the log names any server left out. A temp folder whose path holds a space or
an apostrophe works for all three. Temporary configurations are cleaned up
when the attempt ends or is canceled. Grok and Antigravity have no per-run MCP
flag and retain their own native tool and search configuration; Studio does
not inject its tool bridge into them.

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
