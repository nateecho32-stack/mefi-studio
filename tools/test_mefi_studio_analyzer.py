"""Analyzer contracts for Mefi's Studio AI+ (standalone repository).

Runs the real local analyzer (scripts/analyzer.mjs) against a fixture work
tree: file analysis (outline, markers, referenced-path existence) and idea
verification (keyword coverage, new vs related verdicts). Also pins the
main/preload/template wiring. No network, no key; skips cleanly without Node.
"""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
ANALYZER = STUDIO / "scripts" / "analyzer.mjs"
NODE = shutil.which("node")


def _fixture_tree(base):
    (base / "game").mkdir(parents=True, exist_ok=True)
    (base / "notes").mkdir(parents=True, exist_ok=True)
    (base / "game" / "fixture.lua").write_text(
        "local slippery = true\n-- slope mechanic aids travel\nfunction slopeTest() end\n", encoding="utf-8"
    )
    (base / "notes" / "design.md").write_text(
        "# Slope design\n\n- slippery slope mechanic idea\n\nTODO: wire the ropes\n\nSee game/fixture.lua and game/missing.lua\n",
        encoding="utf-8",
    )


class MefiStudioAnalyzerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def _run(self, args):
        result = subprocess.run([NODE, str(ANALYZER), *args], cwd=STUDIO, capture_output=True, text=True, timeout=120)
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_wiring_is_present(self):
        for channel in ('ipcMain.handle("analyzer:run"', 'ipcMain.handle("analyzer:pick"', 'ipcMain.handle("analyzer:ai"'):
            with self.subTest(channel=channel):
                self.assertIn(channel, self.main)
        for name in ("analyzerRun", "analyzerPick", "analyzerAi"):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)
        self.assertIn('id="analyzer-overlay"', self.template)
        self.assertIn('id="analyzer-drop"', self.template)

    def test_file_analysis_flags_outline_markers_and_missing_refs(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            _fixture_tree(base)
            result = self._run(["--file", str(base / "notes" / "design.md"), "--root", str(base)])
        self.assertEqual("file", result["kind"])
        self.assertEqual("Markdown", result["language"])
        labels = [entry["label"] for entry in result["outline"]]
        self.assertTrue(any("Slope design" in label for label in labels), labels)
        self.assertEqual(1, len(result["markers"]), result["markers"])
        references = {entry["ref"]: entry["found"] for entry in result["references"]}
        self.assertTrue(references.get("game/fixture.lua"), references)
        self.assertFalse(references.get("game/missing.lua"), references)
        messages = " ".join(finding["text"] for finding in result["findings"])
        self.assertIn("do not exist", messages)

    def test_idea_verification_finds_related_work_and_new_ground(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            _fixture_tree(base)
            related = self._run(["--idea", "slippery slope mechanic", "--root", str(base)])
            fresh = self._run(["--idea", "zzyzx quuxblat wibblewob", "--root", str(base)])
        self.assertNotEqual("new", related["verdict"], related)
        self.assertGreater(related["coverage"], 0)
        self.assertTrue(any("fixture.lua" in hit["file"] for hit in related["hits"]), related["hits"])
        self.assertEqual("new", fresh["verdict"], fresh)
        self.assertEqual(0, fresh["coverage"], fresh)
        self.assertEqual([], fresh["files"], fresh)

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_analyzer.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
