# Connections and providers

One supported CLI sign-in can run Mefi Studio's conversation, planning, agents and coding. Start there if you already use Codex, Claude Code, Grok or Antigravity.

## Use an existing sign-in

Open **Help › Start here** or **Agents › Setup › Providers**.

1. Choose the CLI you want to use.
2. Select **Install and sign in** if it is missing, or **Sign in** to connect an existing installation.
3. Complete the provider's setup window.
4. Return to Studio and choose **Refresh installed tools**, then **Check connection**.
5. Select **Use for the whole studio**.

The connection check sends a small prompt using the selected account. Detection alone only confirms that a tool is installed.

**Use for the whole studio** applies the account to Studio's defaults and the current project. Projects with their own saved teams keep those choices. It also turns cross-provider fallback off, so another provider is not selected when that account fails.

Model access, usage limits and charges come from your provider. Studio does not supply an AI subscription.

## Other connection options

| What you use | Choose in Studio |
| --- | --- |
| OpenCode with linked providers | **OpenCode** |
| z.ai coding plan | **z.ai GLM** and your key |
| OpenCode Go | **OpenCode Go** and your key |
| OpenRouter | **OpenRouter** and your key |
| A running LM Studio server | **LM Studio (local)** |
| Another compatible model server | **Custom endpoint**, its URL and any required key |

Find provider forms under **Agents › Setup › Providers**. **Routing & fallback** controls which provider answers and whether Studio may try another.

Chat and coding have separate requirements. A local chat server, for example, does not install a coding worker. Check the setup status for both before submitting a build.

## Auto setup

**Run auto setup** chooses from saved keys, installed tools and available local servers. A fresh installation runs it once; you can run it again after adding a connection.

Auto setup reports what it selected. It does not send a paid test prompt or replace your saved keys. Use **Check connection** when you want to verify an account.

## Models and coding tiers

Model choices are saved per provider and per builder. Leaving a model blank uses that provider's default. You can assign different models to team roles in **Agents › Setup**.

Coding tiers select the model used for a build:

- **Auto** chooses for the task.
- **Free** restricts the build to a free route and one worker at a time.
- **Fast** uses the configured economical model.
- **Heavy** uses the configured higher-capability model.

Read the resolved model beside the tier before running work. Jev is an optional model-selection service; you do not need to configure it to use Studio.

## Keys and where they live

Studio encrypts saved keys with the Windows keystore. The interface shows whether a key is saved without returning its value. CLI sign-ins remain with their respective tools.

In a source installation, Studio credentials live in `%APPDATA%\Mefi's Studio AI+\auth.json`, separate from preferences. They belong to the Windows account that saved them. Enter keys again on another machine.

### Headless key setup

For scripted setup, pair an environment variable with the matching one-shot flag. For example, from a source checkout with dependencies installed:

```powershell
$env:MEFI_STUDIO_ZAI_KEY = "your-key"
npx electron . --set-zai-key
Remove-Item Env:MEFI_STUDIO_ZAI_KEY
```

The [.env.example](https://github.com/nateecho32-stack/mefi-studio/blob/main/.env.example) lists flags for the other providers. Clear the variable afterwards; while it is set, Studio can use it instead of the saved key.

See [Models, Model Lab and usage](model-lab.md) for account readings, or [Troubleshooting](troubleshooting.md) if a connection fails.
