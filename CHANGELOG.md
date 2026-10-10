# Website changelog

## 2026-10-10 — Live Discord widget

- Show the official Discord widget on Community, with online members and voice channels in a responsive embed.
- Keep a separate Join button available if the widget is blocked or its invite channel is unset.
- Use the server's current Vibe Studio name in the community introduction.

Validation: official widget renders online members and voice channels. Community checked at 1440 and 390 px without broken images, console errors or horizontal overflow; JavaScript syntax and diff whitespace checks pass. Site-only branch; app gates do not apply.

## 2026-10-09 — Vibe Studio refresh

- Rebrand public pages, the guide and link previews as Vibe Studio, with a lime-and-mint palette and a new V/spark mark.
- Open the homepage on the coming-soon announcement. Keep the guided demo one click away and the optional welcome at `?intro=1`.
- Explain first-week and first-month ranks, early flair and welcome rewards, free posting, lifetime donor status, monthly support and how discovery works.
- Replace the old participation-only credit policy with the announced launch support plan. Use the current Discord invitation everywhere.
- Preserve every existing page and section, downloadable app filenames, saved theme keys and the working project demo.

Validation: all public pages checked at 1440 and 390 pixels; no console errors, broken images or horizontal overflow. Static local links, section IDs, JavaScript syntax and JSON checked. Guided demo built a game-night page and its RSVP changed from 3 going to 4 going. Share artwork rendered at 1199 × 630. App gates are not applicable to this site-only branch.
