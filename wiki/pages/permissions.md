# Permissions and decisions

Your permission mode decides how much Mefi may start and decide without you. Every choice Mefi makes for you keeps its reason and an **Undo**, and some kinds of decision always stay yours.

The four modes arrived in 0.4.4. Clearer mode descriptions and a fix for the old **Auto build** switch are <span class="status next">New in 0.5</span>.

## The four modes

| Mode | New tasks | Agents' questions |
| --- | --- | --- |
| **Always ask** | Every new task, yours too, waits for your OK. | You choose each step. Mefi suggests an answer. |
| **Accept per task** | Every new task waits for your OK once. | After that, Mefi handles the task's ordinary questions. |
| **Auto** (the default) | Tasks start on their own, including ones agents propose. | Mefi answers when it's confident and leaves a suggestion for you when it isn't. |
| **Elevated only** | Your own tasks start on their own. Tasks agents propose wait for your OK. | Mefi handles ordinary choices and takes the safe option when it's unsure. |

In every mode, the elevated requests you keep (below) still come to you.

## Change your mode

All of these change the same saved setting:

- **In Vibe**, the permission chip in the box shows your mode. Click it to pick another. **Elevated requests…** opens the full settings.
- **In Vibe's Settings panel** (the gear at the top right).
- **In your companion's menu**, under **Settings** (called **Personality** from 0.5).
- **In Agents › Overview**.
- **In Search**: press `Ctrl K` and pick **Mefi's permission mode**.
- <span class="status next">New in 0.5</span> **In the setup helper**, under **Setup helper › Permissions**. See [The setup helper](#/setup-helper).

## Elevated requests

Open **Elevated requests…** to see six kinds of decision. A checked one stays yours, whatever your mode. All six start checked.

| Request | What it covers |
| --- | --- |
| **Granting reach** | Letting an agent touch more than its task allows |
| **Irreversible changes** | Changes that may be hard or impossible to undo |
| **Closing your work** | Dropping or closing a task you created |
| **Work agents propose** | In Elevated only, asking before tasks agents propose start. Auto starts them anyway. |
| **A pricier model** | Retrying with a heavier model or a larger budget |
| **Real-world to-dos** | Things only a person can do, kept in your **For you** list |

Unchecking **Granting reach** or **Irreversible changes** shows a warning first. Choose **Let Mefi handle this** to go ahead, or **Keep asking me**.

## What always waits for you

Some things never go to Mefi, whatever your mode:

- a task you put on hold yourself;
- a question the desk agent passes up to you;
- a question about whether work done outside Studio already covers a task;
- approving a build, when your mode asks for approval.

<span class="status next">New in 0.5</span> A task that another app on this PC files through **Settings › Other apps** waits for your OK in every mode. So does work you ask for from Discord, part of **Reach this PC from Discord** <span class="status rolling">Rolling out</span>, which works once the Studio bot is linked to the relay. See [Your PCs](#/your-pcs).

## Decided for you and For you

When Mefi has decided something for you, **Decided for you · For you** appears under Vibe's box, with a count for each.

- **Decided for you** lists Mefi's recent automatic choices. Open **Why** to read its reason, or choose **Undo** to put the question back to you. Undo waits for a running worker to finish, and it keeps any edits made since.
- **For you** holds real-world to-dos only a person can do, up to 50. Mark each one **Done** or **Not mine**.

Answers Mefi gives for you are marked **Mefi decided**, with a reason. They keep your stops and each task's retry limits, and they never count as your own preference. Mefi answers any one task's questions at most twice a day, so a failing task can't loop.

## How Mefi learns from you

Open the full permission settings (**Elevated requests…** from the chip, or Vibe's Settings panel) and scroll to **Learning**:

- **Learn from my answers** turns learning on or off. Turning it off keeps what was learned but stops using it.
- **Use my decisions from** picks **This project + others**, **This project** or **All projects**.
- **Learn model strengths from** offers the same choices, plus **Off**.
- **What Mefi has learned** lists the patterns for **This project** or **All projects**. **Forget** removes one, and **Forget all in this view** clears the list.

Recent answers count more than old ones, and corrections count double. Choosing **Undo** counts as a correction. What Mefi learns can make it surer of a choice, but it never widens what Mefi is allowed to do.

## Older switches

Two older switches pick a mode for you:

- **Auto build**, on some older screens and in brain maps: on picks **Auto**, off picks **Always ask**.
- **Let the desk handle asks**, in **Agents › Setup › Run behavior**: on picks **Auto**, off picks **Always ask**.

<span class="status next">New in 0.5</span> In 0.4.4, **Auto build** could overwrite your mode, turning **Elevated only** into **Auto** or **Accept per task** into **Always ask**. From 0.5 it leaves a matching mode alone: on keeps **Auto** and **Elevated only**, and off keeps **Always ask** and **Accept per task**. Each mode's description also says what happens to a new task.

## Related pages

- [Vibe mode](#/vibe-mode) shows where Needs you and Decided for you live.
- [Tasks](#/workflow) covers approving a build and task states.
- [Brain maps](#/brain-maps) explains the steps that raise questions.
- [Your companion](#/companion) keeps the list of what needs you.
