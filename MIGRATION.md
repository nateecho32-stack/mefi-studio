# Standalone extraction

Mefi's Studio AI+ was extracted on September 19, 2026 from
`nateecho32-stack/2d-Trippy-Hell`, based on commit
`dc714b27c4578103c10d6bf97999fc6c834cb46f` plus the working changes present at
extraction time.

The old `mefi-studio/` contents now live at this repository root. The Windows
launcher, 14 Python contract files, assistant handoff and local screenshot
captures moved with the application. The game, Mefi Loader and Love2d Studio
remain separate projects in the original folder.

The initial commit captures the current Studio source rather than importing
the game repository's history and previously tracked personal app state.
Earlier history remains in the original repository. Existing local source
and portable-build data were retained separately; neither is uploaded here.
The local `.local-migration/` directory contains a pre-edit source backup and
hash manifest and is excluded from Git.

See `README.md` for launch commands and the optional external game connection.
`HANDOFF_mefi_studio_assistant.md` is a historical implementation record;
its old nested paths and test counts describe the pre-extraction layout.
