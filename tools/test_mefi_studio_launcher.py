"""Launcher contracts for Mefi's Studio AI+ (standalone repository).

Pins the LÖVE launch shape (windowed love.exe on dev/dev_tool_love_project
with the optional game checkout as cwd), the sanctioned smoke path through
Run Dev Tool (LOVE2D).cmd, the IPC surface, the renderer's no-node
isolation, and — when Electron is installed — a real hidden smoke boot.
No Electron binary required; that half skips cleanly.
"""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
GAME_ROOT = Path(os.environ.get("MEFI_STUDIO_GAME_ROOT") or ROOT.parent / "2d Trippy Hell").expanduser().resolve()
ELECTRON = STUDIO / "node_modules" / "electron" / "dist" / "electron.exe"


class MefiStudioLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.booklet_js = (STUDIO / "renderer" / "booklet.js").read_text(encoding="utf-8")
        cls.package = json.loads((STUDIO / "package.json").read_text(encoding="utf-8-sig"))
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_package_entry_and_pinned_electron(self):
        self.assertEqual("main.cjs", self.package["main"])
        self.assertEqual("Mefi's Studio AI+", self.package["productName"])
        self.assertRegex(self.package["devDependencies"]["electron"], r"^\d+\.\d+\.\d+$")

    def test_love_launch_uses_windowed_runtime_and_dev_project(self):
        for marker in (
            '"build", "cache", "love-11.5-win64"',
            '"love.exe"',
            '"dev", "dev_tool_love_project"',
            'cwd: GAME_ROOT',
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        self.assertNotIn("lovec.exe", self.main, "interactive launches must not use lovec.exe")

    def test_smoke_goes_through_the_sanctioned_cmd(self):
        self.assertIn("Run Dev Tool (LOVE2D).cmd", self.main)
        self.assertIn("--smoke", self.main)

    def test_child_cleanup_and_env_guard(self):
        self.assertIn("taskkill", self.main)
        self.assertIn("ELECTRON_RUN_AS_NODE", self.main)

    def test_preload_exposes_the_studio_surface(self):
        for name in (
            "readCatalog",
            "launchStudio",
            "runSmoke",
            "launchGame",
            "stopStudio",
            "speedProbe",
            "onStudioLog",
            "eyesState",
            "eyesWatch",
            "eyesRequestsRead",
            "eyesCheckpointsRead",
            "eyesBriefingRead",
            "eyesCollisions",
            "assistantRun",
            "auditorRun",
            "checkpointAdd",
            "analyzerRun",
            "analyzerPick",
            "analyzerAi",
            "onBriefing",
            "onRequests",
            "onEyesActivity",
        ):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)
        self.assertNotIn("nodeIntegration: true", self.main)

    def test_capture_script_is_registered(self):
        self.assertIn("capture", self.package["scripts"])

    def test_renderer_stays_node_free_and_wires_actions(self):
        self.assertNotIn("require(", self.booklet_js)
        for action in ('data-action="launch"', 'data-action="smoke"', 'data-action="game"', 'data-action="stop"'):
            with self.subTest(action=action):
                self.assertIn(action, (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8"))
        for call in ("launchStudio()", "runSmoke()", "launchGame()", "stopStudio()"):
            with self.subTest(call=call):
                self.assertIn("mefiStudio." + call, self.booklet_js)

    def test_optional_game_launcher_prerequisites_exist(self):
        if not GAME_ROOT.is_dir():
            self.skipTest("Optional game checkout unavailable; set MEFI_STUDIO_GAME_ROOT to check its launcher")
        self.assertTrue((GAME_ROOT / "Run Dev Tool (LOVE2D).cmd").is_file())
        self.assertTrue((GAME_ROOT / "dev" / "dev_tool_love_project" / "main.lua").is_file())

    def test_server_styler_desktop_wiring(self):
        template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        self.assertIn("resolveStylerRoot", self.main)
        self.assertIn("MEFI_STYLER_ROOT", (STUDIO / "scripts" / "paths.cjs").read_text(encoding="utf-8"))
        for channel in ("styler:status", "styler:start", "styler:open", "styler:folder", "styler:stop"):
            with self.subTest(channel=channel):
                self.assertIn(f'ipcMain.handle("{channel}"', self.main)
                self.assertIn(f'ipcRenderer.invoke("{channel}"', self.preload)
        self.assertIn('id="server-styler-status"', template)
        for action in ("start", "open", "folder", "stop"):
            self.assertIn(f'data-styler-action="{action}"', template)
        self.assertIn("serverStylerStatus()", self.booklet_js)
        self.assertIn("/api/bootstrap", self.main)

    def test_electron_smoke_boots_when_installed(self):
        if not ELECTRON.is_file():
            self.skipTest("Electron not installed (npm ci in the Studio repository)")
        if os.name != "nt":
            self.skipTest("Electron desktop smoke is Windows-runner scoped")
        # A smoke ticks the assistant and writes app data. Exercise a clean
        # checkout without loading or changing the user's board or profile.
        with tempfile.TemporaryDirectory(prefix="mefi-studio-smoke-") as directory:
            temporary = Path(directory)
            app_root = temporary / "app"
            app_root.mkdir()
            for name in ("main.cjs", "preload.cjs", "README.md", "TESTRUNS.md", ".gitignore"):
                shutil.copy2(STUDIO / name, app_root / name)
            for name in ("renderer", "scripts", "assets", "tests"):
                shutil.copytree(STUDIO / name, app_root / name)
            (app_root / "tools").mkdir()
            for source in (STUDIO / "tools").iterdir():
                if source.is_file() and source.suffix in (".py", ".json"):
                    shutil.copy2(source, app_root / "tools" / source.name)
            (app_root / "data").mkdir()
            for name in ("curated.json", "models.json"):
                shutil.copy2(STUDIO / "data" / name, app_root / "data" / name)
            profile = temporary / "profile"
            session = profile / "session"
            session.mkdir(parents=True)
            (profile / "settings.json").write_text(
                json.dumps({"machine": {"autoKill": False}}), encoding="utf-8"
            )
            package = dict(self.package, main="smoke-entry.cjs")
            (app_root / "package.json").write_text(json.dumps(package), encoding="utf-8")
            (app_root / "smoke-entry.cjs").write_text(
                'const { app } = require("electron");\n'
                f'app.setPath("userData", {json.dumps(str(profile))});\n'
                f'app.setPath("sessionData", {json.dumps(str(session))});\n'
                'require("./main.cjs");\n',
                encoding="utf-8",
            )
            env = dict(os.environ)
            for name in (
                "ELECTRON_RUN_AS_NODE", "MEFI_STUDIO_KEY", "MEFI_STUDIO_ZAI_KEY",
                "MEFI_STUDIO_GATEWAY_KEY", "AI_GATEWAY_API_KEY", "TYPESAFE_API_KEY",
                "MEFI_STUDIO_JEV_KEY", "OPENCODE_ZEN_API_KEY", "MEFI_STUDIO_ZEN_KEY",
                "OPENROUTER_API_KEY", "MEFI_STUDIO_OPENROUTER_KEY", "MEFI_JEV_ROUTE",
                "MEFI_ZAI_API_KEY", "OPENCODE_CONFIG_CONTENT",
            ):
                env.pop(name, None)
            env.update({
                "HOME": str(profile),
                "USERPROFILE": str(profile),
                "MEFI_STUDIO_BOARD_DB": str(profile / "board.db"),
                "MEFI_STUDIO_REPO": str(app_root),
                "MEFI_STUDIO_GAME_ROOT": str(temporary / "absent-game"),
            })
            result = subprocess.run(
                [str(ELECTRON), ".", "--smoke"],
                cwd=app_root,
                capture_output=True,
                text=True,
                timeout=120,
                env=env,
            )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        marker = next((line for line in result.stdout.splitlines() if line.startswith("[smoke]")), None)
        self.assertIsNotNone(marker, result.stdout + result.stderr)
        payload = json.loads(marker.replace("[smoke]", "", 1).strip())
        self.assertGreater(payload["cards"], 0)
        self.assertIn("Mefi's Studio AI+", payload["title"])

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_launcher.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
