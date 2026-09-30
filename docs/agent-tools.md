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
paths, `data`, `dist`, `node_modules`, keys and databases, files whose names say
they hold credentials, binary files and alternate data streams are rejected.
This is a limited research tool, not a general filesystem or shell interface.

## Listing and searching project files (`project_list`, `project_search`)

**Read project files** is one switch for three tools. Wherever a role may read a
file, Studio's own models can also list a folder and search the project's text
files, so "where is the login handled?" needs no guessing at file names. They
are read-only, pure Node (no shell, no `ripgrep`, no `git`), and only for
Studio's own models: Claude Code, Codex and OpenCode have their own file tools,
and the tool server they are given never offers these two.

`project_list` takes `path` (a folder, default the project's own), `depth` (1 to
3) and `limit` (up to 300) and returns `{ path, entries: [{ path, type, bytes }] }`
folders first, then files, each in name order. `type` is `dir`, `file`,
`binary` (by its extension, or a NUL byte in its first bytes) or `link`;
paths are from the project's folder, ready for `project_read`.

`project_search` takes `query` (1 to 300 characters, matched within a single
line) and returns the matching lines as `results: [{ file, matches: [{ line, text, before, after }] }]` with
`matches`, `files` and `searched` counts. The query is literal text unless
`regex` is true (a JavaScript regular expression); both ignore case unless
`caseSensitive` is true. `path` narrows it to a folder or one file, `glob`
narrows it by name (`*.ts` at any depth, `src/**/*.js` from the project's
folder, `{a,b}` for alternatives, `!` to exclude), `context` (0 to 3) adds lines
around each match, `maxResults` (default 30, at most 100) and `perFile` (default
5, at most 20) cap what comes back. A file with more matches than `perFile` is
marked `more`.

What they leave out, always:

- Anything `.gitignore` says (the project's own, each folder's, and
  `.git/info/exclude`), with `!` bringing a name back, as git reads it.
- Hidden files and folders (which covers `.env`, `.git` and Studio's own
  `.mefi` worktrees, so a task run's copy of the same file is never found
  twice), `data`, `dist` and `node_modules` at any depth, keys and stores by
  name (`*.pem`, `*.key`, `*.p12`, `id_rsa`, `*.db`, `*.sqlite`, `*.tfstate`),
  and data files whose names say they hold secrets (`secrets.yaml`,
  `db-password.txt`, `token.json`, `credentials.json`). Source called
  `token.ts` or `password.py` is code and stays. A file that opens with a
  private-key header on a line of its own is skipped whatever it is called.
  These are never opened, named or returned; the answer only counts them
  (`skipped.private`).
- `coverage`, `__pycache__` and `bower_components` anywhere, and `build`, `out`,
  `target`, `vendor`, `venv`, `env`, `tmp`, `temp`, `logs` and `cache` at the top
  of the project (a source folder called `cache` lower down stays). An ignored
  or noisy folder can still be named as the `path`; the rules below it apply.
- Binary files, files over 512 KB and files that cannot be read (counted as
  `skipped.binary`, `large`, `unreadable`, never returned). UTF-16 text has NUL
  bytes, so it counts as binary.
- Symbolic links and junctions: a listing shows a `link`, and nothing follows it.

What they refuse: a `path` outside the project or on the private list, in
every spelling and on every platform: absolute, drive-letter, network (`\\server`),
`\\?\` and `..` forms, alternate data streams (`name:stream`), Windows device
names (`CON`, `NUL`, `COM1`...), wildcards, control characters, and a link that
resolves outside the project or onto a private folder. Refusals are tool
errors the model reads, like a regular expression that does not compile, one
that matches the empty line (it would match every line), or one that backtracks
without end: patterns run in a sandbox with a 250 ms limit per file and the
call is stopped with "too slow to run safely". A `.gitignore` or a `glob` is
matched by a plain wildcard walk, never compiled into a regular expression, so
a hostile one costs time, not a hang.

Limits: one call returns at most 10,000 characters of JSON, so a result is
never cut inside itself by the tool loop's 12,000-character slice; it stops and
says why in `note` (`truncated: true`). A search reads at most 5,000 files, 24
MB and 10 seconds, and looks at no more than 20,000 folder entries; a line is
read to 4,000 characters and shown as a 200-character excerpt around the match.
Every result line is masked like everything Studio sends a model: credentials
and home folders are replaced. Results are untrusted project data, like a
file's text.

`MEFI_STUDIO_NO_PROJECT_SEARCH=1` removes both tools and leaves `project_read`.

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
Studio search, web page reads, project reads (not the list and search tools
above: a coding worker has its own) and selected MCP tools; OpenCode
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
