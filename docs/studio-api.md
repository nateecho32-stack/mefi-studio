# Other apps: the Studio API

Claude Code, Codex, Cursor, Claude Desktop or your own scripts can talk to
Mefi's Studio AI+ on the same PC. They can see what Studio's agents are doing,
message Mefi, hand Studio a task and leave you a note. And when you want help
setting Studio up, one button copies a prompt that tells those helpers where
Studio is on this PC.

Both live in **Settings › Other apps**.

## Get help setting up

**Copy setup prompt** puts a prompt on the clipboard. Paste it into Claude
Code, Codex or any AI helper. It holds:

- where Studio is on this PC: its folder (the portable app's folder, or the
  source checkout), its app files, its settings and data folder, and the
  project that is open;
- the version and Windows build;
- what to read first (README, GETTING_STARTED, and the architecture and this
  page, from the folder or from GitHub for a portable build);
- what to help with (check Git, Node, the GitHub CLI and the coding CLIs;
  connect an AI and a builder; open a first project; read the log when
  something fails);
- ground rules: never open, print or copy your keys (`auth.json`, `.env`,
  tokens), change Studio's settings in Studio's own screens, ask before
  installing anything, leave the data folder alone;
- when the Studio API is on, the commands that connect the helper to Studio.

The prompt holds no keys. The setup helper's first page has the same button
(**Want a hand?**). Before Studio runs at all, GETTING_STARTED.md has a version
of the prompt that finds the folder itself.

## Let apps reach Studio

**Let apps on this PC talk to Studio** is off until you turn it on. On:

- Studio listens on `127.0.0.1` only, on port 47615, or on any free port when
  another program holds that one. Nothing outside this PC can reach it.
- It writes the address and a random key to
  `~/.mefi-studio/studio-api.json`, beside the connectors' `mcp.json`. Apps
  read the key from there at every call. The key stays the same across
  restarts, so a script you set up keeps working. **New key** replaces it at
  once. **Show key file** opens its folder.
- Turning the switch off closes the endpoint and deletes the key file.
- `MEFI_STUDIO_NO_APP_API=1` keeps it closed for one run, whatever the switch
  says.

### What an app may do

An app has the same narrower powers as a message from Discord
([remote.md](remote.md)):

| It can | It can't |
| --- | --- |
| See status, what needs you and what was made | Approve work or answer Studio's questions |
| Message Mefi, who can file tasks, leave notes, pause and resume | Change settings, permissions, keys or sharing |
| File a task on the open project | Start work without your OK |
| Show you a note | Reach Studio from another PC or from a web page |

**Every task an app files waits for your OK, in every permission mode.** So do
its split and delegated slices. Studio marks them `origin.via = "app"`, and
`autonomy.remoteWork` holds them as it holds Discord's. You approve them in
Studio. The reason: builders run with their CLI's permission checks off, and
an AI helper that read a hostile file must not be able to start code on your
PC on its own.

A message an app sends shows in Mefi's thread under the app's name
("Claude Code (app)", "· from Codex"), not as "You".

## Connect an app

The card shows these commands with this PC's paths filled in. A portable build
runs `studio-link.mjs` with Studio's own program as Node
(`ELECTRON_RUN_AS_NODE=1`), so the PC needs no Node install; a source checkout
uses `node`.

**Claude Code** (once, in any terminal):

```bash
claude mcp add --scope user mefi-studio -e ELECTRON_RUN_AS_NODE=1 -- "<Studio folder>/Mefi Studio AI+.exe" "<Studio folder>/resources/app/scripts/studio-link.mjs" mcp
```

**Codex**:

```bash
codex mcp add mefi-studio --env ELECTRON_RUN_AS_NODE=1 -- "<Studio folder>/Mefi Studio AI+.exe" "<Studio folder>/resources/app/scripts/studio-link.mjs" mcp
```

**Cursor, Claude Desktop, VS Code and other MCP apps**: add the JSON the card
shows to the app's MCP servers (`mcpServers.mefi-studio`).

**Claude Code skill**: **Save to Claude Code** writes
`~/.claude/skills/mefi-studio/SKILL.md`, which tells Claude Code when to use
Studio and how, with or without the MCP tools. Studio writes over that file
only when it is Studio's own copy.

### The MCP tools

| Tool | Does |
| --- | --- |
| `studio_status` | The open project, what the agents are building, how many things wait on you |
| `studio_needs` | What waits on you (read-only) |
| `studio_made` | Built now, finished or stopped today |
| `studio_message` | A message to Mefi; returns the reply (up to about three minutes) |
| `studio_add_task` | `title`, `detail`: a task on the open project, held for your OK |
| `studio_notify` | `text`, `title`, `level` (info, done, warn): a note shown in Studio |
| `studio_setup_info` | Studio's folders, version, docs and the setup prompt |
| `studio_control` | `action`: pause or resume the agents |

