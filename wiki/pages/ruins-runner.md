# Ruins Runner

Ruins Runner is a separate LÖVE game project that Studio can launch. You do not need it to use Studio.

## Connect a game checkout

Studio looks for a sibling folder named `2d-Trippy-Hell` or `2d Trippy Hell`. If your checkout is elsewhere, set `MEFI_STUDIO_GAME_ROOT` to its full path before launching Studio.

For a source install, set it in the same PowerShell window:

```powershell
$env:MEFI_STUDIO_GAME_ROOT = 'C:\Projects\2d-Trippy-Hell'
npm start
```

Replace the example path with your checkout. Run `npm start` from the Studio application folder.

## Launch or test the game

Open **Settings → System → Integrations** for the available game launchers. If Studio reports that the LÖVE runtime is missing, follow the setup instructions in the game's repository. Stop an existing game run before starting another.

Keep the game files in their own checkout. Game tests use the game's documented pipeline, not Studio's application tests. You can also open the game folder as a normal Studio project.

## Why is it here?

Studio started alongside Ruins Runner and became a separate application in September 2026. The optional launcher remains for people working on the game. The [migration notes](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/migration.md) record that history.
