# Plans and ideas

Keep ideas for later, and turn one into a reviewed plan before anything is built. You can write a plan yourself or let Mefi help.

## Keep ideas

An idea is a note about something you might build. It becomes a task only when you, or **Work through backlog** on Home, turn it into one.

- **Feature ideas** (`I`) is the inbox. New ideas arrive unread, such as the suggestions from a project's first map, or ideas found in your chats with **Scan chats for ideas** in Search. Select one to read it, keep it or mark it done.
- In Vibe, the **Fresh ideas** card and the **Ideas** panel show what's waiting. Each idea offers **Build it**, **Keep for later** (or **Not now**) and **Dismiss**.

## Plan it, or just build it?

Use **Build it** in Vibe when you can say what you want in a few sentences. Studio sizes it: a small change becomes one task, and a bigger one may become two to six steps.

Use a plan when the approach isn't clear yet: several ways to do it, decisions to make first, or work that depends on other work.

## Start with the outcome

Open **Plans** with `P` and choose **+ Plan an idea**. Give the plan a short name and say what should be true when it's finished. Add constraints and open questions you haven't settled.

For example:

> Let friends share a project link and a short progress update. Start with text and links. Decide who can see an update before choosing how to store it.

Your **planning partner** helps while you write. With **Write with Mefi**, it explores your project's files as you type. Its side panel switches between **Explore files** and **Suggestions**, **Help me write** drafts text for you, and **✦ Refine** polishes one field. Choose **Write manually** to write on your own.

To attach files, drop them into a box or use **Add files**. You can add up to 8 text or code files at a time, each up to 128 KB. A file's text goes into your draft for you to review, and nothing is sent until you ask Mefi.

Plans remember the step you last opened. **Continue where you left off** takes you back to it.

## The eight steps

| Step | Your part |
| --- | --- |
| **The idea** | Describe the outcome and its limits. |
| **Mefi asks** | Talk through the questions that shape the approach. |
| **Your decisions** | Record the requirements you want to keep. |
| **Your review** | Check **What we understand** and confirm it. |
| **Specification** | Write or ask for tasks, acceptance checks and prerequisites. |
| **Your approval** | Approve the specification once you've reviewed it. |
| **Build** | Create the tasks on the board. |
| **Verify** | Follow their results and check the finished work. |

## The interview

Mefi usually asks one question at a time. It keeps your answer apart from its own reading and recommendation. Copy a useful suggestion into the decision field, edit it and record it.

You can ask for several questions at once, or for the tradeoffs explained. If a reply fails, your answer stays saved, and **Continue with Mefi** picks the interview back up.

## What we understand

Review this summary once the open questions are settled, and confirm it before the specification is drafted.

Changing the goal or a decision makes the earlier confirmation out of date. Renaming the plan, or saving an unchanged specification, keeps your approval.

## Create and follow the tasks

Save your edits, review the specification and approve it. Then use the **Build** step to create its tasks. They follow the same permissions, prerequisites and queue controls as all other work.

Planning never starts coding workers by itself. [Tasks](workflow.md) explains what happens after the tasks exist, and [Verification](verification.md) covers finished work.

In Vibe, the **Plans** panel and the **Plan in flight** card follow a plan while it's being built.

> <span class="status next">New in 0.4.5</span> Plans show one step at a time, with an **Up next** button to the step that's waiting on you (**Show every step** lays the whole plan out again). The interview reads like a chat, and Mefi can ask the next question on its own. A new idea needs no name and offers **Idea starters**. **Where this lives** pins a plan to an area of your [project map](agent-brain.md). In Vibe, the plan panel shows a timeline of which agent is on each step.

## Check plans against your code

**Analyzer** (`A`, in the **Work** section) compares a project's old plans and notes with its current files. Its findings point to files and lines, missing references, or claims of finished work that need checking.

Start with **Analyze project**, which runs on your PC. **AI project read** uses your AI connection and sends selected excerpts, only when you ask for it. Use the findings to decide what to check or turn into a task.

## Set a plan aside

**Archive plan** makes a plan read-only and moves it under **Show archived**. **Restore plan** brings it back with everything it held. A project can have up to 300 plans in play; archived ones don't count.

Writing plans by hand works without any AI connection. The interview and the generated specification need a connected AI. Plans and their history stay in the project's local `planning.json`. See [Privacy](privacy.md).
