# Security

## What Studio does with your data

- **Keys stay on your machine.** API keys entered in Settings are encrypted
  with the OS keystore (DPAPI on Windows) inside
  `%APPDATA%\Mefi's Studio AI+\auth.json`, a credentials file kept separate
  from the `settings.json` preferences so the two never travel together. Only
  "key present / absent" status crosses into the renderer. Keys are bound to
  the Windows account that saved them and cannot be decrypted elsewhere. Apart
  from signing requests to the service a key belongs to, the one way a key
  leaves this PC is **Keys and setup** under Share between my PCs, which puts
  them, sealed, in your private vault for your own other PCs and takes a typed
  confirmation (below).
- **No telemetry, no hosted account.** Studio only talks to the providers and
  CLIs you connect (for model lists, also OpenRouter's public roster and, when
  you refresh the catalog, `opencode.ai` and `models.dev`); to GitHub, for the
  update check, for your project's own `origin` remote and, if you set it up,
  your private vault (the next three points); to `discord.com` if you choose
  to link a Discord account; to the Void Engine rooms hub if you give Studio
  its address; to a media service when you play or search a link from it, and
  to any site you open in the Media browser; and to Bing, or Brave when
  `BRAVE_SEARCH_API_KEY` is set, when an agent role uses its **Search the
  web** tool (on by default for each role; switch it off under Allowed Studio
  tools) or when you tick **Cite web references** in Plans. That search text
  leaves this PC. Each of these has its own point below.
