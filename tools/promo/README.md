# Work in Motion promotional film

Current deliverables in dist/promo/ (all silent, 30 seconds, H.264/yuv420p, 30 fps):

- **mefi-work-in-motion.mp4** — 1920 × 1080. The main film. A traveling agent grows a task tree, inspects images, works with smaller helpers and completes its tasks. Amber work states turn green; reports travel back through the branches. Fast, dimensional ASCII vignettes include rowing a boat, hammering a problem, a jumping robot and a rocket. The camera follows the work through a dark starfield with no ground or headline overlays.

Earlier circle films, flat cuts and soundtracks are superseded. This export has no audio stream. It illustrates the workflow; its ASCII thoughts are original animation, not captured private reasoning. No live state, credentials or workers are used. Unreleased features are labeled as a development preview.

## Reproduce

1. Create dist/promo/work if it does not exist. This film needs no UI captures.
2. Unset ELECTRON_RUN_AS_NODE.
3. Install only the isolated render dependency: npm install --prefix dist/promo/runtime --no-audit --no-fund --save-exact three@0.186.1.
4. Keep ffmpeg on PATH. Run node node_modules/electron/cli.js tools/promo/render-3d.cjs main --worktree. Add --preview to review key frames or --show to play the live scene.
5. node tools/promo/review-ascii.cjs writes review.html. Run node tools/promo/review-server.cjs and open http://127.0.0.1:4288/review.html.
6. Verify dimensions, duration, 900 frames, absence of audio, full decoding, and actual browser playback.

Keep a full-quality copy as mefi-work-in-motion-master.mp4. The delivered share
copy uses libx264, preset slow, CRF 23, maxrate 2300k, bufsize 4600k and
movflags +faststart. Both copies have
900 frames at 30 fps and no audio. Use ffmpeg to extract the 20.6-second poster
from the final sharing copy before running site.cjs.

worktree-stage.html and worktree-stage.mjs contain the current direction; ascii-glyphs.mjs contains the shared glyph renderer and original animation frames. Thoughts react at 2.52 beats per second while the agent works; main bodies and rings rotate slowly. Thought sculptures use three spatial glyph layers, pale highlights, teal surfaces, darker sides, blue water and warm tool details. Sphere glyphs have directional shading. The exporter verifies every composed frame with a pixel marker, then removes it before encoding. Posters and render reports accompany the output.

node tools/promo/site.cjs assembles GitHub Pages source in dist/promo/pages/ with the current videos and docs/promo-posts.md. It publishes nothing by itself.
