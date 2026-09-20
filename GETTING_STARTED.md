# Your first project in Mefi's Studio AI+

The in-app walkthrough opens automatically on your first launch and explains
the five steps below. You can close it whenever you want; it remembers your
place and stays closed on later launches. Choose **Start here** in the sidebar
or open the guide from Help to continue. Its links open the relevant controls;
reading the guide never creates or starts work.

## 1. Choose the folder you want to work on

In **Projects**, choose **+** and select an existing project folder, then select
the project in the sidebar. Check the name and folder above the conversation.
Tasks, conversations, plans and references belong to that project. For your
first run, use a small project whose changes you can easily inspect.

Choose **Auto build** in the guide or above **Your work**. It is on by default.
Turn it off for **Verify first** if you want to choose what gets built. This
preference is saved for all projects and can be changed at any time.

## 2. Connect your tools

Open **Settings & connections**. Configure your assistant connection and coding
provider using the connection controls there. Conversation and coding are
separate capabilities: saving an assistant key alone does not prove a coding
worker can start. Read the connection result before starting a task. The model
catalog, manual planning and browsing saved work remain available without AI.

## 3. Give one clear task

Choose **Give a task**, describe the intended change and what would count as
done, then choose **Create task**. **Use a task outline** adds space for the
goal, acceptance checks and boundaries. For example:

```text
Add a clear empty state to the saved notes list.

Done when:
- With no saved notes, show a short explanation and a Create note button.
- Creating a note replaces the empty state with the normal list.
- The layout works in the smallest supported window.

Keep unchanged:
The existing note format and save location.
```

Chat and task drafts are saved separately for each project. After creation,
**View task** opens the saved brief and status. A failed board refresh does not
mean creation failed; use **Retry loading** before adding the same work again.
If scheduling is paused, the task waits until you choose **Resume**.
With **Verify first**, open the task in **Review**, inspect its full brief,
files and prerequisites, then choose **Approve build**. Leave it waiting if
you do not want to build it. Editing the scope or explicitly retrying requires
approval again. Approval does not override Pause or unfinished prerequisites.

Use **Talk together** for discussion. Use **Plan an idea** when the approach is
unclear or the work has several dependent steps. In Plans, settle the questions,
review the specification, approve it, then explicitly create its tasks.

## 4. Follow the work

**Your work** gives you Open, Review, Done and Ideas views. **Node tree** opens
Command, where **Live work** shows running workers, reported steps and queue
readiness. Open a task to inspect its brief, dependencies, attempts and evidence.

| What you see | What it means | Next step |
| --- | --- | --- |
| Ready | Eligible for scheduling | Check Pause, the coding connection and any dispatcher hold |
| Awaiting build approval | Verify first is holding unapproved work | Review the full task and choose Approve build, or leave it waiting |
| Working | A worker has started | Follow its reported activity and inspect the result when it finishes |
| Waiting on prerequisites | Required tasks are unfinished | Open the named prerequisite |
| Retry scheduled | A failed attempt is cooling down | Inspect the failure and displayed retry time |
| Needs attention | A blocker or retry limit needs a decision | Open the task and correct the cause before retrying |
| Awaiting verification | The attempt finished but completion is not established | Review checks, evidence and delegated work |
| Done | Verified or explicitly confirmed complete | Read the result and inspect the actual project change |

**Work through backlog** admits saved ideas in small batches alongside existing
tasks. Independent tasks can use **Parallel builds**; shared files and unfinished
prerequisites can make a task wait even when another worker slot is available.

## 5. Review and recover

Open **Review** for unfinished verification and blocked tasks. A worker's exit
alone does not prove the intended behavior works. Read the evidence, run the
project's relevant checks and try the changed workflow before accepting it.

**Pause** stops new scheduling while current jobs finish. It does not cancel
them. If work stops progressing, read its last activity and the scheduling
reason before retrying. A worker that cannot be confirmed stopped retains its
file ownership, preventing another attempt from writing over it. Follow the
reported recovery instructions; do not delete task records or ownership files
to force another run. An unresponsive external operation can still require
restarting Studio after the external process is stopped.

Use **Settings & connections** for connection errors, **Tasks** for prerequisites
and retry limits, and **Session explorer** for session details. **Ctrl K** finds
tools, **H** returns home, **D** opens Command and **Esc** closes the current layer.

## Download and data notes

For a published Windows portable release, extract the entire application folder
before opening `Mefi Studio AI+.exe`; keep its supporting folders beside it.
Source installs use `npm ci`, `npm run build-booklet`, then `npm start` from the
repository root. The browser preview cannot run local desktop workflows.

Source and portable installations retain separate local project stores. Back
up the installation's local data before moving it. A downloaded release begins
with the public model catalog; it does not contain the maintainer's projects,
conversations or credentials. Ruins Runner is optional and is installed separately.
