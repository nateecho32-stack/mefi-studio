# Working from several PCs

GitHub is the meeting point. Each PC keeps its own clone, and the open project's default branch on GitHub is the one shared state.

This page holds the full description that used to sit in the README. The rules for Claude Code sessions and contributors are in [AGENTS.md](../AGENTS.md) ("Working across PCs"); the code paths are in [architecture.md](architecture.md) and [code-map.md](code-map.md).

## Your PCs

- **Friends › Your PCs** in the companion hub says whether this PC matches GitHub and lists anything that has not reached it yet: uncommitted files, unpushed commits, stashes, worktrees with changes, and branches that are not on `main`. Opening it only looks. **Sync this PC** pulls what your other PCs pushed and pushes this PC's commits on the default branch, but only after the project's own `npm run check` passes. It never overwrites uncommitted work, merges diverged histories or force-pushes.
- **Put my commits on top of GitHub's** appears when this PC and GitHub both moved and nothing is uncommitted. It rebases this PC's commits onto GitHub's, then checks and pushes. On a conflict it changes nothing and names the files.
- **The Friends bubble shows a badge** for work only this PC holds, commits waiting on GitHub, or a GitHub it could not check (a lapsed sign-in or a renamed repository). Studio looks 45 seconds after launch and every 15 minutes, and it only looks.
- **Closing Studio asks first** when the open project has work on this PC alone. You can push and close, close anyway, or keep Studio open. Update restarts never ask.
- **`npm run sync`** does the same from a terminal (`--rebase` to put your commits on top, `--no-check` to skip the check). **`npm run worktrees`** lists every worktree of the project with what to do about each.
- **A merge that drops another branch's work is caught.** If a merge keeps one side of files both sides changed (or a later commit puts the tree back to one parent) and 200 or more lines of the other side's work vanish, `npm run sync` refuses to push it and names the merge and the files; the session hook and Your PCs list recent ones. A deliberate choice is recorded with a `Lost-work-ok: <why>` line in the merge's commit message (or `--allow-lost-work` for one push). The generated booklet and TESTRUNS rows are exempt.
- **Set up this PC** (inside Your PCs) checks what a new PC needs: Git, the GitHub CLI, Node.js, a GitHub sign-in, and whether the open project is on GitHub, has its packages installed, and sits on a drive that can hold Git worktrees (exFAT and FAT cannot). Each missing piece has a button that opens a visible setup window running Studio's own fixed command. You sign in to GitHub in your browser, and Studio never sees the password or token. **Get a project from GitHub** lists your own repositories, clones the one you pick into a folder you choose (never onto exFAT), and opens it.
- **Claude Code** runs `node scripts/sync.mjs --hook` at the start of each new session (`.claude/settings.json`). The hook fetches, fast-forwards `main` when it can, and hands the report to Claude. `AGENTS.md` has the working rules.

Claude Code sessions and local branches stay on the PC that made them. Anything another PC needs belongs on GitHub.

## Share between my PCs

**Share between my PCs** (inside Your PCs) moves what you choose between your own PCs through one private GitHub repository, `<you>/mefi-studio-vault`. Every file in it is sealed (AES-256-GCM) with a key that only your paired PCs hold in Windows' protected storage, so GitHub cannot read it. Make the vault on your first PC, then type its pairing code on each other PC. Nothing goes until you tick it, and Studio checks every item on the way out and again on the way in.

- **Shelves:** how models did by kind of task, what Studio learned from your decisions, agent team setups, agent brains, Playbook recipes, Claude Code memory notes, your preferences (no keys, no addresses), and your open tasks and ideas. Brains, recipes, notes and ideas belong to their GitHub repository and are used only in that project.
- **Checked both ways:** an item with a key, token, password or a login in a link is stopped; paths, your user and PC names, emails and network addresses are removed; and anything received that tells an agent to ignore its instructions, asks for keys, runs a downloaded script or sends data to a paste or webhook service is kept out, never used.
- **Nothing is overwritten:** a received brain, team or recipe is added beside yours with where it came from in its name, a memory note is written only where none has that name, and ideas never start work by themselves. Model results and decisions you keep count as another PC's experience when Studio picks models and suggests what to do; remove them from the library and they stop counting.
- **Keys and setup** are separate and strict. The screen says in capitals that you are sharing keys and setup information that can be stolen, you type the confirmation exactly, and Windows asks once more. On the other PC they are saved straight into protected storage and never shown. Take them out of the vault once your PCs have them, and replace a key at its provider if you think it leaked.
- **Your PCs list** shows each paired PC, when it last synced, and what waits on it per project.
- **Keep this PC up to date** (on by default) asks GitHub every minute whether another PC pushed, and fast-forwards when this PC has nothing of its own in the way and no builder is running.
- **Agents on several PCs** coordinate through a cowork room linked to the project (Friends › Rooms): builders claim the files they will edit, every PC sees the claim within a second, and a task whose files another PC holds waits. Claims are held until the work is pushed.

## Share with friends

**Share with friends** saves one item (a brain, a recipe, a team setup, model results, a memory note or your preferences) to a `.mefishare` file you send however you like. Studio removes paths, user and PC names, emails, addresses and the repository name, refuses anything with a secret in it, and shows you exactly what the file holds first. Opening a friend's file runs the same review; a risky one is kept out, and a clean one goes to your library for you to use.
