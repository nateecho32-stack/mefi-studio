# Public site and voice direction

The public name is **Mefi Studio**. The desktop package, executable, launcher and application identity retain their existing names so installed settings and update assets continue to work.

## Website and guide

[The website](https://nateecho32-stack.github.io/mefi-studio/) and [guide](https://nateecho32-stack.github.io/mefi-studio/wiki/) are published from the root of this repository's **gh-pages** branch. That branch has a separate history from the application on **main**. Edit the published branch, not an old local `website/` folder. GitHub Pages is configured to publish it automatically.

The community refresh is commit `3fdf4b903ac9b4f47cbbfafe79b109bc6312949e` on gh-pages. It updates the landing page, community page, public name and link previews; rewrites the 21 existing guide pages for 0.4.4; and adds a media/community page. Download assets retain their actual filenames.

The share image is `assets/studio-community-card.jpg`, with editable HTML/CSS alongside it. Use a new filename when replacing it so sharing services can distinguish the asset. Existing shared cards can remain cached by the service that displays them.

Current positioning: share ideas and work in progress in Discord, build with coding agents on your desktop, and help shape the project. The Discord bot is an external project. Shared desktop playback needs the rooms hub and Discord connection; cowork rooms and voice activation are future work. Do not advertise those future features as part of 0.4.4.

## 0.4.5 scope

The [release scope](release-scope-0.4.5.md) records the included desktop
work, service-dependent room features and deferred work. The public roadmap
and coming-in-0-4-5 guide on `gh-pages` show the same boundary. The Fleet
page already on `main` belongs to 0.4.5; its later lanes, missions and
cross-PC expansion are separate. Download links stay on 0.4.4 until a new
release is published.

## Proposed voice flow

“Hey Studio” is a design proposal, not an implementation in this change. The current microphone input drives the reactive tree's audio analyser; it does not transcribe speech.

A small first version could work like this:

1. The user enables voice activation or a push-to-talk shortcut.
2. A local wake detector recognizes the configured phrase and opens a visible listening popup.
3. Studio sends the following utterance to the transcription service the user selected.
4. The transcript appears as editable text before it is sent through the existing conversation or agent connection.
5. Spoken replies remain a separate optional preference.

Start with bounded recording and transcription. Consider live partial transcripts later. Let users configure a speech API or an optional local service; do not install a local service without an explicit setup action. The wake detector and local endpoint compatibility still need an implementation decision and testing.

OpenAI documents both [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text) and [transcription-only Realtime sessions](https://developers.openai.com/api/docs/guides/realtime-transcription). Neither guide supplies a local wake-word detector.

Keep speech authentication separate from coding authentication. A Codex connection can handle the text after transcription, but the reviewed documentation does not establish that a Codex subscription or CLI credential authenticates the general speech API. Plan on a separately configured API key for that option; confirm current service requirements before implementation. See [API setup](https://developers.openai.com/api/docs/quickstart).

## Validation of the site refresh

The static site was checked in hidden Electron at desktop and mobile sizes, including 320 px width. All 22 guide routes rendered; search, mobile navigation and keyboard skip-to-content worked. Local links, section anchors and images were checked. The new JPEG is 1200×630. Browser checks reported no console errors or horizontal overflow. Application code, package identity and local data were not changed.
