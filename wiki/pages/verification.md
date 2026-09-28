# Review results and keep your work

When an agent finishes an attempt, Studio checks the evidence before treating the task as complete. Open **Review** on Home, or the task's details, to see what happened.

A useful review answers three questions: what changed, which checks ran, and whether the result does what you asked.

## Read the result

Start with the agent's summary, then open the changed files or the running app. Compare the result with the task's brief and acceptance checks.

The task's **Evidence** and **History** show recorded checks and attempts. A claim such as “tests passed” needs a successful recorded run attributable to that attempt. A failed or unfinished check can keep the task in Review.

Some work, such as a small edit with no test command, can be verified from the recorded changes. Automated verification does not test every part of the experience, so try the result yourself when behavior or appearance matters.

## If the task is still waiting

A finished worker and a finished task are different stages. Studio may still be collecting evidence, running a check or waiting for a related task.

Read the reason shown on the card before retrying:

- **Evidence is pending:** give the records time to arrive.
- **A check failed:** inspect its command and output.
- **A question needs your answer:** open **Ask** or Vibe's **Needs you** drawer.
- **Follow-up work is unfinished:** open the linked task to see what remains.

Choose **Confirm done** after reviewing a result you want to accept. Studio records manual confirmation separately from automatic verification. If more work is needed, give a specific change request or use the task's retry action.

See [Tasks and the board](workflow.md) for task states and recovery controls.

## Where the board lives

Studio saves project records locally. A source install uses its `data/projects/<id>/` folders. A portable installation keeps its project data inside `resources/app/data`.

Your code stays in the project folder you opened. The Studio board, conversations and plans are separate from that code. Pushing a project to GitHub does not copy all of Studio's local records to another PC.

Settings and encrypted sign-ins also use the application's local Windows profile. Source and portable project stores are separate, so keep using the installation that holds your work.

## Back up or recover

Before moving or replacing a portable installation, close Studio and keep a copy of its data folder. Keep your project files backed up separately.

Normal release updates preserve the portable data folder. If the window crashes or disappears, reopen Studio and check the saved project before starting duplicate tasks.

For a blank window, a missing project or repeated verification failures, use [Troubleshooting](troubleshooting.md). Include the Studio version, task state and relevant error in a bug report; leave credentials and private project content out.
