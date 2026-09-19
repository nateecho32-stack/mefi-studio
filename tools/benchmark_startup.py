"""Measure real offscreen Electron startup using disposable app data and profile.

python tools/benchmark_startup.py [--source PATH] [--runs 3] [--output PATH]
Requires this checkout's installed Electron. Does not read the live board or keys.
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
    electron = ROOT / "node_modules/electron/dist/electron.exe"
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
        (profile / "session").mkdir(parents=True)
        (profile / "settings.json").write_text(json.dumps({"machine": {"autoKill": False}}), encoding="utf-8")
        package = json.loads((source / "package.json").read_text(encoding="utf-8"))
        package["main"] = "benchmark-entry.cjs"
        (app_root / "package.json").write_text(json.dumps(package), encoding="utf-8")
        bootstrap = r'''
const electron = require("electron");
process.on("uncaughtException", (error) => { console.error(error.stack); electron.app.exit(1); });
process.on("unhandledRejection", (error) => { console.error(error?.stack || error); electron.app.exit(1); });
const started = performance.now();
let finishReady;
const ready = new Promise((resolve) => { finishReady = resolve; });
global.__MefiMeasuredExit = () => ready.then((result) => electron.app.exit(result?.workspaceReady || result?.cards > 0 ? 0 : 1));
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
          const end = performance.now() + 15000;
          const poll = () => {
            const boot = document.getElementById('boot-layer');
            const workspaceReady = Boolean(window.MefiWorkspace?.isActive?.() && document.getElementById('workspace-send')?.disabled === false);
            const cards = document.querySelectorAll('.card').length;
            if (workspaceReady || (!window.MefiWorkspace && boot && boot.hidden && cards > 0)) {
              resolve({ readyMs: Math.round(performance.now()), cards, workspaceReady });
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
'''.replace("PROFILE", json.dumps(str(profile)))
        (app_root / "benchmark-entry.cjs").write_text(bootstrap, encoding="utf-8")
        # Instrument only the temporary window constructor; normal boot,
        # rendering, IPC, and assistant code remain the production sources.
        main = app_root / "main.cjs"
        instrumented = main.read_text(encoding="utf-8").replace("new BrowserWindow({", "new global.__MefiMeasuredWindow({", 1)
        instrumented = instrumented.replace("app.exit(result.cards > 0 ? 0 : 1);", "global.__MefiMeasuredExit();", 1)
        main.write_text(instrumented, encoding="utf-8")
        env = dict(os.environ)
        for name in ("ELECTRON_RUN_AS_NODE", "AI_GATEWAY_API_KEY", "MEFI_STUDIO_GATEWAY_KEY", "MEFI_STUDIO_KEY", "MEFI_STUDIO_ZAI_KEY", "MEFI_ZAI_API_KEY", "OPENCODE_CONFIG_CONTENT"):
            env.pop(name, None)
        env.update(HOME=str(profile), USERPROFILE=str(profile), MEFI_STUDIO_BOARD_DB=str(profile / "board.db"),
                   MEFI_STUDIO_REPO=str(app_root), MEFI_STUDIO_GAME_ROOT=str(temporary / "absent-game"))
        start = time.perf_counter()
        with (temporary / "output.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(electron), ".", "--smoke"], cwd=app_root, env=env, stdout=log, stderr=log)
            try:
                process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
                process.wait(timeout=10)
        output = (temporary / "output.log").read_text(encoding="utf-8", errors="replace")
        records = [json.loads(line.removeprefix("[startup-ready] ")) for line in output.splitlines() if line.startswith("[startup-ready] ")]
        if process.returncode or not records:
            raise RuntimeError(output)
        return {**records[0], "processMs": round((time.perf_counter() - start) * 1000)}


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
        print(f"run {index + 1}: loaded {result['loadedMs']} ms, interactive {result['readyMs']} ms, smoke completed {result['processMs']} ms", flush=True)
    report = {"source": str(args.source.resolve()), "runs": results,
              "median": {key: statistics.median(row[key] for row in results) for key in ("loadedMs", "readyMs", "processMs")}}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["median"]))
