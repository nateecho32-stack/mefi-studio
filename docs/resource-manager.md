# The resource manager (Team › Resources)

Studio's agents build best with the PC to themselves. On a 16 GB laptop with a
browser, a chat app and two AI apps open, they often get 1 GB of free memory
and wait for more (the worker capacity check holds new workers below 440 MB
free). The resource manager makes room for them by holding back the **other**
apps on this PC: it can slow an app down, pause it, give its memory back to
Windows, ask it to close, or end it. You choose how it works:

- **Manual**: Studio changes nothing by itself. Every app has its own buttons,
  and **Make room now** does one round of what auto mode would do.
- **Auto**: while agents build (or work waits for the machine), Studio slows
  heavy apps you are not using, gives memory back when building runs short,
  and pauses or closes only the apps you allowed. It puts everything back once
  the agents finish.

It is on Team › Resources, in Search ("Resources", "Make room for building",
"Put back apps Studio slowed or paused"), and the status bar's CPU · Mem
reading opens it. It runs on Windows; on macOS and Linux the page says so and
nothing is touched.

## The actions

| Button | What it does | Undone by |
| --- | --- | --- |
| **Slow down** | The app gets the lowest priority (idle), Windows' efficiency mode (EcoQoS) and a low memory priority. It keeps working, but only gets the CPU the agents leave, and its memory is the first Windows takes back when memory runs low. Same as Task Manager's Efficiency mode. | Put back, Restore all, quitting Studio |
| **Pause** | Every thread of the app is suspended, then its memory is handed back to Windows. A paused app does no work at all; it carries on exactly where it was when it runs again. Switching to a paused app lets it run again at once. | Put back, Restore all, switching to it, quitting Studio |
| **Free memory** | Hands the app's memory back to Windows without stopping it (it empties the working set). The app takes back what it needs as you use it. | Nothing to undo |
| **Close** | Asks the app to close, as its own close button would (WM_CLOSE to its windows). It may ask you to save first, or keep running in the tray; the page then says so and End stops it. | Open the app again yourself |
| **End** | Stops the app at once, after a second press. Anything unsaved in it is lost. | Open the app again yourself |
| **Put back** | Undoes Slow down and Pause on one app. | — |
| **Restore all** | Undoes every Slow down and Pause, and holds auto mode off until the agents stop building. | — |

An app is what you would call one: Chrome's thirty processes are one Chrome,
and a launcher's web views (Steam's `steamwebhelper`) belong to the launcher.
Each app shows its share of the whole PC's CPU and the memory it holds (its
private working set, the number Task Manager shows), heaviest first.

## Auto mode

Auto mode only acts while **agents are building**: a worker is running, or work
is queued and waiting for the machine. For each app you have not told it
otherwise about:

1. If the app is **heavy** (10% of the PC's CPU or 500 MB of memory, both
   adjustable) and you are **not using it** (it is not in front of you and you
   have not used it in the last two minutes), it is slowed down.
2. If building is **short of memory** (less free memory than the amount you
   chose, 2 GB by default, or work is waiting for memory), background apps of
   250 MB or more give their memory back, at most once every three minutes
   each. The page then also lists the apps whose pausing would help most,
   with **Pause it now** and **Always pause it while building**. Auto mode
   never pauses an app on its own guess.
3. Each app's menu says what auto mode does with it:
   - **Auto decides**: the two steps above.
   - **Leave it alone**: never touched by auto mode.
   - **Slow it while building**: slowed whenever agents build, heavy or not.
   - **Pause it while building**: paused whenever agents build, unless you are
     using it.
   - **Close it while building**: asked to close once when agents start.
     Studio never opens it again.
4. Calls (Discord, Slack, Teams, Zoom), music and video players, recording
   (OBS), remote access (Parsec, TeamViewer, AnyDesk, ZeroTier, Tailscale),
   terminals and security software start as **Leave it alone**: slowing them
   can drop a call, stutter music or cut you off. Change any of them in its menu.
5. When the agents finish, everything auto mode did goes back after the delay
   you chose (one minute by default). What **you** did stays until you put it
   back.

Switching to a paused app always lets it run again, and auto mode leaves an app
you put back or switched to alone until the agents next stop building. A note
in the corner says what auto mode did, with **Open** and **Put back** (How
auto mode decides › Tell me when auto mode acts turns it off).

