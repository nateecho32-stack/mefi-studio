"""Measure real offscreen Electron startup using disposable app data and profile.

python tools/benchmark_startup.py [--source PATH] [--runs 3] [--output PATH]
Requires this checkout's installed Electron. Does not read the live board or keys.

Each run launches a copy of the source with --smoke (no launch screen, a hidden
window) while the page itself boots as a real launch: the launch gate, then the
home. The run is usable when that home is: Vibe (the default) with its first
read landed and its composer enabled, Build's workspace with its composer
enabled, or, for older sources, the catalog cards. Sources with startup marks
(scripts/startup-marks.cjs) also write --startup-report; its app ready, first
paint and gate release (ms since the main process started) are read from there.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def measure(source):
    # Windows' electron.exe; Linux's electron (a Linux run needs a display, e.g. xvfb-run).
    dist = ROOT / "node_modules/electron/dist"
    electron = dist / "electron.exe" if (dist / "electron.exe").exists() else dist / "electron"
    with tempfile.TemporaryDirectory(prefix="mefi-startup-") as folder:
        temporary = Path(folder)
        app_root = temporary / "app"
        app_root.mkdir()
        for name in ("main.cjs", "preload.cjs", "README.md", "TESTRUNS.md", ".gitignore"):
            shutil.copy2(source / name, app_root / name)
        for name in ("scripts", "renderer", "assets", "tests"):
            shutil.copytree(source / name, app_root / name)
        (app_root / "tools").mkdir()
        for item in (source / "tools").iterdir():
            if item.is_file() and item.suffix in (".json", ".py"):
                shutil.copy2(item, app_root / "tools" / item.name)
        (app_root / "data").mkdir()
        for name in ("curated.json", "models.json"):
            shutil.copy2(source / "data" / name, app_root / "data" / name)
        profile = temporary / "profile"
        startup_report = temporary / "startup-report.json"
        (profile / "session").mkdir(parents=True)
        (profile / "settings.json").write_text(json.dumps({"machine": {"autoKill": False}}), encoding="utf-8")
        package = json.loads((source / "package.json").read_text(encoding="utf-8-sig"))
        package["main"] = "benchmark-entry.cjs"
        (app_root / "package.json").write_text(json.dumps(package), encoding="utf-8")
        bootstrap = r'''
const electron = require("electron");
process.on("uncaughtException", (error) => { console.error(error.stack); electron.app.exit(1); });
process.on("unhandledRejection", (error) => { console.error(error?.stack || error); electron.app.exit(1); });
const started = performance.now();
let finishReady;
const ready = new Promise((resolve) => { finishReady = resolve; });
// A source with startup marks writes its report once the gate releases; give it
// up to 5 s to land before the smoke exits. Older sources never write one.
const reportFile = STARTUP_REPORT_PATH;
const reportWritten = () => new Promise((resolve) => {
  const end = Date.now() + 5000;
  const look = () => (require("node:fs").existsSync(reportFile) || Date.now() > end ? resolve() : setTimeout(look, 25));
  look();
});
global.__MefiMeasuredExit = () => ready.then(async (result) => { await reportWritten(); electron.app.exit(result?.vibeReady || result?.workspaceReady || result?.cards > 0 ? 0 : 1); });
electron.app.setPath("userData", PROFILE);
electron.app.setPath("sessionData", PROFILE + "/session");
const RealWindow = electron.BrowserWindow;
class MeasuredWindow extends RealWindow {
  constructor(options) {
    super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
    this.webContents.setFrameRate(60);
    this.webContents.once("dom-ready", () => console.log("[startup-dom] " + Math.round(performance.now() - started)));
    this.webContents.once("did-finish-load", async () => {
      const loadedMs = Math.round(performance.now() - started);
      try {
        const renderer = await this.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const end = performance.now() + 30000;
          let vibeAsked = false, vibeSettled = false;
          const poll = () => {
            const boot = document.getElementById('boot-layer');
            const launchReady = !window.MefiBoot?.isActive?.() && boot?.hidden !== false;
            const workspaceReady = Boolean(launchReady && window.MefiWorkspace?.isActive?.() && document.getElementById('workspace-send')?.disabled === false);
            // Vibe, the default home: usable once its first read has landed
            // (MefiVibe.ready) and its composer takes a request.
            const vibeActive = Boolean(launchReady && window.MefiVibe?.isActive?.());
            if (vibeActive && !vibeAsked) {
              vibeAsked = true;
              Promise.resolve(window.MefiVibe.ready?.()).then(() => { vibeSettled = true; }, () => { vibeSettled = true; });
            }
            const vibeReady = Boolean(vibeActive && vibeSettled && document.getElementById('vibe-input') && document.getElementById('vibe-build')?.disabled === false);
            const cards = document.querySelectorAll('.card').length;
            if (vibeReady || workspaceReady || (!window.MefiWorkspace && boot && boot.hidden && cards > 0)) {
              resolve({ readyMs: Math.round(performance.now()), cards, workspaceReady, vibeReady, home: vibeReady ? 'vibe' : workspaceReady ? 'workspace' : 'catalog' });
            } else if (performance.now() > end) reject(new Error('boot never became ready'));
            else setTimeout(poll, 10);
          }; poll();
        })`);
        console.log("[startup-ready] " + JSON.stringify({ loadedMs, readyMs: Math.round(performance.now() - started), renderer }));
        finishReady(renderer);
      } catch (error) { console.error("[startup-failed] " + error.message); finishReady(null); }
    });
  }
  loadFile(file, options = {}) { return super.loadFile(file, { ...options, query: { ...options.query, capture: "0", smoke: "0" } }); }
}
global.__MefiMeasuredWindow = MeasuredWindow;
require("./main.cjs");
'''.replace("PROFILE", json.dumps(str(profile))).replace("STARTUP_REPORT_PATH", json.dumps(str(startup_report)))
        (app_root / "benchmark-entry.cjs").write_text(bootstrap, encoding="utf-8")
        # Instrument only the temporary window constructor; normal boot,
        # rendering, IPC, and assistant code remain the production sources.
        main = app_root / "main.cjs"
        instrumented = main.read_text(encoding="utf-8").replace("new BrowserWindow({", "new global.__MefiMeasuredWindow({", 1)
        instrumented = instrumented.replace("app.exit(result.cards > 0 ? 0 : 1);", "global.__MefiMeasuredExit();", 1)
        main.write_text(instrumented, encoding="utf-8")
        env = dict(os.environ)
        for name in ("ELECTRON_RUN_AS_NODE", "AI_GATEWAY_API_KEY", "MEFI_STUDIO_GATEWAY_KEY", "TYPESAFE_API_KEY", "MEFI_STUDIO_JEV_KEY", "OPENCODE_ZEN_API_KEY", "MEFI_STUDIO_ZEN_KEY", "OPENROUTER_API_KEY", "MEFI_STUDIO_OPENROUTER_KEY", "MEFI_JEV_ROUTE", "MEFI_JEV_MODEL", "MEFI_AI_GATEWAY_BASE_URL", "MEFI_STUDIO_KEY", "MEFI_STUDIO_ZAI_KEY", "MEFI_ZAI_API_KEY", "OPENCODE_CONFIG_CONTENT"):
            env.pop(name, None)
        env.update(HOME=str(profile), USERPROFILE=str(profile), MEFI_STUDIO_BOARD_DB=str(profile / "board.db"),
                   MEFI_STUDIO_REPO=str(app_root), MEFI_STUDIO_GAME_ROOT=str(temporary / "absent-game"))
        start = time.perf_counter()
        with (temporary / "output.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(electron), ".", "--smoke", "--startup-report", str(startup_report)], cwd=app_root, env=env, stdout=log, stderr=log)
            try:
                process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
                process.wait(timeout=10)
        output = (temporary / "output.log").read_text(encoding="utf-8", errors="replace")
        records = [json.loads(line.removeprefix("[startup-ready] ")) for line in output.splitlines() if line.startswith("[startup-ready] ")]
        if process.returncode or not records:
            raise RuntimeError(output)
        return {**records[0], **startup_marks(startup_report), "processMs": round((time.perf_counter() - start) * 1000)}


# The startup report's headline marks, in ms since the main process started,
# when the source wrote one; {} for a source that predates startup marks.
def startup_marks(file):
    try:
        report = json.loads(Path(file).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    summary = report.get("summary") or {}
    marks = {"appReadyMs": summary.get("ready"), "firstPaintMs": summary.get("firstPaint"), "releaseMs": summary.get("release")}
    return {**{key: value for key, value in marks.items() if isinstance(value, (int, float))}, "startupReport": report}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT)
    parser.add_argument("--runs", type=int, choices=range(1, 11), default=3)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    results = []
    for index in range(args.runs):
        result = measure(args.source.resolve())
        results.append(result)
        home = (result.get("renderer") or {}).get("home", "catalog")
        marks = "".join(f", {label} {result[key]} ms" for key, label in (("appReadyMs", "app ready"), ("firstPaintMs", "first paint"), ("releaseMs", "gate released")) if key in result)
        print(f"run {index + 1}: loaded {result['loadedMs']} ms, interactive ({home}) {result['readyMs']} ms{marks}, smoke completed {result['processMs']} ms", flush=True)
    # loadedMs, readyMs and processMs count from the benchmark's own entry
    # script; the startup-report marks count from the main process's start.
    keys = [key for key in ("loadedMs", "readyMs", "appReadyMs", "firstPaintMs", "releaseMs", "processMs") if all(key in row for row in results)]
    report = {"source": str(args.source.resolve()), "runs": results,
              "median": {key: statistics.median(row[key] for row in results) for key in keys}}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["median"]))
