"""Machine coordination contracts for Mefi's Studio AI+ (standalone repository).

Feeds fixtures through the real scripts/machine.mjs: lease records (live,
stale, exclusive) and process classification (healthy, hang, orphan,
over-age). Pins the resource-manager wiring: IPC, preload, explorer panel,
briefing facts, status file path, and the gitignored generated files.
No PowerShell or LOVE is launched here.
"""
from pathlib import Path
import datetime
import json
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
MACHINE = STUDIO / "scripts" / "machine.mjs"
NODE = shutil.which("node")


class MefiStudioMachineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.gitignore = (STUDIO / ".gitignore").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_ipc_preload_and_panel_wiring(self):
        for channel in ('ipcMain.handle("machine:status"', 'ipcMain.handle("machine:watch"', 'ipcMain.handle("machine:set"', 'ipcMain.handle("machine:kill"'):
            with self.subTest(channel=channel):
                self.assertIn(channel, self.main)
        for name in ("machineStatus", "machineWatch", "machineSet", "machineKill", "onMachineStatus"):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)
        for element_id in ("machine-badge", "machine-lines", "machine-auto", "machine-list", "machine-events"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        self.assertIn("startMachineWatch", self.main)
        self.assertIn("machine-status.json", self.main)
        for ignored in ("data/machine-status.json", "data/resource-manager.json"):
            with self.subTest(ignored=ignored):
                self.assertIn(ignored, self.gitignore)

    def test_briefing_facts_carry_machine_state(self):
        self.assertIn("runningTests", self.main)
        self.assertIn('resourcePass({ kill: false, reason: "facts", withProcesses: false })', self.main)
        self.assertIn("withProcesses", self.main, "process scans must be optional for speed")

    def test_classify_fixture(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        now = 1_800_000_000_000
        fixture = {
            "now": now,
            "limits": {"idleSeconds": 240, "maxAgeMinutes": 20, "maxMemMB": 1500},
            "previousCpu": {"101": 5000, "102": 8000, "104": 900},
            "aliveParents": {"9000": True, "9001": True, "9002": True, "9003": True},
            "processes": [
                {"pid": 101, "parentPid": 9000, "name": "lovec.exe", "commandLine": "...\\lua_quality_runner", "startedAt": now - 60_000, "cpuMs": 5200, "memMB": 300},
                {"pid": 102, "parentPid": 9001, "name": "lovec.exe", "commandLine": "...\\.codex_smoke\\x", "startedAt": now - 600_000, "cpuMs": 8000, "memMB": 400},
                {"pid": 103, "parentPid": 9999, "name": "love.exe", "commandLine": "...\\dev_tool_love_project", "startedAt": now - 30_000, "cpuMs": 10, "memMB": 200},
                {"pid": 104, "parentPid": 9003, "name": "lovec.exe", "commandLine": "...\\lua_quality_runner", "startedAt": now - 40 * 60_000, "cpuMs": 1000, "memMB": 900},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            fixture_path = Path(directory) / "fixture.json"
            fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
            result = subprocess.run([NODE, str(MACHINE), "--classify-fixture", str(fixture_path)], cwd=STUDIO, capture_output=True, text=True, timeout=60)
            self.assertEqual(0, result.returncode, result.stderr)
            payload = json.loads(result.stdout)
        by_pid = {entry["pid"]: entry for entry in payload["verdicts"]}
        self.assertEqual("healthy", by_pid[101]["status"], by_pid[101])
        self.assertEqual("hang", by_pid[102]["status"], by_pid[102])
        self.assertTrue(by_pid[102]["killable"])
        self.assertEqual("orphan", by_pid[103]["status"], by_pid[103])
        self.assertEqual("over-age", by_pid[104]["status"], by_pid[104])
        self.assertEqual([102, 103, 104], sorted(entry["pid"] for entry in payload["killable"]))

    def test_lease_fixture(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        now = 1_800_000_000_000
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            lease_dir = repo / "tools" / "logs" / "_lease"
            lease_dir.mkdir(parents=True)
            fresh = datetime.datetime.utcfromtimestamp((now - 10 * 60_000) / 1000).isoformat() + "Z"
            (lease_dir / "111-aaaa.json").write_text(
                json.dumps(
                    {
                        "id": "111-aaaa",
                        "pid": 111,
                        "width": 2,
                        "exclusive": False,
                        "label": "pipeline:ui",
                        "agent": "tomps",
                        "startedUtc": fresh,
                    }
                ),
                encoding="utf-8",
            )
            (lease_dir / "222-bbbb.json").write_text(
                json.dumps(
                    {
                        "id": "222-bbbb",
                        "pid": 222,
                        "width": 8,
                        "exclusive": True,
                        "label": "perf",
                        "agent": "ghost",
                        "startedUtc": "2026-09-16T10:00:00Z",
                    }
                ),
                encoding="utf-8",
            )
            fixture = {"repoRoot": str(repo), "now": now, "alivePids": {"111": True, "222": False}}
            fixture_path = Path(directory) / "leases.json"
            fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
            result = subprocess.run([NODE, str(MACHINE), "--leases-fixture", str(fixture_path)], cwd=STUDIO, capture_output=True, text=True, timeout=60)
            self.assertEqual(0, result.returncode, result.stderr)
            payload = json.loads(result.stdout)
        self.assertTrue(payload["busy"])
        self.assertFalse(payload["exclusive"], "dead exclusive lease must not block")
        self.assertEqual(2, payload["totalWidth"])
        self.assertEqual(1, len(payload["holders"]))
        self.assertEqual(1, len(payload["staleHolders"]))
        self.assertEqual(222, payload["staleHolders"][0]["pid"])
        self.assertFalse(payload["staleHolders"][0]["alive"], "staleness here comes from the dead pid, not age")

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_machine.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
