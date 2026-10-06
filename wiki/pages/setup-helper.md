# The setup helper

> <span class="status next">New in 0.5</span> The setup helper came with 0.5. Still on 0.4.4? Read [Set up in 0.4.4](#/setup-helper/set-up-in-044) below.

The setup helper is one guided sheet for everything that decides what your agents do. You connect an AI, choose who does what, decide how much Mefi may do on its own and set how Studio behaves on your PC, all in one place.

Every change saves as you make it. The helper has no settings of its own: each control saves to the same setting as its usual place in Studio, so what you pick here shows everywhere else.

## When it opens

- **On a new install**, a three-step welcome comes first: pick the AI that builds for you, choose a project, and say what Studio should make first. **Other ways to connect** opens the helper at **Connect an AI**, and **Skip** leaves it waiting in Help and Search.
- **After you update to 0.5**, it opens once, with your current choices already filled in.
- **Any time later**, press `Ctrl K` and type *setup helper*. To go straight to one part, pick it from the results, for example **Setup helper › Routing** or **Setup helper › Permissions**.

**Save & close** (or `Esc`) leaves at any point. Nothing is lost, because every change is already saved.

## Quick setup or Everything

The first page asks two questions.

**How much do you want to set?**

- **Quick setup** covers what a first run needs: **Connect an AI**, **Permissions** and **Finish**. It takes about two minutes.
- **Everything** walks every section in order, with **Back** and **Next**.

**Which team are you setting up?**

- **Studio defaults** apply to every project that has no team of its own.
- **This project only** gives the open project its own team.

You can also jump to any section from the list down the side.

## Connect an AI

Studio needs at least one AI to talk to. Pick the row that fits you.

| You have… | Do this |
| --- | --- |
| Not sure what you have | Choose **Set up automatically**. Studio looks at your saved keys, installed coding tools and LM Studio, then picks a working route. It never changes your keys or model choices. |
| A Claude, ChatGPT, Grok or Google subscription | Under **Use a subscription you already have**, pick Claude Code, Codex, Grok or Antigravity. Choose **Install and sign in** (or **Sign in** if it's installed), then **Check connection**, then **Use for the whole studio**. |
| No subscription and no key | Choose **Start free with OpenCode**. Install OpenCode, choose **Scan OpenCode**, then **Use scanned setup**. |
| An API key | Paste it under **API keys**: OpenCode Go, OpenCode Zen, z.ai or OpenRouter. |
| A model running on your PC | Enter your **LM Studio server** or a **Custom endpoint** under **Local and custom servers**. |

Good to know:

- A tool that's installed but not signed in says so in the list. It doesn't count as connected until you sign in or it passes **Check connection**.
- **Check connection** sends one small test prompt on your account, so your provider's limits apply.
- **Use for the whole studio** runs chat, planning, every agent seat and the coding workers on that login. It also turns off falling back to other providers.
- Saving an API key doesn't switch any agent to it. Choose providers in **Team & models**.
- OpenCode's free models may use your prompts to improve the model. The **Allow free models** box says so before you scan.

### More than one login

Have two Claude or ChatGPT subscriptions? Under **More than one login**, choose **Add a Claude Code login** (or **Add a Codex login**), then sign in with the other account in the window that opens. Each tool takes up to six logins.

Studio uses the first login until it reaches its usage limit, moves to the next, and goes back when the limit resets. Other providers answer only once every login has hit its limit, and only through fallbacks you already allowed. Each login gets its own row in **Agents › Usage › Provider accounts**.

## The other sections

These show when you choose **Everything**, or when you pick them from the list.

| Section | What you set there |
| --- | --- |
| **Team & models** | The main assistant, its routine and planning roles, the coding worker and its tier (Auto, Free, Fast or Heavy), subtask builders, the five agent seats (Companion, Context scout, Overseer, Lead and Desk) and saved teams |
| **Routing** | **Automatic** (Jev picks a model per task) or **Fixed** models, the **Automatic provider order**, **Try signed-in coding tools first** and **Fall back when a provider fails** |
| **How work runs** | **Allow new work**, **Run the queue on its own**, how often agents look for work, **Coding workers at once**, how the team coordinates and reports, working through the backlog, and housekeeping |
| **Permissions** | How much Mefi may decide for you. See [Permissions and decisions](#/permissions). |
| **Tools & skills** | For each agent: web search, reading project files, MCP tools, skills and habits. See [Agent tools and skills](#/tools). |
| **Machine & app** | **Keep this computer awake**, **Keep running in the tray when the window closes**, **Start with Windows**, limits for runaway test runs, which projects' questions your companion shows, and a GitHub token |
| **Look** | Theme, node style, layout and your companion's look. Every look is free. |
| **Finish** | A summary of your setup |

## Finish

**Finish** shows your connection, main assistant, coding worker, team, permission mode, and whether new work may start. If no AI is connected yet, it offers **Connect an AI first**.

On a first run, **Continue to the guided tour** starts the Start here walkthrough. If you close the helper another way, the tour waits for you on the Start here card, and a notice tells you how to start it. If the helper already connected an AI, the tour skips its scan.

## Set up in 0.4.4

The 0.4.4 download has no setup helper. Use these instead:

- **Help › Start here** walks you through connecting an AI and opening a project. Its **Use the account you already have** panel has **Install and sign in**, **Check connection** and **Use for the whole studio**.
- **Agents › Setup** holds the same agent settings in four panes: **Team & models**, **Providers**, **Routing & fallback** and **Run behavior**.

> **Known problem in 0.4.4:** the window that **Install and sign in** or **Sign in** opens may close at once, before it does anything. Install and sign in to the tool from a terminal instead, following its own setup instructions (**Setup instructions** opens them). Then come back and use **Check connection** and **Use for the whole studio**. This is fixed in 0.5.

These are the sign-in commands Studio runs for each tool:

| Tool | Sign-in command |
| --- | --- |
| Codex | `codex login` |
| Claude Code | `claude auth login` |
| Grok | `grok login` |
| Antigravity | `agy` |
| OpenCode | `opencode auth login` |

## Related pages

- [Connect an AI](#/connections) covers every provider in more detail.
- [Permissions and decisions](#/permissions) explains the four permission modes.
- [Settings and Configuration](#/settings) covers everything that isn't about agents.
- [Everything new in 0.5](#/coming-in-0-5) lists everything else 0.5 added.
