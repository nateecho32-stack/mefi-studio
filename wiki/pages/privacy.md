# Privacy and security

Mefi Studio stores your work locally and has no usage telemetry or required Studio account. Connected services still receive the information they need to do the work you request.

## What stays local

Tasks, conversations, plans and project history are saved on your computer. A source install and a portable install have separate project stores. They can share settings and saved connections when run under the same Windows account.

API keys are encrypted with the Windows keystore and saved separately from preferences. Saved credentials are tied to the Windows account that created them; copying the files to another computer does not transfer a working login.

## What uses the network

| When you use… | What happens |
| --- | --- |
| An AI provider or coding agent | Prompts and relevant project context may go to that service. Check its terms before sending confidential work. |
| Web search or browsing | Requests go to the sites and search services being used. |
| Online video or music | The player connects to the media provider or the host of the file. |
| App updates | Studio checks GitHub for releases and downloads an update when you choose to install it. |
| An optional Discord link | Discord provides your account identity and membership details for the community server. This link does not read your messages or projects. |
| Shared listening, where available | The room service receives your shared media link and Discord name. Now-playing sharing is off until you enable it. Local music is labeled “Local music,” without its filename or path. |

Discord linking and shared rooms are still rolling out. Joining the [Discord community](https://discord.gg/xgfKc5pVxG) is separate from connecting your desktop app.

**Audio link** uses desktop audio or the microphone only when you turn it on. A “Hey Studio” voice shortcut is a future idea, not a feature of 0.4.4.

## Keep control of your project

Coding agents run real commands and can edit files in the folder you open. Choose **Always ask** if you want to approve work before it runs, and read the requested action before accepting it. Keep a backup or use Git for work you care about.

Studio coordinates its own workers to reduce conflicting edits. It does not prevent another editor or program from changing those files.

## Sharing a bug report

Include the app version, what you tried and the error you saw. Remove keys, tokens, private paths and project content from screenshots and log excerpts. Do not post `auth.json`, `community-auth.json`, `settings.json` or your `data/` folder.

## Report a security problem privately

Use the repository's **Security → Report a vulnerability** option, or follow the contact instructions in [SECURITY.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/SECURITY.md). Include the version, whether you use the portable app or source, and steps to reproduce. Keep details out of public issues until the maintainer has reviewed them.
