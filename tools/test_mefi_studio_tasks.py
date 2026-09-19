"""Task/reference/ideas contracts for Mefi's Studio AI+ (standalone repository).

Exercises the real reference engine (scripts/reference.mjs) on fixture data:
session matching, chat-idea scanning, reference grouping, and the CLI shape.
Pins the tasks/ideas/prefs IPC and preload wiring plus the overlay templates.
Web search is never called here (no network).
"""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
REFERENCE = STUDIO / "scripts" / "reference.mjs"
NODE = shutil.which("node")


class MefiStudioTasksTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_ipc_and_preload_wiring(self):
        for channel in (
            'ipcMain.handle("tasks:list"',
            'ipcMain.handle("tasks:save"',
            'ipcMain.handle("ideas:list"',
            'ipcMain.handle("ideas:save"',
            'ipcMain.handle("ideas:scan"',
            'ipcMain.handle("reference:gather"',
            'ipcMain.handle("prefs:get"',
            'ipcMain.handle("prefs:set"',
        ):
            with self.subTest(channel=channel):
                self.assertIn(channel, self.main)
        for name in ("tasksList", "tasksSave", "ideasList", "ideasSave", "ideasScan", "referenceGather", "prefsGet", "prefsSet", "onTasks", "onIdeas"):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)

    def test_overlays_exist(self):
        for overlay in ("tasks-overlay", "ideas-overlay", "overhead-overlay"):
            with self.subTest(overlay=overlay):
                self.assertIn(f'id="{overlay}"', self.template)
        for control in ("pref-web", "pref-tree", "pref-blur", "pref-auto", "reference-run", "task-new", "task-filter-all", "task-filter-open", "task-filter-done", "ideas-scan", "ideas-ai", "ideas-clean", "overhead-overview"):
            with self.subTest(control=control):
                self.assertIn(f'id="{control}"', self.template)

    def test_reference_cli_groups_fixture_context(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "game").mkdir(parents=True, exist_ok=True)
            (base / "game" / "tide.lua").write_text(
                "local tide = {}\n-- tide pools with glowing fish\nfunction tide.update() end\n", encoding="utf-8"
            )
            result = subprocess.run(
                [NODE, str(REFERENCE), "--text", "glowing tide pool fish", "--root", str(base)],
                cwd=STUDIO,
                capture_output=True,
                text=True,
                timeout=120,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            payload = json.loads(result.stdout)
        self.assertIn(payload["verdict"], ("related work exists", "likely already implemented"))
        self.assertTrue(payload["code"], payload)
        self.assertIn("game/tide.lua", payload["files"], payload)
        self.assertEqual([], payload["web"], "web stays off unless asked")

    def test_scan_ideas_and_matching_from_module(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        script = """
import { scanIdeas, matchSessions, referencesFor } from "file:///PROJECT/scripts/reference.mjs";
const chats = [
  { sessionId: "ses_a", at: 10, text: "We should add glowing tide pools to the fishing biome." },
  { sessionId: "ses_a", at: 11, text: "random line without trigger words here" },
];
const ideas = scanIdeas(chats);
const sessions = matchSessions([{ id: "ses_a", title: "Fishing biome tide pools", agent: "build", model: { id: "x" }, timeUpdated: 5 }], "glowing tide pools");
const refs = referencesFor({ text: "glowing tide pools", analysis: { verdict: "related work exists", coverage: 50, hits: [{ file: "game/tide.lua", line: 2, snippet: "tide pools", keyword: "tide" }] }, sessions, chats, pngs: [{ path: "C:/x/tide_preview.png" }], web: [], ideas: [] });
console.log(JSON.stringify({ ideas, sessions, refs: { code: refs.code.length, sessions: refs.sessions.length, chats: refs.chats.length, pngs: refs.pngs.length, files: refs.files } }));
""".replace("PROJECT", STUDIO.as_posix())
        result = subprocess.run([NODE, "--input-type=module", "-"], input=script, capture_output=True, text=True, timeout=60)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(1, len(payload["ideas"]), payload)
        self.assertIn("glowing tide pools", payload["ideas"][0]["title"].lower())
        self.assertEqual(1, len(payload["sessions"]))
        self.assertEqual(1, payload["refs"]["code"])
        self.assertEqual(1, payload["refs"]["chats"])
        self.assertEqual(1, payload["refs"]["pngs"], "png name matching keeps relevant evidence")

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_tasks.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
