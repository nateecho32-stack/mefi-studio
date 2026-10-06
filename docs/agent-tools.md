# Agent skills, web search, web pages and MCP

Open **Team › Seats and models** (Agents › Setup in the classic layout), then
the **+** on a role. Each role can select its own installed skills, web search,
web page reads, project file reads and individual MCP tools. How every skill is
used in the chat, by the helper agents and by the builders is on the Skills
page (below); connectors are on **Team › Connectors**.
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

## How skills are used

A skill is instructions in a `SKILL.md` (the Skills page, `.agents/skills`, or
another tool's folder). Studio also ships **answer styles**, skills of its own:
Explain like I'm 5 (`eli5`), Short answers (`brief`), Teach me (`teach-me`),
Brainstorm (`brainstorm`), Poke holes (`poke-holes`) and Expert (`expert`). A
style changes how an agent says things, never what it does or claims.

Each skill is used one of three ways, separately in three places:

| | Always on | When it fits | Only when called |
| --- | --- | --- | --- |
| What happens | Its text is in every request there | Its name and description are listed; the model loads it with `use_skill` when a request matches | Only when `/name` appears in a chat message, or in a task's own words for that task's builder |
| **Chat** (the companion) | ELI5, until you pick another style | Every skill of 16,000 characters or less | The other styles, and bigger skills |
| **Agents** (planning, sizing, reviews, the desk, the overseer, the scout) | nothing | Every skill of 16,000 characters or less | Styles, and bigger skills |
| **Builders** (Claude Code, Codex, OpenCode, Studio's builder prompt) | nothing | Every skill of 16,000 characters or less | Styles, and bigger skills |

The table's middle rows are the defaults. Change them on the Skills page's
**How skills are used** section (one row per skill, a choice per place, and a
"picks skills by itself" switch per place: off, every "When it fits" there acts
as "Only when called"), or the chat's style from the chip beside the message
box. Choices are kept by skill name in `settings.skillUse`, only what differs
from the default, so a choice follows a skill of that name into every project.
A name resolves the project's skill first, then the home folder's, then
Studio's own: a project's `eli5` replaces Studio's, and **Copy to this
project** writes the built-in one there to edit. The team's own per-agent picks
(the **+** on a seat) still apply on top, always on for that agent.

Budgets: always-on skills share 16,000 characters and eight skills per request
with the team's picks; the list a model may load from holds at most 24 skills
with descriptions cut to 160 characters (about 4,000 characters); one answer
loads at most 16,000 characters with `use_skill`. A loaded skill is the owner's
own instructions, so it goes beside the system prompt, not into the untrusted
tool transcript, and a model can load only a skill it was offered.

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
The calls one reply asks for run side by side, and their results go into the
transcript in the order they were asked for. `use_skill` is the one tool whose
result is not transcript: a loaded skill joins the instructions (see "How skills
are used"), and the transcript only notes that it was loaded. A connector's
answer is shown to the model as its text, with each picture or audio part named
and sized instead of pasted.
A reply that still asks for tools when the budget is spent, or whose envelope
does not parse, is never shown as the answer: the model gets one more turn
without tools to give its final answer, and if that reply asks for tools again
the call fails with a plain error. Every model round still passes the provider
usage tracker and fallback handling. Tool results are bounded, scrubbed by the
host's outbound filter, and labelled untrusted. The application log records
tool names and success/failure, without arguments or results.

While the prompt cache is on (`settings.ai.promptCache`, `MEFI_STUDIO_PROMPT_CACHE`)
the system prompt is the same bytes every round and the tool transcript rides
at the end of the user's text, so a provider that caches prompt prefixes reads
the earlier round, the user's whole message included, from its cache; a message
with pictures keeps the transcript in the system prompt. A Zen `gpt-*` call
also names its cache (`prompt_cache_key`, a hash of the role, model and start
of the system prompt, never its text) and an OpenRouter Claude or Gemini call
marks its system prompt cacheable (`cache_control`); a provider that answers
HTTP 400 naming either option has it off until Studio restarts, and that call
is sent once more without it. Cached input is read from each provider's usage
(OpenAI's `cached_tokens`, DeepSeek's hit count, Anthropic's cache reads and
writes) into the usage tracker's `cacheReadTokens` and `cacheWriteTokens`.

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

## Connectors (MCP servers)

A connector is an [MCP](https://modelcontextprotocol.io/) server that gives
agents extra tools, like a browser or GitHub. They are kept in
`~/.mefi-studio/mcp.json` in your user home folder: a device configuration,
outside project repositories and exported team presets, and never read from a
project's `.mcp.json` by itself.

**Team › Connectors** manages the file:

- **Add a connector**: a name and the command, the way you would type it
  (`npx -y @playwright/mcp@latest`; quotes keep spaces, nothing runs through a
  shell), or an `https://` address (plain `http://` only on this PC). List the
  settings it needs (`GITHUB_PERSONAL_ACCESS_TOKEN`) and, if you like, their
  values. It goes into the file as `pending`.
- **Review and approve**: Studio shows exactly what it would run and approves
  that, stamped with a fingerprint of the command, its arguments, its settings'
  names and its address. Studio never starts a connector you have not approved,
  and if any of those change (by hand, or by another app) it waits for your
  approval again. A server you wrote into the file yourself, with no approval
  stamp, is your own act and is used as it always was.
- **Test**: starts it, asks for its tools (up to eight pages), saves them and
  stops it. Nothing has to be declared by hand any more; a tool whose name
  Studio can't use (letters, numbers, `_` and `-`, up to 48) is left out and
  counted.
- **Who can use it**: Chat, Agents and Builders, each a switch. A new connector
  is on for the builders only. Each tool can be turned off on its own, and the
  whole connector switched off.
- **Import from other apps**: lists the servers configured by Claude Code
  (`~/.claude.json`, including the open project's entry), Claude Desktop,
  Cursor, VS Code, Windsurf, Codex (`~/.codex/config.toml`), OpenCode and
  Gemini CLI, plus the open project's `.mcp.json`, `.vscode/mcp.json` and
  `.cursor/mcp.json`. Nothing loads by itself: picked ones arrive pending. A
  value those apps saved (a token) comes along only when you tick "Bring their
  saved values too"; a placeholder such as `${env:TOKEN}` is never a value. The
  older SSE-only servers are listed but can't be imported.
- **Featured**: Playwright, Context7, GitHub, Memory and Step-by-step thinking,
  each one command to read before you approve it.
- **Remove** keeps a copy of the file first (`connector-backups/` in Studio's
  data folder, ten copies).

**Values.** A value a connector needs is kept encrypted with Windows' data
protection (Electron `safeStorage`) in `connector-secrets.json` in Studio's data
folder, never in `mcp.json` and never sent back to the page, which only shows
whether one is saved. A setting with no saved value is read from Studio's own
environment (as `envKeys` always were), and Studio's GitHub sign-in stands in
for `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_TOKEN` and `GH_TOKEN`. A PC that
can't encrypt refuses to save a value and says to set it in Windows instead.
Only basic process variables, the named settings and their values reach a
server; Studio's provider keys never do.

**Who gets which tools.** An agent gets the connector tools its team picked for
it (the **+** on its seat), then every tool of each connector that is on for
its place, sixteen at most; the page shows how many each place gets. The host
refuses a tool an agent was not given, whatever a model asks.

**Calls.** Studio's own models keep a connector's server open between calls
and let it go after three quiet minutes, when its definition changes, after a
call that timed out, and when Studio quits (at most four open). A coding
worker's tool server keeps one open for the length of its run. So a stateful
server works: a browser a builder opened is still there for its next click.
A call waits up to a minute; starting a server, 30 seconds (Test allows two
minutes, for a first `npx` download). Output is capped at 4 MB a message.
Streamable HTTP servers (MCP 2025-03-26 and later) are supported, with
`Mcp-Session-Id` sessions and server-sent events; a header such as
`Authorization` is filled from a saved value (`headerKeys`). MCP sampling,
elicitation, resources and OAuth sign-in are not implemented.

The file, for reference (everything but `command`/`args` or `url` is
optional; Studio writes the rest):

```json
{
  "servers": {
    "docs": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/Tools/docs-server/server.js"],
      "envKeys": ["DOCS_API_KEY"],
      "places": ["builders", "chat"],
      "off": ["delete_page"],
      "tools": [{ "name": "search_docs", "description": "Search the documentation index", "inputSchema": { "type": "object" } }]
    },
    "remote": { "transport": "http", "url": "https://mcp.example.com/mcp", "headerKeys": { "Authorization": "REMOTE_AUTH" } }
  }
}
```

Selecting a connector trusts its program and allows its side effects; MCP is
not an operating-system sandbox. Review tools that can write, run commands or
send messages before turning them on. `MEFI_STUDIO_NO_CONNECTORS=1` makes Team ›
Connectors read-only: nothing is added, approved, tested, changed or imported,
and the servers already in the file are used as before.

## Coding workers

OpenCode, Claude Code and Codex receive a per-run MCP attachment exposing
Studio search, web page reads, project reads (not the list and search tools
above: a coding worker has its own), `use_skill` for the skills builders may
pick by themselves, the connector tools settled when the run starts (the
team's picks, then the connectors on for builders, sixteen at most) and, for
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

The values those connectors need ride the run's private policy file (mode
0600, gone when the run ends), like the desk's token, never Codex's command
line. The run's tool server keeps each connector's server open until the run
ends, and passes a connector's pictures on as pictures (at most four of 2 MB
each, text cut at 12,000 characters).

**The Studio checkboxes do not restrict native coding CLI tools.** Existing
workers run with automatic approvals and broad command/file access. Configure
native CLI permissions and MCP servers in that CLI; the setup UI explicitly
shows this distinction. Tool-less Studio agents have no built-in write or shell
tool, but an explicitly selected MCP server can provide those capabilities.

Skills are discovered from project/user `.agents/skills`, `.claude/skills`,
`.codex/skills` and `.opencode/skills` (user OpenCode uses
`.config/opencode/skills`), plus the answer styles built into Studio. Add a
named folder containing `SKILL.md`; by default an agent picks it by itself when
it fits ("How skills are used"), or choose it on the agent to have it always
on there. Always-on skills are capped at 16 KB of prompt content; oversized or
unavailable entries are skipped. A task whose words say `/skill-name` gives its
builder that skill too.

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
