"""Booklet build contracts for Mefi's Studio AI+ (standalone repository).

The committed renderer/booklet.html must stay self-contained (no CDN, no
renderer-time fetch dependency), carry the baked catalog, refresh-on-open
logic, and print styles. Node is optional: when missing, only the static
file contracts run.
"""
from pathlib import Path
import json
import re
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
BOOKLET = STUDIO / "renderer" / "booklet.html"
TEMPLATE = STUDIO / "renderer" / "booklet.template.html"
CATALOG = STUDIO / "data" / "models.json"
BRAINS_CSS = STUDIO / "renderer" / "brains.css"
BRAINS_JS = STUDIO / "renderer" / "brains.js"


def normalized(text):
    """Newline-normalized copy so CRLF/LF working trees compare the same."""
    return text.replace("\r\n", "\n")


class MefiStudioBookletTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.booklet = BOOKLET.read_text(encoding="utf-8")
        cls.template = TEMPLATE.read_text(encoding="utf-8")
        cls.catalog = json.loads(CATALOG.read_text(encoding="utf-8-sig"))
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")
        cls.booklet_norm = normalized(cls.booklet)
        cls.brains_css = normalized(BRAINS_CSS.read_text(encoding="utf-8"))
        cls.brains_js = normalized(BRAINS_JS.read_text(encoding="utf-8"))

    def test_template_placeholders_are_documented(self):
        self.assertIn("__BOOKLET_DATA__", self.template)
        self.assertIn("__BOOKLET_CODE__", self.template)
        self.assertIn("__BOOKLET_STYLES__", self.template)

    def test_built_booklet_has_no_external_resources(self):
        self.assertNotIn("__BOOKLET_DATA__", self.booklet)
        self.assertNotIn("__BOOKLET_CODE__", self.booklet)
        self.assertNotIn("__BOOKLET_STYLES__", self.booklet)
        self.assertNotRegex(self.booklet, r"<script[^>]+src=")
        self.assertNotRegex(self.booklet, r"<link[^>]+href=")
        self.assertNotRegex(self.booklet, r"src=['\"]https?:")

    def test_brains_assets_are_inlined_exactly_once(self):
        # The committed booklet is the build-booklet output: brains.css and
        # brains.js must ride along verbatim, exactly once each, with no
        # src/href reference left behind. Anchors that only exist in the
        # brains assets keep the count honest even if neighboring content
        # shifts; the full-source counts catch a double-append outright.
        for label, source, anchors in (
            (
                "brains.css",
                self.brains_css,
                (".brains-overlay {", ".brains-sheet {", "Brain maps — the pipeline editor"),
            ),
            (
                "brains.js",
                self.brains_js,
                ("Brain maps: the pipeline editor",),
            ),
        ):
            with self.subTest(asset=label):
                self.assertEqual(
                    1,
                    self.booklet_norm.count(source),
                    f"{label} must be inlined verbatim exactly once",
                )
                for anchor in anchors:
                    with self.subTest(asset=label, anchor=anchor):
                        self.assertEqual(
                            1,
                            self.booklet_norm.count(anchor),
                            f"{label} anchor must appear exactly once",
                        )
        for filename in ("brains.js", "brains.css"):
            with self.subTest(leftover=filename):
                self.assertNotIn(
                    filename,
                    self.booklet,
                    "inlined assets must leave no filename reference behind",
                )
        self.assertNotRegex(self.booklet, r"<script[^>]+brains\.js")
        self.assertNotRegex(self.booklet, r"<link[^>]+brains\.css")

    def test_club_blackout_shell_is_baked(self):
        for marker in ("--gold:", "--live:", 'id="tree-rail"', 'id="tab-eyes"', "no-motion"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.booklet)

    def test_command_palette_and_toasts_are_baked(self):
        for marker in ('id="palette-overlay"', 'id="palette-input"', 'id="toast-host"', "MefiPalette", "MefiToast", "commandHome"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.booklet)

    def test_baked_catalog_matches_committed_catalog(self):
        match = re.search(
            r'<script id="booklet-data" type="application/json">(.*?)</script>',
            self.booklet,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "booklet must bake the catalog JSON")
        baked = json.loads(match.group(1))
        self.assertEqual(
            [model["id"] for model in self.catalog["models"]],
            [model["id"] for model in baked["models"]],
        )
        self.assertEqual(self.catalog["hash"], baked["hash"])

    def test_refresh_on_open_contract(self):
        for marker in (
            "mefiStudio.lastRefresh",
            'cache: "no-store"',
            "mefiStudio.readCatalog",
            "addEventListener(\"focus\"",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.booklet)
        self.assertRegex(self.booklet, r'refresh\("open"(?:,|\))')

    def test_print_styles_present(self):
        self.assertIn("@media print", self.booklet)

    def test_renderer_scripts_are_syntax_valid_when_node_exists(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        for name in ("booklet.js", "graph.js"):
            with self.subTest(script=name):
                result = subprocess.run(
                    [node, "--check", str(STUDIO / "renderer" / name)],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(0, result.returncode, result.stderr)

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_booklet.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
