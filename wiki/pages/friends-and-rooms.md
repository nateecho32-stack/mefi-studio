# Friends, rooms and playdates

Friends is the social side of Studio. You can join rooms with people from the [Void Engine Discord](#/discord), chat, listen to the same song at the same moment, and let your companion play with your friends' companions. Your own PCs live here too. See [Your PCs](#/your-pcs).

> <span class="status rolling">Rolling out</span> Rooms, room chat, Listen together, playdates with friends and **Share back?** need the Void Engine rooms hub. Studio's side is built, but the hub isn't open to everyone yet. Until your Studio can reach it, Friends tells you which step is missing.

## Open Friends

Click your [companion](#/companion) at the foot of the menu, or press **Esc** on a workspace page. Then choose the **Friends** bubble.

<span class="status next">Coming in 0.4.5</span> **Friends** also has its own section in Build’s main menu, with **Rooms**, **Your PCs** and **Playground** links. Each opens its matching card in the same hub. Vibe’s rail has a Friends stop, and Search reaches Friends and each card in both modes. The companion bubble still works.

In 0.4.4, Friends holds three things:

- **Connect with Discord** opens **Settings › General › Community**.
- **Friends & listening rooms** opens [Listen together](#listen-together) in Music & video.
- **Your PCs** keeps your own PCs in step. See [Your PCs](#/your-pcs).

<span class="status next">Coming in 0.4.5</span> Friends also holds **Playground** and **Rooms**. Its bubble shows a badge when invites or join requests wait for you, or when a PC has work to sync.

## What you need

- A Discord account in the Void Engine server. [Join the Discord](#/discord) first.
- Your Discord linked in Studio, under **Settings › General › Community › Link my Discord**. <span class="status rolling">Rolling out</span> Studio 0.4.4 doesn't ship the link app ID yet, so the button stays hidden for now.
- A connection to the rooms hub. <span class="status next">Coming in 0.4.5</span> **Settings › General › Community › Connection details** holds the link app ID and the rooms hub address. A PC uses them at once, with no restart, and **Save** tells you whether the hub answered.

Linking reads only your Discord id and name, and your roles and join date in the Void Engine server. It never reads your messages, and nothing about your projects is sent. [Link your Discord in Studio](#/discord/link-your-discord-in-studio) has the details.

## Rooms <span class="status rolling">Rolling out</span>

A room is a private thread in the Void Engine Discord that you can also use from Studio. Rooms arrive in Studio with 0.4.5 and work once the rooms hub is online.

Open the companion › **Friends** › **Rooms** and choose **Connect**. The panel has three tabs: **Rooms**, **Requests** and **Invites**.

- **Join a room.** Choose **Ask to join**, add a short note for the owner if you like, and choose **Send request**. The owner decides. You can **Cancel** a request while it waits.
- **Answer an invite.** Accept or decline it on the **Invites** tab.
- **Chat.** **Open** a room to read and write. Messages are plain text with @names, and links never become clickable. **Ctrl + Enter** sends.
- **Report a message.** Choose **Report** under someone's message, say briefly why, and choose **Send report**. You can **Delete** your own messages that you sent from Studio.
- **Leave a room** with **Leave room**. It asks once more before it acts.

### Make and run a room

Choose **Make a room**, give it a name and pick:

- **Hangout (up to 25)** or **Cowork (up to 10)**;
- **Anyone can ask to join** or **Invite only**;
- whether to **Show it in the room list**.

Making rooms needs the Room Host role in the server, and you can own up to three open rooms at a time. As the owner, you can:

- let people in with **Let them in** on the **Requests** tab, or decline them;
- invite someone by name: type the name, choose **Find**, then **Invite**. Nobody joins until they accept;
- **Lock** the room to stop new posts and requests, and **Unlock** it again;
- **Close room** for everyone. Its history stays in Discord, but nobody can post or join. Studio asks once more first.

## Agents working together <span class="status rolling">Rolling out</span>

A cowork room can stop agents on different PCs from editing the same file at once.

1. Open the cowork room under **Rooms** on each PC.
2. Choose **Use this room for this project's agents**. The project has to be on GitHub.
3. Before a builder starts, Studio claims the files it will edit. Every PC hears the claim within a second. A task whose files another PC holds waits and picks other work.

The room lists what is claimed and by which PC. A finished run keeps its claim until its PC pushes the change, or for 30 minutes. With no room, hub or Discord link, nothing waits.

## Listen together <span class="status rolling">Rolling out</span>

Play a link for one of your rooms, and everyone who listens along hears it at the same point. Studio's side has been in the app since 0.4.0.

1. Open **Music & video** and choose the **Video & links** tab, where **Listen together** lives. The companion's **Friends › Friends & listening rooms** takes you there too.
2. Load a YouTube, Spotify, SoundCloud or Vimeo link, or a link to an audio or video file.
3. Choose **Connect**, pick the room under **Choose a room**, then choose **Play this link in the room**. The room's Discord thread gets a note.

Friends in the room choose **Listen along**. Whoever put the link on, or the room's owner, can **Pause** it, play it **From the start** or **Stop** it. <span class="status next">Coming in 0.4.5</span> **Stop** asks first, because it stops the link for everyone.

Audio and video files stay in step to the second. YouTube, Vimeo and SoundCloud join part-way through. Spotify's player can only be loaded, so everyone presses play in it.

### Share what I'm playing

**Share what I'm playing** sits under Listen together and is off until you turn it on. When it's on, Void Engine members can see your current link, radio station or just “Local music” with `/nowplaying` in Discord. It never shows a file's name. The hub keeps it in memory only and drops it when Studio closes.

## Playground and playdates

<span class="status next">Coming in 0.4.5</span> **Friends › Playground** is where companions meet. Like toys that link up, they play short scripted playdates: high fives, races, rock-paper-scissors, hide and seek and sticker swaps.

- **Practice with Pip** plays a playdate with Pip, a practice buddy that never leaves your PC. Nothing is sent, and you need neither Discord nor the hub.
- **Play with a friend.** <span class="status rolling">Rolling out</span> When a friend's companion is out in a room you have open, it shows up with **Play with …**. Both screens show the same scene, each from its own side. This needs a rooms hub that carries companions.

### What your companion may share

Nothing about you or your work leaves until you allow it. Open **What Mefi may share** (with your companion's name) and choose a level.

| Level | What friends see |
| --- | --- |
| **Stay home** | Nothing. Your companion doesn't join playdates. |
| **Play only** (the default) | Its look, its mood, games and emotes. Nothing about you or your work. |
| **Say hi** | Also its name and personality. |
| **Status** | Also whether you're working or resting, and how many tasks run now and finished today. No titles. |
| **Work titles** | Also the project's name and a few running and finished task titles, with anything that looks like a secret removed. |

- Set a level for **Everyone, by default**, for a room, or for one friend. Tick **This session only** for a rule that ends when Studio closes. The most specific rule wins: a friend, then a room, then everyone.
- **This session** can hold everything at **Just play for now** or **Stay home for now**.
- **Share back?** <span class="status rolling">Rolling out</span> When a friend's companion shares more with you, yours asks whether to share the same back: **For this session**, **Always with …** or **Not now**. It never shares more on its own.
- **What was sent** lists every card your companion sent this session.
- **Never shared, at any level:** keys, tokens and passwords; file contents, file paths and links; your chat with your companion; questions, decisions and approvals; settings and connected accounts.

## Privacy in rooms

- Void Engine moderators can read every room, and each room says so.
- Room messages live in the room's Discord thread. The rooms hub passes them to Studio without storing their text.
- Studio sends the hub your Discord sign-in once per 15-minute session. The hub checks it with Discord and drops it.
- Listen together and **Share what I'm playing** live in the hub's memory only.
- In Discord, `/privacy` shows what the Void Engine bot keeps, and `/forget-me` deletes your records.

[Privacy](#/privacy) covers the rest of Studio.

## When Friends says a step is missing

| Friends says | What it means |
| --- | --- |
| “…the rooms hub, which this PC isn't connected to yet” | This PC has no rooms hub address yet. |
| “Link Discord under Community…” or “Link your Discord account to use rooms.” | This PC hasn't linked Discord yet. |
| “Connect under Rooms below…” | Choose **Connect** under **Rooms**. |
| “Open a room under Rooms below…” | **Open** a room. Companions meet while a room is open in Studio. |
| “This rooms hub does not carry companions yet” | The hub can't pass companions along yet. Pip is still there to practice with. |

## Coming next <span class="status progress">In progress for 0.4.6</span>

Friends 2.0 is being built for 0.4.5: a lobby with rooms to hang out in, a way to see who's online, Studios on the same Wi-Fi finding each other, invite links instead of copy-paste codes, and a fair shared-video queue so everyone gets a turn. Details may still change. The [roadmap](../roadmap.html) has the latest.

See also: [Your companion](#/companion), [Your PCs](#/your-pcs), [Music, video and the player](#/media-player) and [The Void Engine Discord](#/discord).
