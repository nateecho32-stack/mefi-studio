"""Auditor contracts for Mefi's Studio AI+ (standalone repository).

Runs the real local auditor (scripts/auditor.mjs) against the repo and fails
on any error-level finding: un-bundled renderer scripts, preload channels
without main handlers, renderer DOM lookups missing from the template,
unregistered tests, missing script targets, and unparseable data files.
No network, no API key, no Electron; skips cleanly without Node.
"""
from pathlib import Path
import json
import shutil
import subprocess
import unittest

try:
    from flake_capture import retry_transient
except ImportError:  # imported as tools.test_mefi_studio_auditor
    from .flake_capture import retry_transient


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
AUDITOR = STUDIO / "scripts" / "auditor.mjs"


class MefiStudioAuditorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_auditor_is_wired_into_main_and_preload(self):
        for marker in ('ipcMain.handle("auditor:run"', 'ipcMain.handle("checkpoint:add"', "proactivePass"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        for name in ("auditorRun", "checkpointAdd"):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)

    def _audit_probe(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        result = subprocess.run(
            [node, str(AUDITOR)],
            cwd=STUDIO,
            capture_output=True,
            text=True,
            timeout=120,
        )
        payload = json.loads(result.stdout)
        messages = [f"{finding['level']}: {finding['area']}: {finding['message']}" for finding in payload["findings"]]
        self.assertEqual(0, payload["errors"], "\n".join(messages))
        self.assertEqual(0, result.returncode, "\n".join(messages))
        self.assertIn("checkedAt", payload)

    def test_auditor_reports_clean_on_this_repo(self):
        # Live-tree check: parallel agent runs edit the tree mid-suite, so a
        # one-shot failure that clears on immediate re-run is captured as a
        # flake (data/python-flake-capture.jsonl) instead of failing the gate.
        retry_transient(self._audit_probe, self.id(), "auditor:run on the live tree")

    def _check_targets_probe(self):
        pkg = json.loads((STUDIO / "package.json").read_text(encoding="utf-8-sig"))
        self.assertIn("check-targets.mjs", pkg["scripts"].get("check:targets", ""))
        self.assertTrue(
            pkg["scripts"]["check"].startswith("node scripts/check-targets.mjs && "),
            "the check chain leads with the check-targets audit",
        )
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        result = subprocess.run(
            [node, str(STUDIO / "scripts" / "check-targets.mjs")],
            cwd=STUDIO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("full coverage", result.stdout, "every source is covered by the check chain")

    def test_check_targets_leads_the_check_chain(self):
        # Same live-tree hazard as the auditor probe: a script added by a
        # concurrent agent mid-suite transiently breaks full coverage.
        retry_transient(self._check_targets_probe, self.id(), "check-targets on the live tree")

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_auditor.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
