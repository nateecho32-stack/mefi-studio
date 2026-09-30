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
Studio search, web page reads, project reads, selected MCP tools and, for
builders only, `run_check` and `project_logs` (below); OpenCode
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

## Checks and logs for builders (`run_check`, `project_logs`)

Two tools exist only for the **builder** role, the coding workers above. They
are never offered to chat, planning, the companion, scout, overseer, lead, desk
or any other role, and the host refuses a call for them from any other role
even when a model asks. They ride the same per-run attachment as the tools
above, so a worker sees them in its own tool list.

- **`run_check { id }`** runs one of the checks the project already has and
  returns its result (`ok`, `warn`, `bad` or `skipped`, a short detail, the
  time) with the last lines of its output. An id the project does not have
  answers with the ones it does have. It is advisory: a result never decides
  whether a task is done and never changes a task.
- **`project_logs { lines }`** returns the last `lines` (1 to 200, default 60)
  of the output of the project's preview or dev server *as Studio captured it*.
  Studio starts and owns the preview (a builder is told not to start a server
  itself), so this is how a builder reads its output. When Studio has captured
  nothing (no preview started by Studio, or one that printed nothing) it says
  so instead of guessing.

**What a project has.** Studio reads the folder, never a model, to decide:

| id | Found from | Runs |
| --- | --- | --- |
| `typecheck` | a `package.json` script named `typecheck`, `type-check`, `check:types`, `tsc`, `test:types` or `types` (first in that order) | `npm run <script>` |
| `lint` | a script named `lint`, `lint:check` or `eslint`; never one that fixes files (`--fix`, `--write`) | `npm run <script>` |
| `build` | a script named `build`; it writes files, so it does not run on its own | `npm run build` |
| `ruff` | `ruff.toml`, `.ruff.toml` or `[tool.ruff]` in `pyproject.toml` | `ruff check .` |
| `mypy` | `mypy.ini`, `[tool.mypy]` or `[mypy]` in `setup.cfg` | `mypy .` |
| `cargo-check` | `Cargo.toml`; not run on its own (it compiles) | `cargo check --message-format short` |
| `go-vet` | `go.mod` | `go vet ./...` |

A tool call names an id and nothing else: the command always comes from this
table, so a model cannot ask for a command of its own. Only these programs are
started (npm, ruff, mypy, cargo, go), without a shell where one can be avoided
(npm is a `.cmd` file on Windows, so it goes through `cmd.exe` with a command
line built from the checked words), in the run's own folder, with no input,
with Studio's own credentials withheld from the environment
(`scripts/platform.cjs`), and at most two checks at a time. A check that runs
longer than 120 seconds (90 for a builder's call) is ended together with
everything it started and reads as a warning ("Stopped after ..."), not as a
failure. Output is kept only from its end, up to 256 KB while it runs, then
4,000 characters for a builder or 1,500 for the page, with colour codes
removed and anything that looks like a credential masked. Results are labelled
untrusted project output.

**Turning it off.** `MEFI_STUDIO_NO_ADVISORY_CHECKS=1` removes both tools from
every list, refuses the calls and stops the checks that run on their own.
The same is Settings' `review.advisory` (on by default); `review.advisoryBuild`
(off by default) lets the build join the checks that run by themselves. A run
that started with the setting off keeps its own tool list until it ends.

`project_logs` reads a file that goes with the run: Studio writes the last 200
lines it captured into `preview.log` in the run's private tool folder (mode
0600, replaced whole whenever the preview prints something, deleted when the
run ends). Lines are cleaned of colour codes and of URL parameters, private
keys never enter it, and credentials are masked again when they are read.

**After an attempt.** The checks the project has (typecheck and lint; the build
only when `review.advisoryBuild` is on) also run by themselves once a builder's
attempt ends, in the folder it worked in, when it changed something and the
owner did not stop it. The results are kept with the attempt's before and after
shots in the project's data folder (`attempt-evidence/<task>/<n>/checks.json`;
never in the repository and never in a problem report) and appear under **Tasks
› a task › Evidence › Changes and checks › Checks** as "Advisory, never blocks
Done". They never change a task, and a run is not held for them: a worktree
run's merge-back waits for them (they read its own checkout) for six minutes at
most, nothing else waits at all. See docs/architecture.md "Attempt review".
