# FAQ

## Is it free?

Yes. Mefi's Studio AI+ is MIT-licensed and the portable build is a free download. The AI providers you connect have their own plans and prices; Studio pays for nothing on your behalf.

## Does it run on macOS or Linux?

Studio is built and tested on Windows 10 and 11, and saved keys rely on the Windows keystore. Other platforms are untested.

## Do I need an API key?

Not to open it. The model catalog, manual planning and saved work function with no connection. To chat you need one assistant route: a key, a signed-in CLI or a local LM Studio server. To build anything you also need a builder CLI installed and signed in. See [Connections and providers](connections.md).

## Which coding CLIs does it drive?

OpenCode (preferred), Claude Code, Codex, Grok and Antigravity. Studio detects which are installed; you choose one in **Settings › Coding workers**.

## Which provider should I use?

Whichever you already pay for. **Run auto setup** applies the best match for the keys, CLIs and local servers it finds, sends no request and changes no key. The [Model catalog](model-lab.md) helps you compare models on a route, and the **Free** coding tier costs nothing.

## Does it send my code anywhere?

Only to the providers you configured, when the assistant or a builder works on it. There is no telemetry and no hosted account. See [Privacy and security](privacy.md).

## Can several agents work at once without breaking each other's work?

Yes, within limits. File claims give one writer per path, **Parallel builds** follows measured responsiveness, and opt-in per-session worktrees give each run its own checkout. The locks are cooperative, so unrelated tools editing the same files can still collide. See [Tasks and the board](workflow.md#keeping-workers-apart).

## Can it keep working while I am away?

While the computer is on and Studio is running, yes: closing the window hides it to the tray and the service loop keeps going. Work interrupted by a crash or restart resumes on the next launch. It cannot work through a shutdown.

## Why does a finished task say "Awaiting verification" instead of Done?

Because a worker's exit alone does not prove the change works. The attempt carries its evidence, and completion is established by recorded checks or by you confirming it. See [Verification and storage](verification.md).

## Why does my download look different from the screenshots?

The screenshots show the current source, which has a navigation rail down the left edge. v0.2.0 puts the same destinations in a tabs row and the Command view dock. The next release brings the rail. See [What's new](whats-new.md).

## Can I use it on two machines?

Install it on each. Settings, keys, tasks and conversations are local state and do not travel, and saved keys cannot be decrypted on another machine.

## Where are my tasks stored?

In the app's local `data/` folder; a portable build keeps its own inside its folder. Plans live in the project's ignored `planning.json`. None of it is committed or uploaded.

## How do I update?

A portable build offers **Update to vX.Y.Z** in **Settings › Updates & diagnostics** when a newer release exists and installs it in place. A source checkout follows its files live. See [Live update and release updates](updates.md).

## What is Ruins Runner?

An optional, separate LÖVE game project that Studio can launch from **Settings › Integrations**. A fresh install works without it. See [Ruins Runner](ruins-runner.md).

## How do I contribute?

Code through pull requests that pass the three gates, wiki pages through this site's repository, and bugs through the issue templates. See [Contributing](contributing.md) and the [community page](../../community.html).
