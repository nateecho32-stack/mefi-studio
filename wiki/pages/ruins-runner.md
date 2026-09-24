# Ruins Runner (optional)

Ruins Runner is the author's separate LÖVE game project. Studio grew up beside it and can launch it, but a fresh Studio install works without the game and never needs it.

## Launching it from Studio

**Settings › Integrations** holds the launcher when a game checkout is found. It starts the game's dev tool exactly like the game's own `Run Dev Tool (LOVE2D).cmd`, runs its smoke session, or starts the game itself.

**In source**, the launch line is built for `cmd.exe` properly, so **Run smoke** and **Launch Ruins Runner** work from any folder, and a game path `cmd.exe` cannot carry is refused with a message. In v0.2.0 both could fail with an error ending in "is not recognized"; launch the game with its own `.cmd` files until you update.

## Finding the checkout

Studio looks for a sibling `2d Trippy Hell` folder. Set `MEFI_STUDIO_GAME_ROOT` when the checkout lives somewhere else. If the LÖVE runtime is missing, run `tools/build-windows.ps1` once from the game's root.

## Rules

- Never move the game's files into the Studio repository. `MEFI_STUDIO_GAME_ROOT` selects the game checkout and `MEFI_STUDIO_REPO` another working repository.
- Game tests run through the game repository's own pipeline, not Studio's.
- Studio can also work on the game as a project like any other; each job records which repository it belongs to.

## History

Mefi's Studio AI+ was extracted on 19 September 2026 from `nateecho32-stack/2d-Trippy-Hell`. The old `mefi-studio/` folder became the Studio repository's root; the game and its other tools stayed in the original repository. See [docs/migration.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/migration.md).