## What is never touched

Studio never slows, pauses, closes or ends:

- itself, the agents it started and everything they started;
- what Studio was started from (the terminal or launcher above it): pausing it
  could freeze Studio;
- Windows: anything under the Windows folder, every service (session 0), and
  any process Windows marks critical;
- another person's apps (another signed-in session);
- console windows (`OpenConsole`, `conhost`), which Studio may be writing to;
- security software (Microsoft Defender, Windows Security);
- a process Windows will not name for it (usually one running as
  administrator); Windows would refuse anyway.

These sit under the app list as **Never touched**, with their memory, so the
numbers add up.

## Nothing stays paused

Everything Studio slows or pauses goes back when Studio closes, whichever way it
closes:

- The work is done by a small helper program that runs beside Studio. When
  Studio quits, crashes or is ended, the helper's input closes, and it puts
  back everything it changed before it exits.
- Every change is also written to a journal in this PC's own Studio folder
  (`%LOCALAPPDATA%\MefiStudio\resources\journal.json`, never in OneDrive). If
  the helper itself is ended while it holds something, the next helper takes
  back what the journal says is still in effect, and the next Studio launch
  puts it all back.
- A process is identified by its id and its start time, so a reused process id
  is never mistaken for the app Studio changed.

## Under the hood

| Part | File |
| --- | --- |
| The rules: what is protected, processes as apps, CPU shares, auto mode's plan, the words | `scripts/resource-rules.cjs` (pure) |
| The host: the helper's lifecycle, holds, the loop, the journal, recovery | `scripts/resource-host.cjs` |
| The Windows helper: one read of the process table, and the actions | `scripts/resource-helper.cs` |
| The page and the toasts | `renderer/resources.js`, `renderer/resources.css` |
| The wiring | `main.cjs` "the resource manager for other apps" (`resources:*`), `preload.cjs` `resources*` |

- The helper is C#, built once per version of its source with the compiler
  Windows ships (.NET Framework 4's `csc.exe`) into
  `%LOCALAPPDATA%\MefiStudio\resources\resource-helper-<hash>.exe`. It starts
  in about a fifth of a second, uses about 18 MB, and reads every process in
  one call (`NtQuerySystemInformation`) in a few milliseconds, so the page can
  refresh every two seconds without loading the PC. It runs only while it is
  needed: the page is open, auto mode is acting, or an app is held; an idle
  helper with nothing held exits after two minutes.
- The protocol is one line per command on its stdin and one JSON line per
  answer on its stdout (the file's header lists the commands). Processes are
  named `pid:creationTime`, and the creation time travels as a string because
  it is larger than JavaScript numbers hold exactly.
- The page names an app by its key, never by a process id: the host finds the
  app's processes in its own latest picture and refuses anything protected.
- Settings are kept in `settings.resources`: the mode, each app's rule, the
  memory to keep free, the heavy thresholds, the delay before putting things
  back, giving memory back when short, and the toasts.
- It never decides when agents start; the worker capacity check
  (`scripts/machine.mjs` `workerCapacity`) still does. Making room is what lets
  that check pass sooner.

## Switches and limits

- `MEFI_STUDIO_NO_RESOURCE_MANAGER=1` turns it off for a launch. Test, capture
  and command-line launches never start it.
- Windows only for now. Without `csc.exe` (.NET Framework 4 is part of Windows
  10 and 11) the page says the helper cannot be built.
- An app running as administrator cannot be changed from Studio; the page says
  "Windows won't let Studio change it".
- Pausing an app that is in a call, downloading or streaming interrupts that.
  Leave those apps on **Leave it alone**.
- A paused app's memory goes to the page file; letting it run again reads it
  back, so a big app can take a few seconds to wake.

## Tests

`tests/resource_rules.test.mjs` (the rules), `tests/resource_host.test.mjs`
(the host against a scripted helper: the presses, auto mode's loop, Restore
all, a helper that dies, a launch that finds a journal), `tests/resources_ui.test.mjs`
(the page in a small DOM, and the wiring), and `tests/resource_helper_win.test.mjs`,
which builds the real helper and pauses, slows, adopts and ends a throwaway
process (Windows only).
