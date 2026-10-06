# The Void Engine Discord

The Void Engine is the Discord server for people who build with Studio. Share what you're making, ask for help and feedback, swap model setups, and keep each other company while you work. Unfinished ideas are welcome, and you don't need Studio to join.

**[Join the Void Engine Discord](https://discord.gg/xgfKc5pVxG)**

Discord is the easiest way to reach the community, but you never need it. Every theme and node style in Studio is free without it. Only features that connect you with other people, such as rooms, use your Discord account, so Studio knows who you are. You can also report bugs and ask for features [on GitHub](https://github.com/nateecho32-stack/mefi-studio/issues/new/choose).

## What happens there

- **Show your work.** Post a project with `/showcase`: a title, a link and a description. The bot adds a short blurb and tags, and pings nobody. You can credit someone who helped, and choose whether your post may be featured.
- **Get help.** Ask in a help thread. If a reply solves your question, right-click it and choose **Apps › Mark as solution**, and the person who helped gets the credit.
- **Cowork.** `/cowork start` opens a temporary voice channel and a thread, so you can work side by side. Both go away five minutes after the voice channel empties.
- **Ask about Studio.** `/ask` answers questions about Studio from a copy of this guide.
- **Hear about releases.** Each new Studio release is announced once in the server.
- **Rooms.** <span class="status rolling">Rolling out</span> `/room list` and `/room request` find rooms and ask to join them, and `/nowplaying` shows what a member's Studio is playing when they share it. They work once the bot is linked to Studio's relay. Rooms themselves don't need them: from 0.5 you find and join rooms in Studio. See [Friends, rooms and playdates](#/friends-and-rooms).
- **Ask for features.** Tell us what you'd like Studio to do next.

The Void Engine bot handles the commands above. It runs on the maintainer's own PC, so now and then it may be offline. More is being built for it: see the [roadmap](../roadmap.html).

## Roles

Roles come from taking part: showing work, helping people and coworking.

- **Member** comes when you join. **Regular** comes after four active weeks in a row.
- **Builder**, **Helper** and **Mentor** also need a moderator's OK.
- **Spotlight** marks the project of the week, for seven days.
- `/me` shows your points, streak and what unlocks next, to you alone. There is no public leaderboard.

## What the bot keeps

The bot never stores message text. It keeps counters and short records, such as your points, your streak and the showcase posts you submit. In the server, `/privacy` shows what it keeps, and `/forget-me` deletes your records.

## Link your Discord in Studio <span class="status next">New in 0.5</span>

Signing in is optional. It tells Studio who you are in the Void Engine, which The Lobby, Rooms and the Project hub need. It unlocks nothing: every look is already free, and no Discord role is needed. See [Friends, rooms and playdates](#/friends-and-rooms).

- **Where:** until you sign in, **Friends** shows a **Sign in with Discord** card. **Settings › General › Community** has it too, and searching for “Void Engine Discord” with **Ctrl + K** opens it.
- **How:** Discord asks once, in your browser, and Studio connects by itself from then on. If your account isn't in the Void Engine server yet, Studio offers **Join the Discord** and checks again.
- **What it reads:** your Discord id and name, and your roles and join date in the Void Engine server. It never reads your messages, your email or your other servers, and nothing about your projects is sent.
- **Where it's kept:** in Studio's settings on this PC, with the sign-in encrypted in `community-auth.json`. The Mefi Studio relay keeps your id, name, roles and join date for sign-in and room rules; its [README](https://github.com/nateecho32-stack/mefi-studio/blob/main/relay/README.md) says for how long.

Studio 0.4.4 doesn't include the Mefi Studio Link app ID, so **Link my Discord** stays hidden there and the card offers **Join the Discord** only. In 0.5 the app ID and the relay's address are built in; **Connection details**, in the same card, only points a PC somewhere else for testing.

You can also remove “Mefi Studio Link” in Discord under **User Settings › Authorized Apps**.

## The invitation card

Now and then, Studio shows a small card that invites you to join. It waits three days after your first launch, then comes back at most once a week, and once a month after four showings. **Not now** hides it for a week, and **Don't show again** stops it. It never asks a linked member to join. Build's Home also has **Getting started & community**, with **Join the Discord**.

## Reach your PCs from Discord <span class="status rolling">Rolling out</span>

Studio's side of a Discord remote is built for 0.5, and the relay carries it. It works once the Studio bot is linked to the relay; the bot's side is still being built. Then a DM with the Void Engine bot becomes a remote for your home PCs:

- **Look:** `/studio status`, `/studio needs`, `/studio made` (what is being built and what finished today) and `/studio digest`.
- **Talk:** a plain DM goes to Mefi on your PC, and the reply comes back. `/studio pause` and `/studio resume` stop and restart new work.
- **Alerts:** a DM when something needs you, a task stops or agents sit on work, with quiet hours and a daily digest.
- **Approvals with a PIN:** **Approve** asks for a PIN you set in Studio, in a Discord form that never shows in the chat.

A message from Discord is your chat with less power. Tasks it starts wait for your OK in every permission mode, and it can never change permissions, keys or settings. Five wrong PINs lock Discord approvals until you unlock them in Studio. Only your own Discord account is answered, no port opens on your PC, and Studio removes keys, paths, emails and addresses before anything is sent.

You'll turn it on for each PC in **Friends › Your PCs › Reach this PC from Discord**. See [Your PCs](#/your-pcs).

## Ask for a feature

Say what you'd like in the Discord, or use the [feature request form](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=feature_request.md) on GitHub. The [roadmap](../roadmap.html) shows what's done, what's being built and what's planned.

See also: [Community and Discord](#/community), [Friends, rooms and playdates](#/friends-and-rooms) and [Privacy](#/privacy).
