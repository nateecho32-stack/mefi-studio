# Connect an AI

One coding CLI sign-in can run all of Studio: the conversation, planning, the agents and the coding. Start there if you already use Claude Code, Codex, Grok or Antigravity. You can also use an API key or a model running on your own PC.

Studio doesn't supply an AI subscription. Model access, usage limits and charges come from your provider.

## Use an existing sign-in

Open **Help › Start here**. **Agents › Setup › Providers** reaches the same controls through **Install a coding tool or use one subscription for Studio**.

1. Choose your coding tool: Codex, Claude Code, Grok, Antigravity or OpenCode.
2. Select **Install and sign in** if it's missing, or **Sign in** if it's already installed.
3. Finish the provider's sign-in in the window or browser that opens.
4. Back in Studio, choose **Refresh installed tools**, then **Check connection**.
5. Select **Use for the whole studio**.

For OpenCode, steps 4 and 5 are **Scan OpenCode**, then **Use scanned setup**.

**Check connection** sends a small prompt with the selected account. Finding a tool only shows that it's installed, not that its sign-in works.

**Use for the whole studio** saves the account for Studio's defaults and for the current project, even if that project has its own team. Other projects with their own saved teams keep them. It also turns cross-provider fallback off, so Studio won't switch to another provider when that account fails.

> In 0.4.4 the **Install and sign in** and **Sign in** windows may close as soon as they open. If that happens, [sign in from a terminal](#sign-in-from-a-terminal). <span class="status next">Coming in 0.4.5</span> The windows stay open and run the setup, and Studio finds the tool by itself when you close one.

## Sign in from a terminal

Use this when the guided window closes at once in 0.4.4:

1. Open PowerShell.
2. If the tool isn't installed yet, install it with its maker's instructions. **Setup instructions** in Studio opens them, or use the links below.
3. Run the tool's sign-in command, and finish signing in where it sends you.
4. Back in Studio, choose **Refresh installed tools**, then **Check connection**, then **Use for the whole studio**.

| Tool | Sign-in command | Install help |
| --- | --- | --- |
| Codex | `codex login` | [Codex CLI](https://developers.openai.com/codex/cli) |
| Claude Code | `claude auth login` | [Claude Code setup](https://code.claude.com/docs/en/setup) |
| Grok | `grok login` | [Grok CLI](https://docs.x.ai/build/cli/reference) |
| Antigravity | `agy`, then follow its sign-in | [Antigravity install](https://www.antigravity.google/docs/cli/install/) |
| OpenCode | `opencode auth login` | [OpenCode docs](https://opencode.ai/docs/) |

These are the same commands Studio's setup window runs. Your password and tokens stay with the tool: Studio never sees them.

## More than one login <span class="status next">Coming in 0.4.5</span>

Have two Claude or ChatGPT subscriptions? In the [setup helper](setup-helper.md), open **Connect an AI › More than one login** and add a second Claude Code or Codex login, up to six in all. Each login signs in through its own window.

Studio uses the first login that hasn't reached its usage limit. When one does, Studio sets it aside until it resets and moves on to the next. A coding worker's task goes back to the queue for the next login, without using up one of its tries. Each login gets its own row in **Usage › Provider accounts**.

## Other connection options

| What you use | Choose in Studio |
| --- | --- |
| OpenCode, with its free models or linked providers | **OpenCode** as your coding tool |
| An OpenCode Go plan | **OpenCode Go** and your key |
| An OpenCode Zen key | **OpenCode Zen** and your key |
| A z.ai coding plan | **z.ai GLM** and your key |
| OpenRouter | **OpenRouter** and your key |
| A running LM Studio server | **LM Studio (local)** |
| Ollama or another OpenAI-compatible server | **Custom endpoint**, its URL and its key |

Find the provider forms under **Agents › Setup › Providers**. **Agents › Setup › Routing & fallback** decides which provider answers, and whether Studio may try another one.

Chat and coding have separate needs. A local chat server, for example, doesn't install a coding worker. Check both before you start a build.

> <span class="status next">Coming in 0.4.5</span> The custom endpoint's key becomes optional, and automatic setup finds a local Ollama and a saved Zen key by itself.

## Auto setup

**Run auto setup**, under **Agents › Setup › Providers**, chooses from your saved keys, installed tools and running local servers. A fresh install runs it once. Run it again after you add a key or a tool.

Auto setup says what it picked. It doesn't send a test prompt or change your saved keys. Use **Check connection** when you want to test an account.

> <span class="status next">Coming in 0.4.5</span> The setup helper's **Set up automatically** does the same job. It picks a signed-in Claude Code, Codex, Grok or Antigravity login first. **Start free with OpenCode** is the way in with no subscription or key. A tool that's installed but not signed in is marked, and it doesn't count as a connected AI until it signs in.

## Models, seats and coding tiers

Model choices are saved per provider and per coding tool, so switching never mixes them up. Leave a model blank to use that provider's default. **Agents › Setup › Team & models** assigns a model to each role and to the five helper seats: Companion, Task context scout, Overseer, Lead and Desk. [Assistant and agents](assistant.md) explains what each one does.

The coding worker's **Build tier** decides which model builds:

- **Auto** picks a model for each task on the z.ai and OpenCode Go routes, when no model is pinned. Other routes use the tool's own default model.
- **Free** runs a free model, one worker at a time, and never falls back to a paid one.
- **Fast** uses a quick, economical model.
- **Heavy** uses a stronger one.

Studio shows which model each tier will use before anything runs. Jev is an optional model-selection service: you don't need it to use Studio.

## Keys and where they live

Studio encrypts saved keys with the Windows keystore. The app shows whether a key is saved, never the key itself. CLI sign-ins stay with their own tools.

Studio's saved keys live in `%APPDATA%\Mefi's Studio AI+\auth.json`, apart from your preferences. The portable build and a source install on the same Windows account share that file. Keys only work for the Windows account that saved them, so enter them again on another PC.

### Headless key setup

For scripted setup, pair an environment variable with the matching one-time flag. For example, from a source checkout with its packages installed:

```powershell
$env:MEFI_STUDIO_ZAI_KEY = "your-key"
npx electron . --set-zai-key
Remove-Item Env:MEFI_STUDIO_ZAI_KEY
```

[.env.example](https://github.com/nateecho32-stack/mefi-studio/blob/main/.env.example) lists the flags for the other providers. Clear the variable afterwards: while it's set, Studio uses it instead of the saved key.

See [Model Lab and usage](model-lab.md) for account readings, or [Troubleshooting](troubleshooting.md) if a connection fails.
