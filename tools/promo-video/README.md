# Promo video

A 50-second, 1080p30 promotional film for Mefi's Studio AI+, built from the
screenshots in `docs/images/` and `assets/icon-256.png`. Everything in it is
generated here: no stock footage and no licensed music.

| File | What it does |
| --- | --- |
| `promo.html` | The film as one page. `window.seek(t)` draws the frame at `t` seconds; nothing animates on its own. Open it with `?play` to watch in real time or `?t=26.5` to hold one frame. |
| `music.mjs` | Synthesises the score (pad, arpeggio, kick, swells into each cut) as a 44.1 kHz WAV. 96 BPM, so each 2.5 s bar lines up with the scene cuts. |
| `render.mjs` | Seeks the page frame by frame in headless Chromium and pipes the PNGs and the score into ffmpeg. |

## Scenes

| Time | Scene |
| --- | --- |
| 0–5 s | Logo and name over the node constellation |
| 5–10 s | Talk it through · Hand it over · Watch it build · Know it's done |
| 10–17.5 s | Workspace: *Talk together*, then *Give a task* |
| 17.5–25 s | Command view: agents as live nodes, supported builder CLIs |
| 25–32.5 s | A task moves Ready → Working → Review → Done as its checks pass |
| 32.5–37.5 s | Brain maps and ad-free radio, with a feature ticker |
| 37.5–42.5 s | Local-first: keystore keys, no telemetry, no account, MIT |
| 42.5–50 s | Outro: version, platform, repository link |

## Render

Needs Node, Playwright with its Chromium (a global install is fine), and an
ffmpeg with libx264 on `PATH` or in `FFMPEG`. The page loads its fonts from
Google Fonts, so the first run needs network access.

```sh
node tools/promo-video/render.mjs                        # out/mefi-studio-promo.mp4
node tools/promo-video/render.mjs --stills 2,13,28,46    # out/stills/*.png
node tools/promo-video/music.mjs score.wav               # the score alone
```

A full render takes a few minutes. `out/` is ignored by Git.
