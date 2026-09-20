"""Assistant write-lock contract for Mefi's Studio AI+ (standalone repository).

A-Eyes overseer directive: scripts/assistant.mjs carries a claim map keyed by
case-normalized path around every edit dispatch, and two same-path writers
serialize — the second is held until the first releases. This test drives the
real exports (claimWrite / releaseWrite / heldWritePaths / claimWork) through
a Node stdin driver: two writers race the same file under two spellings
(``tools/x.py`` and an upper-case backslash absolute), exactly one is
refused, dispatch defers while the claim lives, and the refused writer
proceeds once the winner releases. The static half pins the registry and the
main.cjs dispatch wiring. Node checks skip cleanly without Node.
"""
from pathlib import Path
import json
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
ASSISTANT = ROOT / "scripts" / "assistant.mjs"
MAIN = ROOT / "main.cjs"
NODE = shutil.which("node")


def _run_driver(script):
    return subprocess.run(
        [NODE, "--input-type=module", "-", str(ROOT)],
        input=script,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )


DRIVER = """
import path from "node:path";
import { pathToFileURL } from "node:url";
const { claimWrite, releaseWrite, heldWritePaths, claimWork } = await import(
  pathToFileURL(path.resolve(process.argv[2], "scripts", "assistant.mjs")).href
);
const PATH_ONE = "tools/x.py";
const PATH_TWO = `${process.argv[2].toUpperCase()}\\\\TOOLS\\\\X.PY`;
// Two same-path writers race; the case-normalized key makes them collide.
const writers = await Promise.all([
  claimWrite(PATH_ONE, "writer-1"),
  claimWrite(PATH_TWO, "writer-2"),
]);
console.log(JSON.stringify({
  actions: writers.map((item) => item.action),
  held: heldWritePaths().length,
  advice: writers.find((item) => item.action === "refuse")?.advice ?? "",
}));
// While writer-1 holds the file, dispatch defers writer-2's pick.
const gate = claimWork({ work: { title: "writer-2 pick", files: [PATH_TWO] }, jobs: [] });
console.log(JSON.stringify({ action: gate.action, reason: gate.reason }));
// Writer-1 finishes: the claim drops and writer-2's rewrite proceeds.
console.log(JSON.stringify({ dropped: releaseWrite(PATH_ONE, "writer-1") }));
const second = claimWork({ work: { title: "writer-2 pick", files: [PATH_TWO] }, jobs: [] });
console.log(JSON.stringify({ action: second.action, reason: second.reason }));
console.log(JSON.stringify({ left: heldWritePaths().length }));
"""


class AssistantWriteLockTests(unittest.TestCase):
    def test_static_case_normalized_claim_map_guards_dispatch(self):
        module = ASSISTANT.read_text(encoding="utf-8")
        # the claim map exists, its key folds case, and dispatch consults it
        self.assertIn("const writeClaims = new Map()", module)
        self.assertIn('path.normalize(absolute).replace(/[\\\\/]+/g, "/").toLowerCase()', module)
        self.assertIn("heldWritePaths().filter((key) => named.some((item) => sameFile(key, item)))", module)
        self.assertIn("action: \"defer\",\n      reason: \"claimed\",", module)
        # every edit dispatch registers the claim under the run id and
        # releases it when the run finishes
        main = MAIN.read_text(encoding="utf-8")
        self.assertIn("const claimRegistry = assistantModule", main)
        self.assertIn("claimRegistry.claimWrite(claimPaths, entry.id)", main)
        self.assertIn("claimRegistry?.releaseWrite?.(claimPaths, entry.id)", main)
        self.assertIn("path.resolve(runRoot, file)", main)
        self.assertIn("Write-lock registry", main)

    def test_two_same_path_writers_serialize(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        result = _run_driver(DRIVER)
        self.assertEqual(0, result.returncode, result.stderr)
        race, gate, dropped, second, left = (json.loads(line) for line in result.stdout.splitlines())
        # exactly one writer is refused; the map holds exactly one claim
        self.assertEqual(sorted(race["actions"]), ["proceed", "refuse"], f"one refusal expected: {race}")
        self.assertEqual(race["actions"][0], "proceed")
        self.assertEqual(race["actions"][1], "refuse")
        self.assertIn("already claimed", race["advice"])
        self.assertEqual(1, race["held"], "one case-normalized entry, not two")
        # dispatch defers the second writer while the first holds the file
        self.assertEqual(("defer", "claimed"), (gate["action"], gate["reason"]))
        # release lets the second writer through: the writes serialized
        self.assertEqual(1, dropped["dropped"])
        self.assertEqual("proceed", second["action"])
        self.assertEqual(0, left["left"], "the registry is empty once the winner released")


if __name__ == "__main__":
    unittest.main()
