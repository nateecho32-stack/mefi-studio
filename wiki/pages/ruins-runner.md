# Ruins Runner

Ruins Runner is a separate LÖVE game project that Studio can launch. You don't need it to use Studio.

## Connect a game checkout

Studio looks for a sibling folder named `2d-Trippy-Hell` or `2d Trippy Hell`. If your checkout is somewhere else, set `MEFI_STUDIO_GAME_ROOT` to its full path before you launch Studio.

For a source install, set it in the same PowerShell window:

```powershell
$env:MEFI_STUDIO_GAME_ROOT = 'C:\Projects\2d-Trippy-Hell'
npm start
```

Replace the example path with your own checkout, and run `npm start` from the Studio application folder.

Without a checkout, the launchers ask you to set `MEFI_STUDIO_GAME_ROOT` to a Ruins Runner checkout.

## Launch or test the game

Open **Settings › System › Integrations**. The Ruins Runner card has four buttons: **Launch Love2D studio**, **Run smoke**, **Launch Ruins Runner** and **Stop game**. It uses the game project's cached LÖVE runtime and its documented smoke-test script when they're there.

If Studio says the LÖVE runtime is missing, follow the setup steps in the game's repository. Only one game run can be open at a time, so stop the current run before you start another.

Keep the game files in their own checkout. Game tests run through the game's own documented pipeline, not Studio's application tests. You can also open the game folder as a normal Studio project.

## Why is it here?

Studio started out alongside Ruins Runner, and became a separate application on 19 September 2026. The optional launcher stays for people working on the game. The [migration notes](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/migration.md) record that history.