- **Update check.** Every 20 minutes Studio asks GitHub's release API for the
  newest release of Studio's own repository: a plain request with a fixed user
  agent. It carries a GitHub token when Studio has one (a token saved in
  Settings, `MEFI_STUDIO_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`, or,
  failing those, the GitHub CLI's own login, which Studio reads with `gh auth
  token` and keeps in memory for the session), and so does the download of an
  update's files, which starts only when you press the update button.
- **Project sync (git and GitHub).** For the open project, when it is a Git
  repository with an `origin` remote (normally GitHub), Studio runs `git fetch
  origin --prune` 45 seconds after launch and every 15 minutes, and a small
  `git ls-remote` once a minute to see whether another PC has pushed. These
  looks run on their own and never move a branch. **Keep this PC up to date**
  (Friends › Your PCs, on by default) also fast-forwards the default branch
  (`git merge --ff-only`) after such a push, but only while that branch is
  checked out and this PC has nothing of its own in the way: no uncommitted,
  unpushed or stashed work, no changed worktree or local-only branch, and no
  builder running. So whatever is pushed to that branch, by your other PCs or
  by anyone else with push access, lands in the project folder within about a
  minute; turn the option off if you do not trust every pusher. Studio pushes
  the project only when you press **Sync this PC** (or **Put my commits on top
  of GitHub's**), or choose Push and close when you quit with work that only
  this PC has: a plain push of the default branch, never forced, and, when the
  project has an `npm run check` script, only after it passes (that script is
  the project's code and runs on your PC). It never creates a merge commit,
  stashes, switches branches or discards anything; putting your commits on top
  of GitHub's happens only when you ask, with nothing uncommitted, and is
  abandoned at the first conflict. Git runs with its own arguments, no shell
  and no terminal prompt, on whatever credentials your Git already has, and a
  login inside a remote URL is removed before any message is shown. **Set up
  this PC** can, one step at a time when you press it, install Git, the GitHub
  CLI or Node.js with winget, sign in with `gh auth login --web` (followed by
  `gh auth setup-git`, which makes the GitHub CLI Git's credential helper), and
  run `npm ci` or `npm install` in the project, each in a visible PowerShell
  window that downloads from the winget and npm sources; the page names a step
  and never supplies the command. It lists your repositories (`gh repo list`)
  when you choose one to clone. When a project's `docs/agents/issue-tracker.md`
  names GitHub as its tracker, Studio also reads its open issues (`gh issue
  list`) so Mefi can answer about them.
- **Share between my PCs is off until you make or join a vault** (Friends ›
  Your PCs › Share between my PCs; see also
  [docs/architecture.md](docs/architecture.md)). It needs the GitHub CLI
  signed in to your account and a working OS keystore. **Make my private
  vault** creates one private repository, `<your account>/mefi-studio-vault`,
  with `gh repo create --private`, and another of your PCs joins it with
  **Pair this PC** and the pairing code, which clones it. Every file in it
  except a plain manifest (the format, a fingerprint of the key and the
  creation time) and a README is sealed with AES-256-GCM under a 32-byte key
  made on the first PC, and a file's path is part of what its seal
  authenticates, so a file that was edited, swapped or moved fails to open.
  The key never goes into the repository or to GitHub: each PC keeps it
  through the OS keystore in `vault\vault-key.bin`. The pairing code is that
  key in readable form, so treat it like a key: it is shown when you make the
  vault and afterwards only when you press **Show pairing code**, and the page
  clears it when you hide it. What GitHub, and anyone else who can read the
  private repository, still sees is metadata: file names (the shelf, a random id
  per PC, and an item id that for a preset, an idea or a memory note can be
  built from its name), commit messages that carry this PC's name and the shelf,
  and when things changed. Once a PC is paired, its status line is sealed and
  refreshed at most every ten minutes, after a sync look and when its agents'
  line changes. It holds the PC's name, when, the GitHub repository names of the
  projects opened this session with how much work waits on this PC or behind
  GitHub, and what its agents are doing (the loop's state and headline, the open
  project's name, up to four task titles being built, up to three finished, and
  counts; text is clipped, not scrubbed). Nothing else goes unless you choose
  it: **Choose what to share** lists what a shelf offers from this PC (model
  results, what Mefi learned about how you work, team setups, brain maps,
  recipes, Claude Code memory notes, preferences without keys, and open tasks
  and kept ideas, on the shelf labelled Tasks, ideas and plans) and **Send to my
  PCs** seals only the items you pick. Every shelf except that last one is
  scrubbed first (paths, emails, addresses and this PC's names are replaced in
  the text), and every item is then checked, as Share with friends below
  describes; the tasks and ideas shelf is checked but not scrubbed, and an item
  the check stops is not sent. What another PC put there is reviewed again as
  received text, and an item that fails, or does not open, is quarantined and
  never used. Nothing received applies itself: **Use on this PC** adds it
  beside what you have (a team, brain map or recipe under a name that says
  where it came from, a note only where none has that name, an idea as a new
  idea that never starts work, preferences checked field by field, with the
  permission mode never switching off an ask that needs your confirmation).
  **Unpair this PC** forgets the key and the local copy on that PC only; the
  repository and your other PCs are untouched.
- **Keys and setup**, inside Share between my PCs, is the strict part. It
  offers the API keys and GitHub token Studio would use on this PC, whether
  saved in Settings or read from an environment variable, and your custom and
  LM Studio endpoint addresses. Sending them takes the exact confirmation
  phrase typed and a native warning. Their values are handled in the main
  process only, never reach the page, are neither scrubbed nor logged, and are
  sealed into one file. On the other PC, **Use these on this PC** asks again
  and saves each key through that PC's own keystore, replacing a key of the
  same kind. **Remove shared keys from the vault** deletes the file, but the
  sealed copy stays in the repository's history, so replace a key that may
  have leaked at its provider.
- **Share with friends is a file, not a connection** (Friends › Your PCs ›
  Share with friends). Studio writes one `.mefishare` file where you save it
  and sends it nowhere; how it reaches a friend is up to you. Only model
  results, team setups, brain maps, recipes, Claude Code memory notes and the
  preferences for how agents behave and learn can go this way: never tasks,
  decisions, keys, endpoint addresses or the permission mode. Those preferences
  leave out which providers, builders and models run; a team setup does name the
  ones it uses. The item is always scrubbed (keys, tokens, paths, emails,
  addresses and this PC's names are replaced in the text), names no repository
  and none of your PCs, and is then checked. Whatever the check still finds
  stops the share until you remove it: a key or password the scrub did not
  recognise, a login in a link, instructions aimed at an agent, or more text
  than the check can read. The preview shows the text as it would be saved (the
  first 4,000 characters of a long item; the check reads all of it). Opening a
  friend's file runs the same check on it as received text: a file that fails is
  quarantined and cannot be kept, and a kept item lands in your library,
  where **Use** adds it beside your own. Kept model results count as extra
  evidence when Studio learns which models suit which tasks, until you remove
  them. The check is pattern matching, not a guarantee, so read the preview
  before you keep a file: a shared brain map, recipe or note is text an agent
  will later read.
- **Optional Discord link.** Nothing contacts Discord until you press **Link
  my Discord** in Settings › Community, which needs the Mefi Studio Link app
  id (this release carries none built in: enter it under Connection details,
  set `MEFI_STUDIO_DISCORD_CLIENT_ID`, or save a hub address whose health answer
  names it). Linking reads your Discord user id, username and display name, and
  your role ids and join date in the Void Engine server (scopes `identify` and
  `guilds.members.read`; no messages, email or other servers, and nothing about
  your projects). It reads them when you link, then about once a week (sooner,
  backing off to daily, after a failed check) and when you press **Check now**.
  The sign-in redirect lands on a one-shot listener bound to `127.0.0.1` (ports
  53134–53136) that checks the `Host` header and the OAuth `state`, and the
  login uses PKCE with no client secret. The link's public fields and check
  times are kept in `settings.json`. The refresh token is encrypted with the OS
  keystore through `safeStorage` in its own `community-auth.json` in the same
  folder (not `auth.json`). The access token is held in memory only, and no
  token crosses into the renderer. Without a keystore nothing is written and the
  link lasts for the session. To revoke, press **Unlink**, which revokes the
  grant at Discord and deletes `community-auth.json`, or remove "Mefi Studio
  Link" under Discord › User Settings › Authorized Apps. See
  [docs/community.md](docs/community.md).
- **Links.** A link played in Settings › Audio › Links loads that service's
  official player (YouTube's privacy-enhanced one, Spotify, SoundCloud or
  Vimeo), or fetches the file straight from its host, and a radio deck streams
  from its station's host. YouTube's player is told it is embedded in Studio
  through a fixed app `Referer`. The YouTube search box sends what you type to
  `youtube.com` and reads the public results page. A link no embed can play (a
  Spotify Jam, Twitch, any other page) can open in the Media browser, which
  the scope notes below describe.
- **The Mefi Studio relay does nothing until you link Discord and connect.**
  Rooms, Playground, Listen together, Share what I'm playing, cowork file
  claims, the Project hub and the Discord remote all go through the Mefi Studio
  relay at `https://mefi-relay.mefi-studio.workers.dev`, a Cloudflare Worker
  whose code is public in this repository under `relay/`
  ([relay/README.md](relay/README.md) lists everything it keeps and for how
  long). Settings › Community › Connection details (or `MEFI_STUDIO_HUB_URL`
  and `MEFI_STUDIO_DISCORD_CLIENT_ID`) can point Studio at another relay or an
  older Void Engine hub; saving there sends one plain health check to that
  address. Studio accepts an `https` address, or `http` only for one on this
  PC itself. Until a Discord account is linked none of it contacts anything.
  The relay keeps no chat, no files, no IP addresses and no request logs: it
  hands each message to the members online and forgets it, and signs it so a
  copy cannot be altered later. Each Studio keeps its own copy of its rooms'
  chat (the last 500 messages of a room for 7 days) in `room-history.json` in
  its user data, encrypted with the OS keystore (memory only without one),
  and forgets a room's copy when you leave it. When a member who missed
  messages opens a room, the relay asks another member's Studio for what it
  holds of that room and checks each message's signature before passing it
  on, so your copy of a room's chat can reach that room's other members. After that it
  connects when you ask (opening Friends › Rooms or the Project hub with Discord
  linked, Connect, or picking a room or turning
  on **Share what I'm playing** under Listen together) and, on its own, at
  launch when the Discord remote is on or a Listen together room or share was
  left on, and within a minute of a project linked to a cowork room being open.
  Connecting sends the relay your Discord access token once per 15-minute
  session, in exchange for a session token; the relay asks Discord who it
  belongs to and which roles you hold in the Void Engine server, keeps only a
  keyed hash of it (so a renewal need not ask again) and drops the token. The token stays in Studio's main process and the page
  never sees it. Over that one connection Studio can send the hub only what the
  next points describe: which rooms you have open (with a presence beat every 30
  seconds for each), what you do and type in Rooms, what you play or share,
  companion cards, cowork claims and, for the Discord remote, this PC's name,
  its replies and its alerts. What the hub does with them is its own contract
  with Studio ([docs/community.md](docs/community.md),
  [docs/remote.md](docs/remote.md)), which Studio cannot check, so you trust
  whoever runs the hub with what these points say is sent.
- **Rooms and Playground** (Friends › Rooms). Chat you write, join notes (up
  to 300 characters), invites, reports and member searches go to the relay as
  you typed them. Chat is passed to the room's members and not kept; a report
  keeps the reported message's text for 30 days, and only when its signature
  checks out. (An older Void Engine hub backs room chat with Discord threads
  instead, so there a message is a Discord message.)
- **Project hub** (Friends › Project hub). Sharing a project sends the relay
  its public link, a title and a line about it, which every signed-in member
  can see until you remove it or nobody plays it for 90 days. Playing one
  opens its link in your browser and, two minutes later, tells the relay you
  played it. The relay keeps your credit balance, rank and streak and a
  180-day list of who credited whom (ids only); other members see your rank,
  never your balance. Forget me removes all of it. While Studio holds a room open (Rooms, Listen together or a
  linked cowork room), the hub also tells its members who has it open in
  Studio, and Studio sends that room a small companion card, but only to a
  hub that lists the companion feature and only at the level you allow. The
  default is **Play only** (its look and mood). Higher levels add its name
  and personality, then whether it is working or resting with counts and no
  titles, then the project's name and up to three running and three finished
  task titles with anything that looks like a secret removed; you can set a
  level per room or per friend, for a session or always, or choose **Stay
  home** to send no card. A card is built from fixed fields, so keys, tokens,
  passwords, file contents, paths, links, chat, decisions, questions and
  settings have no field on it at any level; the free text it does hold (a name,
  the project's name and task titles) is cleaned by pattern matching, which is
  not a guarantee. **What was sent** in Friends lists the last dozen cards that
  left, and a friend's card is validated, clipped and shown as text, never sent
  to a model.
- **Listen together and now playing.** A room's shared player carries the link
  you put on and your Discord name. The share, which is off unless you turn
  it on, carries only the link and its label, a radio station's name, or just
  "Local music": never a local file's name or path. By its contract
  (docs/community.md) the hub keeps both in memory only and posts one line about
  a shared player in the room's Discord thread.
- **Cowork claims.** In Friends › Rooms, **Use this room for this project's
  agents** links the open project's GitHub repository to a cowork room. From
  then on, while that project is open, Studio connects to the hub by itself
  (when Discord is linked), holds the room open and, before a builder starts,
  claims the files it is about to edit, renews the claim every minute and
  lets go when the run ends or, for a run that reported its work done, after
  your next push reaches GitHub or 30 minutes. A claim carries the paths of
  those files inside the project (never their contents), the task's title, a
  random PC id and the run id, none of it scrubbed, and every member of the
  room sees it, so link only rooms whose members you would show that to. With
  no room, no hub, no link or no answer within five seconds, the run goes
  ahead as before: claims add safety between PCs and never gate working alone,
  but a file another PC holds does make that task wait.
- **The Discord remote is off until you turn it on per PC** (Friends › Your
  PCs › Reach this PC from Discord; [docs/remote.md](docs/remote.md)). On,
  Studio keeps its outbound hub connection open, even with the window closed
  to the tray, tells the hub this PC's name (the Windows name until you pick
  one) and a random PC id, and answers only commands from the Discord account
  it signed in as, which Studio checks itself; no port opens on your PC. Once
  a minute it also looks for changes worth an alert. Replies and alerts carry
  task titles, short progress lines and Mefi's answers through Discord and the
  hub to your DMs, after the friend-share scrubber (pattern matching, not a
  guarantee) has taken out keys, tokens, paths, emails, addresses and this PC's
  names. A message from Discord is your chat with less power: it can file work,
  which waits for your OK in every permission mode, note, pause, resume, stop,
  and start or retry a card already on the board, but it cannot approve (except
  with the PIN, next), answer asks, undo or close cards, and permissions, keys,
  settings, sharing and the vault never change from Discord. Approving from
  Discord takes the PIN you set in Studio, typed into a Discord form (never
  posted in the chat) and passed through the hub to your PC in that one command.
  Studio keeps only its salted scrypt hash, in the plain `settings.json`, and
  five wrong PINs lock Discord approvals until you unlock them in Studio (the
  lock is also sent to you as an alert). The PIN guards approvals against a
  stolen Discord login, not against someone who can copy your settings file.
- **Extra Claude Code and Codex logins.** Setup can add up to five extra
  subscription logins beside each CLI's main one, and work moves to the next
  login when one reports its usage limit. The main login is the CLI's own
  default folder, untouched. Each extra login gets a folder of its own under
  `%APPDATA%\Mefi's Studio AI+\cli-logins`, which Studio hands to that CLI as
  `CLAUDE_CONFIG_DIR` or `CODEX_HOME` on the runs that should spend it. You
  sign in through the CLI's own window, and the CLI keeps its login in that
  folder in its own format, outside Studio's keystore; Studio never reads it.
  Studio's own record is the list of logins (label and folder) in
  `settings.json`, and a file, `cli-account-limits.json`, that notes which
  login hit its limit, until when, and a short line from the CLI's message.
  The check button and the usage reading run the CLI itself under that login. An
  extra Claude Code login's `projects` folder is normally a link to the main
  login's, so every login shares its sessions and memory. Removing a login
  deletes its folder and its sign-in, without following that link.
- **Agents setup can install a builder for you.** Under Agents › Setup ›
  Connections, **Install and sign in** (or **Update and sign in**) opens a
  visible PowerShell window that runs a fixed command for the tool you chose:
  `npm install --global` for Codex, Grok or OpenCode (after installing Node.js
  with winget if npm is missing), and, for Claude Code and Antigravity, the
  vendor's own installer script, downloaded from `claude.ai` or
  `antigravity.google` and run straight away. The page names a tool and an
  action, never a command or a link, and nothing installs from the automatic
  scan. See [docs/cli-setup.md](docs/cli-setup.md).
- **Local state is never committed or packaged.** Tasks, conversations,
  databases and captures live under `data/` (source install) or the portable
  build's own `resources/app/data`; both are ignored by git and skipped by the
  packager. Settings live outside the install, in Electron's per-user folder
  `%APPDATA%\Mefi's Studio AI+` (the folder keeps the app's original name, so
  settings carry over between versions, although the project is now called
  Mefi Studio in public): the `settings.json` preferences (among them the
  Discord remote's PIN hash and this PC's random cowork id), the saved-key file
  `auth.json`, the Discord sign-in `community-auth.json`, the resume record
  `session.json`, the `vault` folder (the vault key, `vault.json` naming the
  repository and this PC, the local copy of the vault repository and the library
  of items you kept), the `cli-logins` folder, the limit marks in
  `cli-account-limits.json`, and the Media browser's own session. That folder
  belongs to the Windows account, not to one install, so a source checkout and a
  portable build run by the same account share it. It is never committed or
  packaged either.
- **Agents run real commands.** Coding workers (`opencode`, `claude`, `codex`,
  `grok`, `agy`) edit files in the project folder you chose. Use **Verify
  first** (Auto build off) if you want to approve each task before it runs. An
  agent role can also call MCP tools, but only ones you allow for that role,
  from programs you listed in `~/.mefi-studio/mcp.json`; Studio starts them with
  a trimmed environment, so your provider keys are not passed unless the entry
  lists that variable.
- **Coding workers run with their own approval prompts off.** Nobody is at the
  keyboard of a headless worker, so Studio starts each one with the CLI's
  approval switches turned off: `claude -p --dangerously-skip-permissions`,
  `codex exec --dangerously-bypass-approvals-and-sandbox`,
  `opencode run --auto`, `grok --always-approve` and
  `agy --dangerously-skip-permissions`. The permission mode you pick in Studio
  (Always ask, Accept per task, Auto or Elevated only) is therefore the control
  that decides what a task may do. The CLIs' own prompts and, for Codex, its
  sandbox are not a second line of defence.
- **Agents can read pages you link.** **Read web pages you link** (`web_read`,
  on by default wherever search is, with its own switch) fetches a page from
  this PC, only for an address you gave it or a search returned. It refuses
  your own machine and network (loopback, private, link-local and cloud
  metadata addresses, checked again on every redirect), sends no cookies and
  none of Studio's keys, and hands the text back marked as untrusted page data.
  The rules are in `docs/agent-tools.md`.
- **Updates keep a saved copy.** Before an in-app update replaces the app
  folder, Studio saves the running build under
  `%LOCALAPPDATA%\MefiStudio\rollback`, starts the new build and watches
  `data/boot-health.json`. If the new build never reports that it started, or
  you choose **Roll back** in Settings › Updates, Studio puts the saved copy
  back. `resources\app\data` (your settings and records) is never touched by an
  update or a rollback. `MEFI_STUDIO_NO_ROLLBACK=1` restores the plain swap.
- **Audio-reactive visuals listen locally.** If you choose a microphone or
  desktop audio as the visuals' input, Studio analyses the signal in the window
  to move the tree. It does not record it or send it anywhere. Desktop audio is
  requested through Electron's loopback capture, and the screen video track that
  arrives with it is stopped at once.

## Reporting a vulnerability

Please do not open a public issue for anything that could expose keys,
project files or the machine Studio runs on. Instead, use GitHub's private
vulnerability reporting on this repository ("Security" tab → "Report a
vulnerability"), or email the maintainer address shown on the GitHub profile
of `nateecho32-stack`. Include the Studio version (Settings › Updates),
whether you run the portable build or from source, and steps to reproduce.

You will get an acknowledgement within a week. Fixes ship as a normal release;
the CHANGELOG entry credits the reporter unless they ask otherwise.

## Scope notes

- Studio reads its own `MEFI_STUDIO_*_KEY` variables (and
  `MEFI_STUDIO_GITHUB_TOKEN`) every time it needs a key, and a variable that
  is set wins over the key saved in Settings. That lets a host with no
  keystore run at all. The headless `--set-*-key` commands are the one-time
  path: they copy the variable into the keystore once. After running one,
  unset the variable. Otherwise the plaintext copy stays in your shell, any
  later launch from that shell keeps using it, and a key you change in
  Settings is silently ignored.
- The browser fallback (`npm run start:web`) serves the renderer over plain
  HTTP on 127.0.0.1 only and cannot launch workers. It serves `renderer/`,
  `assets/` and the public `data/models.json` catalog, never the rest of
  `data/`, sources or dotfiles; do not forward or proxy that port.
- Links the renderer asks the host to open (`shell:open`) must be `http` or
  `https`; any other scheme is refused. Discord links never take that path:
  the renderer names a target (`invite`, `server`) and the host opens a
  hard-coded `https://discord.gg` or `https://discord.com` URL.
- The Studio window's own page is the bundled one, and it may only connect to
  itself (its Content-Security-Policy), so the requests listed above are made
  by the main process. The exceptions are the four embedded players
  (YouTube, Spotify, SoundCloud, Vimeo) and the audio and video the player
  streams. A link that asks for a new window opens in your default browser,
  and only if it is `http` or `https`; no website opens in a window of its
  own. Anything that would navigate the window itself away from the bundled
  page (a dropped link, a stray `href`, a script) is refused.
  `setWindowOpenHandler` and the `will-navigate` guard in `main.cjs` enforce
  this.
- The one place a website appears inside Studio is the **Media browser**,
  which the Links player opens for a link no embed can play, or when you ask
  for it. It is a separate sandboxed view (no Node, no preload, and only
  Studio's own page can control it) with its own session, kept between runs,
  so a site you sign in to there stays signed in there and nowhere else. It
  refuses permission requests (camera, microphone, notifications and the
  like) and downloads, keeps a page that asks for a new window in the same
  view, and refuses links that need another app; use its Open in browser for
  those.
- **Start with Windows** is off until you turn it on (Settings › General ›
  Profile & startup). On, Studio writes one per-user Windows startup entry,
  named "Mefi's Studio AI+", that starts the copy you run in the tray on your
  last project, and keeps it pointed at that copy if you move the folder. The
  entry can be switched off in Task Manager › Startup apps, and Studio then
  leaves it off.
