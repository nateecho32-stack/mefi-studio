"""Claim registry contract for Mefi's Studio AI+ (standalone repository).

A-Eyes overseer directive: scripts/assistant.mjs must hold a claim registry
keyed by normalized absolute path and refuse dispatch to a second session on
that path. This test races ``./tools/x.py`` (relative, forward slashes)
against its absolute form (backslashes, upper case) and asserts the second
claim is refused — whatever way the path is spelled, the registry sees one
file. The behavioral half drives the real exports (writeClaimKey, claimWrite,
releaseWrite, heldWritePaths, claimWork) through a Node stdin driver; the
static half pins the registry lines. Node checks skip cleanly without Node.
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
const { writeClaimKey, claimWrite, releaseWrite, heldWritePaths, claimWork } = await import(
  pathToFileURL(path.resolve(process.argv[2], "scripts", "assistant.mjs")).href
);
const REL = "./tools/x.py";
const ABS = `${process.argv[2].toUpperCase()}\\\\TOOLS\\\\X.PY`;
// The race: relative vs absolute spelling of one path, two sessions.
const race = await Promise.all([
  claimWrite(REL, "session-a"),
  claimWrite(ABS, "session-b"),
]);
console.log(JSON.stringify({ race: race.map((item) => item.action), held: heldWritePaths().length }));
// The registry key collapses every spelling into one entry.
console.log(JSON.stringify({
  rel: writeClaimKey(REL),
  abs: writeClaimKey(ABS),
  equal: writeClaimKey(REL) === writeClaimKey(ABS),
}));
// Dispatch refuses a second session while the claim lives.
const deferred = claimWork({ work: { title: "second session", files: [ABS] }, jobs: [] });
console.log(JSON.stringify({ action: deferred.action, reason: deferred.reason, advice: deferred.advice }));
// Release frees the path; the refused session may then take it.
console.log(JSON.stringify({ dropped: releaseWrite(REL, "session-a") }));
const retry = claimWrite(ABS, "session-b");
console.log(JSON.stringify({ action: retry.action, reason: retry.reason }));
console.log(JSON.stringify({ left: heldWritePaths().length }));
"""


class ClaimRegistryTests(unittest.TestCase):
    def test_static_registry_is_keyed_by_normalized_absolute_path(self):
        module = ASSISTANT.read_text(encoding="utf-8")
        # the claim map and its normalized absolute key
        self.assertIn("const writeClaims = new Map()", module)
        self.assertIn("path.isAbsolute(raw) ? raw : path.resolve(MODULE_ROOT, raw)", module)
        self.assertIn('path.normalize(absolute).replace(/[\\\\/]+/g, "/").toLowerCase()', module)
        # the registry API exists and claimWrite refuses another owner
        self.assertIn("export function claimWrite(", module)
        self.assertIn("export function releaseWrite(", module)
        self.assertIn("export function heldWritePaths()", module)
        self.assertIn("action: \"refuse\",\n      reason: \"claimed\",", module)
        # claimWork consults the registry beside the sibling job list
        self.assertIn("heldWritePaths().filter((key) => named.some((item) => sameFile(key, item)))", module)
        # the dispatcher registers at dispatch and releases at finish
        main = MAIN.read_text(encoding="utf-8")
        self.assertIn("claimRegistry?.claimWrite", main)
        self.assertIn("claimRegistry?.releaseWrite", main)

    def test_registry_races_relative_against_absolute_and_refuses_the_second(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        result = _run_driver(DRIVER)
        self.assertEqual(0, result.returncode, result.stderr)
        race, keys, deferred, dropped, retry, left = (json.loads(line) for line in result.stdout.splitlines())
        # exactly one of the two racing claims wins; one registry entry remains
        self.assertEqual(sorted(race["race"]), ["proceed", "refuse"], f"one refusal expected: {race}")
        self.assertEqual(race["race"][0], "proceed", "the first claim wins")
        self.assertEqual(race["race"][1], "refuse", "the second session is refused")
        self.assertEqual(1, race["held"], "exactly one registry entry after the race")
        # both spellings collapse to one key
        self.assertTrue(keys["equal"], "relative and absolute agree on one key")
        self.assertTrue(keys["abs"].endswith("/tools/x.py"), keys["abs"])
        # dispatch refuses while the claim lives, and names the advice
        self.assertEqual(("defer", "claimed"), (deferred["action"], deferred["reason"]))
        self.assertIn("already claimed", deferred["advice"])
        # release frees the path and the refused session may take it
        self.assertEqual(1, dropped["dropped"])
        self.assertEqual("proceed", retry["action"])
        self.assertEqual(1, left["left"])


if __name__ == "__main__":
    unittest.main()
