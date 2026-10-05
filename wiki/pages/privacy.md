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
| The optional Discord link <span class="status rolling">Rolling out</span> | Linking reads your Discord id, username and display name, plus your roles and join date in the Void Engine server. It reads them when you link, about once a week after that, and when you press **Check now**. It never reads your messages, your email, other servers or anything about your projects. The sign-in is encrypted in `community-auth.json`, and **Unlink** revokes it. |
| Listen together and Share what I'm playing <span class="status rolling">Rolling out</span> | Nothing reaches the rooms hub until you pick a room or turn sharing on. Then Studio sends the hub your Discord sign-in once per 15-minute session, and the hub checks it with Discord and drops it. A room's shared player carries the link and your Discord name. **Share what I'm playing** is off until you turn it on, and local music shows only as "Local music", with no file name or path. The hub keeps both in memory only. |

Discord linking and rooms need the rooms hub that the Studio owner runs, and they're still rolling out. Joining the [Discord community](https://discord.gg/xgfKc5pVxG) is separate from linking the app, and you never have to do either.

**Audio link** uses desktop audio or the microphone only when you turn it on, and only to move the visuals: nothing is transcribed. A "Hey Studio" voice shortcut is an <span class="status idea">Idea</span>, not a feature.

## New network features in 0.5 <span class="status next">Coming in 0.5</span>

| Feature | What it sends, and where |
| --- | --- |
| **Share between my PCs** | Items you choose go to one private GitHub repository, `<you>/mefi-studio-vault`. Every file is sealed with AES-256-GCM, under a key only your paired PCs hold, so GitHub can't read it. Items are checked on the way out and on the way in, and keys go only after you type a confirmation. |
| **Share with friends** | Writes one item to a `.mefishare` file that you send however you like. Studio removes paths and names, refuses anything with a secret in it, and shows you exactly what's in it first. A friend's file is reviewed before you can use it, and it can never change your permissions. |
| **Keep this PC up to date** and the Your PCs look | Studio asks GitHub once a minute whether another PC pushed. The Friends badge looks 45 seconds after launch, then every 15 minutes. |
| **Set up this PC** | You sign in to GitHub in your browser. Studio never sees your password or token. |
| **Friends › Rooms** <span class="status rolling">Rolling out</span> | Room chat goes through the rooms hub. Every room says that Void Engine moderators can read it, and links in chat are never made clickable. |
| **Cowork rooms** <span class="status rolling">Rolling out</span> | The paths of the files a builder will edit go to the room you linked to the project. |
| **Friends › Playground** <span class="status rolling">Rolling out</span> | Your companion shares only at the level you allow, and **What was sent** lists every card that left. |
| **Reach this PC from Discord** | Off until you turn it on for each PC. It works once the Void Engine bot's side is live. Replies and alerts reach your DMs after keys, paths and addresses are scrubbed, and work filed from Discord always waits for your OK. |

## Keep control of your project

Coding agents run real commands and can edit files in the folder you open. Your [permission mode](permissions.md) decides what may start without you. Choose **Always ask** if you want to approve every task before it runs, and read what's being asked before you accept it. Keep a backup, or use Git, for work you care about.

Some kinds of decisions stay with you by default, in every mode: granting reach, irreversible changes, closing your own work, a pricier model and real-world to-dos. In **Elevated only**, work the agents propose waits for you too.

Studio coordinates its own workers to avoid clashing edits. It can't stop another editor or program from changing those files.

## Sharing a bug report

Include the app version, what you tried and the error you saw. Remove keys, tokens, private paths and project content from screenshots and log excerpts. Don't post `auth.json`, `community-auth.json`, `settings.json`, `session.json` or your `data` folder. From 0.5, also keep your vault pairing code private, and don't share a `.mefishare` file you haven't reviewed.

[Trace, logs and diagnostics](trace.md) explains how to gather logs safely.

## Report a security problem privately

Use the repository's **Security › Report a vulnerability** option, or follow the contact steps in [SECURITY.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/SECURITY.md). Include the version, whether you use the portable app or run from source, and the steps to reproduce it. Keep the details out of public issues until the maintainer has reviewed them.