The MCP client's own name (`claude-code`, `codex-mcp-client`…) names it in the
card's **Recent calls**.

### The command line

The same file is a command line, for scripts, Claude Code hooks, Stream Deck
buttons and the like:

```bash
node scripts/studio-link.mjs status
node scripts/studio-link.mjs needs
node scripts/studio-link.mjs made
node scripts/studio-link.mjs say "Add a dark mode toggle"
echo "a longer message" | node scripts/studio-link.mjs say -
node scripts/studio-link.mjs task "Add search" --detail "Fuzzy, over titles"
node scripts/studio-link.mjs notify "Nightly build finished" --level done
node scripts/studio-link.mjs pause
node scripts/studio-link.mjs resume
node scripts/studio-link.mjs setup
node scripts/studio-link.mjs skill
```

`--json` prints the whole answer, `--app <name>` (or `MEFI_STUDIO_APP`) names
the caller. It exits 0 when Studio did it, 1 when Studio refused or was not
reachable, and 2 for a mistake in the command.

For example, a Claude Code `Stop` hook that tells you in Studio when a session
finishes:

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "node \"<Studio folder>/scripts/studio-link.mjs\" notify \"Claude Code finished\" --level done --app \"Claude Code\"" }] }] } }
```

## HTTP

Any program can call the endpoint itself. Send the key from the key file as
`Authorization: Bearer <key>` (or `X-Mefi-Token`), and name yourself with
`X-Mefi-App`. Bodies are JSON objects up to 64 KB. Every answer is
`{ ok, text, data? }` (or `{ ok: false, error }`), and `text` is written to be
shown as it is.

| Method | Path | Body | Answer |
| --- | --- | --- | --- |
| GET | `/v1/hello` | | version, open project, the routes |
| GET | `/v1/status` | | `data`: project, state, headline, working, needsYou, done, failed |
| GET | `/v1/needs` | | `data`: total, items (kind, title, taskId, choices) |
| GET | `/v1/made` | | `data`: working, done, failed (titles) |
| POST | `/v1/say` | `text` (up to 8000) | Mefi's reply; `data`: reply, results |
| POST | `/v1/tasks` | `title` (one line, up to 90), `detail` | `data`: created, id, title, waitsForOk (or existing) |
| POST | `/v1/notify` | `text` (up to 400), `title`, `level` | shown in Studio |
| POST | `/v1/pause` | | |
| POST | `/v1/resume` | | |
| GET | `/v1/setup` | | the setup prompt; `data`: folders, docs, version, link commands, skill |

PowerShell, with nothing installed:

```powershell
$s = Get-Content "$HOME/.mefi-studio/studio-api.json" | ConvertFrom-Json
Invoke-RestMethod "$($s.url)/v1/status" -Headers @{ Authorization = "Bearer $($s.token)" }
```

Status codes: 400 a body Studio can't use, 401 no key or a wrong one, 403 a
call from a web page, 404 and 405 a wrong path or method, 409 no project open,
413 a body over 64 KB, 421 a Host other than `127.0.0.1` or `localhost`, 429
too many calls (120 a minute, 12 that start work: messages and tasks).

## Safety

- **Loopback only.** The endpoint binds `127.0.0.1`. It refuses a Host header
  that is not `127.0.0.1:<port>` or `localhost:<port>`, which stops a web page
  that points its own name at this PC (DNS rebinding).
- **No web pages.** A request with an `Origin` header or a `Sec-Fetch-Site`
  other than `none` is refused, and the endpoint sends no CORS headers.
- **A key.** Compared in constant time. It lives in your user folder, where
  only programs running as you can read it, as the CLIs' own sign-ins do.
- **Less power than you.** The chat gate and the approval hold above.
- **Nothing kept.** The card's log keeps who called and which route, never
  the words. The calls also land in Studio's log (`[studio-api]` lines).

## Where it lives

- `scripts/studio-api.cjs`: the rules (routes, checks, answers, the connect
  commands, the setup prompt, the skill). Pure.
- `scripts/studio-api-server.cjs`: the endpoint and the key file.
- `scripts/studio-link.mjs`: the MCP server and command line apps run. No
  dependencies.
- `main.cjs` "Other apps": the switch, the work behind each route, the
  `studio-api:*` channels and the `studio-api:event` / `studio-api:notice`
  pushes.
- `renderer/studio-api.js`: the Settings card, the toast for notes, and
  `MefiStudioApi.copyPrompt` for the setup helper.
- Tests: `tests/studio_api_rules.test.mjs`, `tests/studio_api_server.test.mjs`,
  `tests/studio_api_host.test.mjs`, plus the app cases in
  `tests/remote_gate.test.mjs` and `tests/remote_admission.test.mjs`.
