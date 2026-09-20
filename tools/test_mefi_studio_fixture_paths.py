"""Generalized unique-fixture contract for every Python test suite.

The A-Eyes collisions (and the flaky machine lease fixture) came from
contracts building fixtures at shared paths, so two concurrent runs wrote the
same file. `test_mefi_studio_eyes.py` pinned the pattern for its own suite
(`test_fixture_databases_use_unique_per_run_temp_dirs`); this contract
generalizes that pin across every sibling suite so no contract can regress to
shared fixture paths: fixtures live only inside per-run
`tempfile.TemporaryDirectory()` directories, never inside the repository tree
or the shared `tools/logs` evidence tree, every temp directory is used as a
context manager so it is per-run and cleaned up, and no suite shares a
basename that could shadow unittest discovery.
"""
from pathlib import Path
import re
import unittest


TOOLS = Path(__file__).resolve().parent
SELF = Path(__file__).resolve()


class MefiStudioFixturePathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.suites = {
            path: path.read_text(encoding="utf-8")
            for path in sorted(TOOLS.glob("test_mefi_studio_*.py"))
            if path != SELF
        }

    def test_every_contract_suite_is_covered(self):
        self.assertGreaterEqual(
            len(self.suites),
            10,
            "the pin must sweep the real contract suites, not an empty glob",
        )

    def test_no_suite_writes_fixtures_into_the_repository_tree(self):
        for path, source in self.suites.items():
            with self.subTest(suite=path.name):
                self.assertIsNone(
                    re.search(r"(?:ROOT|STUDIO)\s*/[^#\n]*(?:write_text|write_bytes|write_json)\(", source),
                    "fixtures must never be written into the repository tree",
                )
                self.assertIsNone(
                    re.search(r'(?:ROOT|STUDIO)\s*/\s*["\'][^"\']*\.db', source),
                    "no fixture database path is anchored inside the repository tree",
                )

    def test_no_suite_touches_the_shared_evidence_tree(self):
        for path, source in self.suites.items():
            with self.subTest(suite=path.name):
                self.assertNotIn(
                    "tools/" + "logs",
                    source,
                    "suites never build fixtures in the shared evidence tree",
                )

    def test_temp_directories_are_always_context_managed(self):
        for path, source in self.suites.items():
            code = re.sub(r"#.*", "", source)
            uses = re.findall(r"tempfile\.TemporaryDirectory\(", code)
            if not uses:
                continue
            with self.subTest(suite=path.name):
                managed = re.findall(r"with\s+tempfile\.TemporaryDirectory\(", code)
                self.assertEqual(
                    len(uses),
                    len(managed),
                    "every temp directory is a per-run context-managed directory",
                )

    def test_no_suite_shares_a_discovery_basename(self):
        for path in self.suites:
            siblings = {
                entry.stem.lower()
                for entry in TOOLS.iterdir()
                if entry != path
            }
            with self.subTest(suite=path.name):
                self.assertNotIn(
                    path.stem.lower(),
                    siblings,
                    "a duplicate basename shadows unittest discovery (guarded repo-wide by check:specs)",
                )

    def test_docs_register_this_contract(self):
        guide = (SELF.parents[1] / "TESTRUNS.md").read_text(encoding="utf-8")
        self.assertIn("`tools/test_mefi_studio_fixture_paths.py`", guide)


if __name__ == "__main__":
    unittest.main()
