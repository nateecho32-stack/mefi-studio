# Privacy

Mefi Studio keeps your work on your PC. It has no usage telemetry and no required Studio account. The services you connect still receive what they need to do the work you ask for.

## What stays local

Tasks, conversations, plans and project history are saved on your computer. A portable build and a source install keep separate project stores, but they share settings and saved keys when they run under the same Windows account.

Keys are encrypted with the Windows keystore and saved apart from your preferences. They only work for the Windows account that saved them, so copying the files to another PC doesn't move a working login.

## What uses the network

| When you use… | What happens |
| --- | --- |
| An AI provider or coding agent | Your prompts and the relevant project context go to that service. Check its terms before you send confidential work. Studio masks key-shaped text and your home folder's name in the calls it makes itself. Coding CLIs run inside your project and see your real files. |
| Agent web search | Search queries go to the search service: Bing by default, or Brave if you set its key. |
| Online video or music | The player connects to the media service, or to the host of the file. YouTube plays in its privacy-enhanced player. |
| Release updates | Studio asks GitHub for new releases every 20 minutes, and downloads one only when you choose to update. |
| Usage › Provider accounts | Studio asks each provider's account service for your usage, with your saved key. Refreshing sends no prompts. |

In 0.4.4 the Discord link stays hidden and Listen together has no room service to reach, so neither sends anything. Joining the [Discord community](https://discord.gg/xgfKc5pVxG) is separate from signing in from Studio, and you never have to do either.

**Audio link** uses desktop audio or the microphone only when you turn it on, and only to move the visuals: nothing is transcribed. A "Hey Studio" voice shortcut is an <span class="status idea">Idea</span>, not a feature.

## New network features in 0.5 <span class="status next">Coming in 0.5</span>

| Feature | What it sends, and where |
| --- | --- |
| **Share between my PCs** | Items you choose go to one private GitHub repository, `<you>/mefi-studio-vault`. Every file is sealed with AES-256-GCM, under a key only your paired PCs hold, so GitHub can't read it. Items are checked on the way out and on the way in, and keys go only after you type a confirmation. |
| **Share with friends** | Writes one item to a `.mefishare` file that you send however you like. Studio removes paths and names, refuses anything with a secret in it, and shows you exactly what's in it first. A friend's file is reviewed before you can use it, and it can never change your permissions. |
| **Keep this PC up to date** and the Your PCs look | Studio asks GitHub once a minute whether another PC pushed. The Friends badge looks 45 seconds after launch, then every 15 minutes. |
| **Set up this PC** | You sign in to GitHub in your browser. Studio never sees your password or token. |
| **Sign in with Discord** | Optional. It reads your Discord id and name, and your roles and join date in the Void Engine server, never your messages, your email, other servers or anything about your projects. The sign-in is encrypted in `community-auth.json`. |
| **The Mefi Studio relay** | Friends' rooms, room chat, Listen together, playdates and cowork claims go through this free service, which is built into Studio and used only once you sign in. It keeps your Discord id, name, roles and join date until you go two years without signing in, and writes no chat, files, IP addresses or request logs. Its [README](https://github.com/nateecho32-stack/mefi-studio/blob/main/relay/README.md) lists everything it keeps, and for how long. |
| **Friends › Rooms** | Room chat passes through the relay without being stored there: each Studio keeps its own encrypted copy for a week. Links in chat are never made clickable, and moderators see a message only when someone reports it. |
| **Listen together and Share what I'm playing** | A room's shared player carries the link and your Discord name, and is kept only while it plays. **Share what I'm playing** is off until you turn it on, shows local music only as "Local music", with no file name or path, and is forgotten when Studio closes. |
| **Cowork rooms** | The paths of the files a builder will edit go to the room you linked to the project. The relay keeps them for seven days after they're released. |
| **Friends › Playground** | Your companion shares only at the level you allow, and **What was sent** lists every card that left. |
| **The Project hub and credits** | A shared project is a card: a public link, a title and a line about it, never a file. The relay keeps who played which project on which day for eight days, and each credit for 180 days. |
| **My PCs** | Your PCs see each other's load, battery and tasks while they're connected. Work sent between paired PCs is sealed, so the relay can't read it, and nothing about them is kept after they disconnect. |
| **Other apps** | Off until you turn it on in **Settings › Other apps**. Only apps on this PC can connect, with a key kept in your user folder, and no web page can call it. |
| **Reach this PC from Discord** <span class="status rolling">Rolling out</span> | Off until you turn it on for each PC. It works once the Void Engine bot is linked to the relay. Replies and alerts reach your DMs after keys, paths and addresses are scrubbed, and work filed from Discord always waits for your OK. |

## Keep control of your project

Coding agents run real commands and can edit files in the folder you open. Your [permission mode](permissions.md) decides what may start without you. Choose **Always ask** if you want to approve every task before it runs, and read what's being asked before you accept it. Keep a backup, or use Git, for work you care about.

Some kinds of decisions stay with you by default, in every mode: granting reach, irreversible changes, closing your own work, a pricier model and real-world to-dos. In **Elevated only**, work the agents propose waits for you too.

Studio coordinates its own workers to avoid clashing edits. It can't stop another editor or program from changing those files.

## Sharing a bug report

Include the app version, what you tried and the error you saw. Remove keys, tokens, private paths and project content from screenshots and log excerpts. Don't post `auth.json`, `community-auth.json`, `settings.json`, `session.json` or your `data` folder. From 0.5, also keep your vault pairing code private, and don't share a `.mefishare` file you haven't reviewed.

[Trace, logs and diagnostics](trace.md) explains how to gather logs safely.

## Report a security problem privately

Use the repository's **Security › Report a vulnerability** option, or follow the contact steps in [SECURITY.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/SECURITY.md). Include the version, whether you use the portable app or run from source, and the steps to reproduce it. Keep the details out of public issues until the maintainer has reviewed them.
