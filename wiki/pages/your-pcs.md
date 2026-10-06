# Your PCs: sync and share

Do you work on the same project from more than one Windows PC? **Your PCs** keeps them in step through GitHub. Each PC keeps its own copy, and the project's default branch on GitHub is the one state they share. Studio shows what hasn't reached GitHub yet and only syncs in safe directions.

Choose **Friends** on the rail, then **Your PCs**. Search, and your [companion](#/companion)'s **Friends** bubble, open **Friends › Your PCs** directly too. Opening it only looks. Nothing moves until you press a button.

This page covers syncing, [My PCs](#my-pcs-your-pcs-work-as-one) (your PCs sharing the work), [Set up this PC](#set-up-this-pc), [Share between my PCs](#share-between-my-pcs) (your private vault) and [Share with friends](#share-with-friends).

## See what is only on this PC

Your PCs says whether this PC matches the open project's default branch on GitHub. It also lists work that hasn't reached GitHub yet, such as uncommitted files, commits you haven't pushed and branches that only exist here.

## Sync this PC

**Sync this PC** pulls what your other PCs pushed and pushes this PC's commits. It never overwrites uncommitted work or force-pushes.

<span class="status next">New in 0.5</span> Syncing gets safer and more automatic:

- **A lost-work guard.** Sync stops a push if a merge silently drops 200 or more lines of another branch’s changes, and names the merge and files. The report also flags recent suspicious merges.
- **Checked pushes.** If the project has a `check` script, Sync runs it first and pushes only when it passes.
- **Put my commits on top of GitHub's** appears when this PC and GitHub both moved and nothing is uncommitted. It puts your commits on top of GitHub's, checks and pushes. On a conflict it changes nothing and names the files.
- **Keep this PC up to date** is on by default. Studio asks GitHub once a minute whether another PC pushed, and brings the work in when nothing on this PC is in the way and no builder is running.
- **A badge on Friends.** The Friends bubble shows a badge for work only this PC holds, commits waiting on GitHub, or a GitHub that couldn't be checked. Studio looks 45 seconds after launch and then every 15 minutes.
- **A question before closing.** When the open project has work on this PC alone, closing Studio asks first: **Push and close**, **Close anyway** or **Keep Studio open**. Update restarts never ask.

## My PCs: your PCs work as one <span class="status next">New in 0.5</span>

Every PC you sign in to Friends on shows in **Your PCs**, live: its CPU, free memory, battery and how many tasks it runs, and why it isn't taking work.

- **Pair each PC once** by checking that both screens show the same six numbers. Only paired PCs can send each other work, so a Discord sign-in alone never can.
- **Send work here** starts a task on another PC, or moves a ready card to it.
- **Sharing the load.** When every slot on a PC has been busy for two minutes, it's short of memory that long, or a laptop's battery is at 20%, its ready cards move to a paired PC with a free slot and the same project open. A card is moved, never copied, at most two per project are out at once, and it's marked done here when the other PC finishes it.
- **A laptop on low battery.** At 20% it starts nothing new. At 10% it stops its work with the progress saved, parks the changes as a branch another PC can pick up, lets itself sleep, and waits for **Continue**. Plugging in isn't enough.
- **Keep this PC on** keeps a plugged-in PC awake with nothing running, so your other PCs can send it work.
- Each project has its own switch, and a friend can lend you their PC: your tasks there wait for their OK unless they choose otherwise.

Work sent between PCs is sealed, so the Mefi Studio relay that carries it can't read it.

## Set up this PC <span class="status next">New in 0.5</span>

**Set up this PC**, inside Your PCs, checks what a PC needs to share projects through GitHub:

- Git, the GitHub CLI and Node.js;
- a GitHub sign-in, done in your browser. Studio never sees your password or token;
- for the open project: that it's on GitHub, that its packages are installed, and that it sits on a drive that can hold Git worktrees. exFAT and FAT drives can't.

Each gap has a button, such as **Install Git** or **Sign in to GitHub**. It opens a visible setup window that runs Studio's own command.

**Get a project from GitHub** lists your own repositories. Pick one, choose **Choose a folder and get it**, and Studio downloads the project and opens it.

Under **Linking this PC**, the checklist also shows whether this PC is paired with your vault, and whether Discord is linked for Friends. Each line takes you to the place that finishes it.

## Share between my PCs <span class="status next">New in 0.5</span>

**Share between my PCs** moves what you choose between your own PCs through one private GitHub repository, `<you>/mefi-studio-vault`. Every file in it is sealed (AES-256-GCM) with a key that only your paired PCs hold, so GitHub can't read it. Nothing goes until you tick it.

### Pair your PCs

1. Sign in to GitHub on each PC. **Set up this PC** helps.
2. On your first PC, choose **Make my private vault**. Studio makes the repository and shows a pairing code.
3. On each other PC, type the code under **Pairing code from your other PC** and choose **Pair this PC**.

The pairing code opens your vault. Type it on your other PC yourself. Don't send it in a chat, an email or a screenshot.

### Send and receive

Under **Share from this PC**, pick a shelf, tick what to send and choose **Send to my PCs**. On your other PCs, the items show under **From my other PCs**, where you can keep them in your library or use them there.

The shelves are:

- how models did, by kind of task;
- what Mefi learned about how you work;
- agent team setups, agent brains and Playbook recipes;
- Claude Code memory notes;
- Studio preferences, without keys or addresses;
- open tasks and ideas. They arrive as ideas and never start work by themselves.

Brains, recipes, memory notes and ideas belong to their GitHub project and are used only there.

- **Checked both ways.** An item with a key, token, password or a login inside a link is stopped. Paths, your user and PC names, emails and network addresses are removed. Anything received that tells an agent to ignore its instructions, asks for keys, runs a downloaded script or sends data to a paste or webhook service is kept out.
- **Nothing is overwritten.** A received brain, team or recipe is added beside yours, with where it came from in its name. A memory note is only written where no note has that name. Model results and decisions you keep count as another PC's experience until you remove them.

### Keys and setup

Moving API keys is separate and strict. Open **Keys and setup**. The screen warns you that keys can be stolen, you type the confirmation sentence exactly, and Windows asks once more. On the other PC, choose **Check for shared keys**. The keys go straight into Windows' protected storage and are never shown. When your PCs have them, choose **Remove shared keys from the vault**. If you think a key leaked, replace it at its provider.

### Your PCs list

Each paired PC has a line that says when it last synced and what waits on it, per project. It also says what that PC's agents are doing, for example “Working on Add the login page · 1 needs you · 4 done today”. The line travels sealed like everything else, holds only short titles and counts, and refreshes at most every ten minutes. So you can see what a PC you left working is building.

## Share with friends <span class="status next">New in 0.5</span>

Show friends what works for you without showing them your PC. **Share with friends** saves one item to a `.mefishare` file: a brain, a recipe, a team setup, model results, a memory note or your preferences.

1. Pick the kind of item, then the item.
2. Choose **Preview**. Studio removes paths, user and PC names, emails, addresses and keys, and refuses anything with a secret in it. The preview is everything in the file.
3. Choose **Save share file** and send it however you like. Nothing is posted.

To use a friend's file, choose **Open a share file**. Studio reviews it first and keeps a risky file out. A clean one can go to your library. A friend's file only carries how agents behave and learn. It can never change your permissions or which models run.

## Start with Windows <span class="status next">New in 0.5</span>

Turn on **Start with Windows** in **Settings › General › Profile & startup**, or in the setup helper's **Machine & app**. Studio then opens in the tray when you sign in to Windows, on the project you had open, and the agents follow **Agents when Studio opens**. A PC you leave working keeps working after an update restart. The switch shows what Windows really holds, so it notices when Task Manager › Startup apps turns Studio off.

## Reach this PC from Discord <span class="status rolling">Rolling out</span>

**Reach this PC from Discord**, inside Your PCs, will let you check on this PC and talk to Mefi from a DM with the Void Engine bot. Studio's side is built for 0.5 and the relay carries it, but it works only once the Studio bot is linked to the relay, so it doesn't work today. [Reach your PCs from Discord](#/discord/reach-your-pcs-from-discord) explains what it will do.

## Good to know

- Your conversations stay on the PC where they happened. Saved keys stay too, unless you move them with **Keys and setup**.
- Running Studio from source? `npm run sync` in Studio's folder syncs Studio's own checkout the same way.

See also: [Friends, rooms and playdates](#/friends-and-rooms), [The setup helper](#/setup-helper) and [Privacy](#/privacy).
