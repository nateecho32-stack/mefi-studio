"""Session work accounting contracts for Mefi's Studio AI+ (A-Eyes overseer).

Pins the three accounting rules on one tick of the assistant pipeline:

1. The organizer (scripts/assistant.mjs organize()) collapses root sessions
   with identical normalized titles before counting slots — the duplicated
   "Pause polling on visibility hidden" pair becomes one session.
2. Work accounting caps in-progress todos at one per active session and
   requeues the overflow (organization.inProgress / requeuedTodos), so the
   watcher intel can never show more in-flight todos than active sessions.
3. The overseer digest derives work.inFlight from the freshest watcher
   report's in-progress todo count, so the digest and the watcher never
   disagree (watcher said 10 while the journal said 0); a stale report or no
   report at all falls back to the work journal.

Also pins the wiring: the watcher job reports the organization's capped
inProgress/requeuedTodos in its intel facts, and sameOrganization treats a
moved in-progress count as a changed tree. No network, no key, no Electron;
the Node half skips cleanly without Node.

Discovered by npm test through tools/test_mefi_studio_session_dedupe.py.
Standalone: python -m unittest discover -s tools -p "test_session_dedupe.py".
"""
from pathlib import Path
import json
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
NODE = shutil.which("node")

NOW = 1_800_000_000_000
MINUTE = 60_000

DUPLICATE_TITLE = "Pause polling on visibility hidden"


def _session(session_id, minutes_ago, title, **extra):
    row = {
        "id": session_id,
        "parentId": None,
        "title": title,
        "agent": "build",
        "model": {"id": "x"},
        "timeCreated": NOW - (minutes_ago + 60) * MINUTE,
        "timeUpdated": NOW - minutes_ago * MINUTE,
    }
    row.update(extra)
    return row


def _todos(pairs):
    return [
        {"sessionId": session_id, "content": f"todo {index}", "status": "in_progress", "position": index}
        for index, session_id in enumerate(pairs)
    ]


class SessionDedupeTest(unittest.TestCase):
    def test_fixture_session_work_accounting(self):
        """Dedupe, the in-progress cap, and the digest reconciliation."""
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = json.dumps(
            {
                "now": NOW,
                "duplicatePair": [_session("ses_a", 2, DUPLICATE_TITLE), _session("ses_a_clone", 3, DUPLICATE_TITLE)],
                "distinct": _session("ses_b", 4, "Draw the tide pool fish"),
                "cappedSessions": [_session("ses_c", 1, "Wire the crafting bench"), _session("ses_d", 2, "Draw the tide pool fish")],
                "manyTodos": _todos(["ses_c", "ses_d"] * 5),
                "workJournal": [{"id": "job_1", "kind": "audit", "role": "auditor", "text": "audit ran", "startedAt": NOW - 2 * 60 * MINUTE, "attempts": 1, "status": "running"}],
            }
        )
        script = """
import { applyIntel, normalizeState, organize, overseerDigest } from "file:///PROJECT/scripts/assistant.mjs";
const fixture = JSON.parse(process.argv[2]); // argv[1] is the "-" stdin script
const NOW = fixture.now, MINUTE = 60_000;

// --- member 3: the organizer collapses duplicate normalized titles ---------
const pair = organize({ sessions: fixture.duplicatePair, todos: [], now: NOW });
console.log(JSON.stringify({
  sessions: pair.counts.sessions,
  active: pair.counts.active,
  activeIds: pair.active,
  order: pair.order,
}));
const deduped = organize({ sessions: [...fixture.duplicatePair, fixture.distinct], todos: [], now: NOW });
console.log(JSON.stringify({
  sessions: deduped.counts.sessions,
  active: deduped.counts.active,
  activeIds: deduped.activeIds ?? deduped.active,
  order: deduped.order,
}));

// --- member 2: one active session per in-progress todo, overflow requeued --
const capped = organize({ sessions: fixture.cappedSessions, todos: fixture.manyTodos, now: NOW });
console.log(JSON.stringify({
  active: capped.counts.active,
  inProgress: capped.inProgress,
  requeuedTodos: capped.requeuedTodos,
  invariant: capped.inProgress <= capped.counts.active,
}));

// --- member 1: the digest reads the watcher's count, not its journal -------
const base = normalizeState({ work: fixture.workJournal }, NOW);
const silent = overseerDigest(base, NOW);
const heard = applyIntel(base, { role: "watcher", at: NOW - MINUTE, text: "2 active · 10 todo(s) in progress", facts: { sessions: 5, active: 2, inProgress: 10, openTodos: 12 } });
const told = overseerDigest(heard, NOW);
const old = applyIntel(base, { role: "watcher", at: NOW - 2 * 60 * MINUTE, text: "old scan", facts: { inProgress: 10 } });
const stale = overseerDigest(old, NOW);
console.log(JSON.stringify({
  journalOnly: silent.work.inFlight,
  watcherWins: told.work.inFlight,
  staleFallsBack: stale.work.inFlight,
  staleStillCounts: stale.work.stale,
}));

// one tick: the capped watcher number and the digest agree
const fresh = applyIntel(heard, { role: "watcher", at: NOW, text: "2 active · 2 todo(s) in progress", facts: { sessions: 2, active: 2, inProgress: capped.inProgress, openTodos: 12 } });
console.log(JSON.stringify({ agree: overseerDigest(fresh, NOW).work.inFlight === capped.inProgress }));
""".replace("PROJECT", STUDIO.as_posix())
        result = subprocess.run([NODE, "--input-type=module", "-", fixture], input=script, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, result.returncode, result.stderr)
        pair, deduped, capped, digest, agree = (json.loads(line) for line in result.stdout.splitlines())
        self.assertEqual(1, pair["sessions"], "the duplicated 'Pause polling on visibility hidden' pair is one session")
        self.assertEqual(1, pair["active"], "one active slot for one title")
        self.assertEqual(["ses_a"], pair["activeIds"], "the newest session of a duplicated title wins")
        self.assertEqual(["ses_a"], pair["order"], "the clone never reaches the rail order")
        self.assertEqual(2, deduped["sessions"], "the pair still collapses next to a distinct session")
        self.assertEqual(2, deduped["active"], "a distinct title keeps its slot")
        self.assertEqual(2, capped["active"])
        self.assertEqual(2, capped["inProgress"], "one in-progress todo per active session")
        self.assertEqual(8, capped["requeuedTodos"], "the overflow is requeued, not counted in flight")
        self.assertTrue(capped["invariant"], "watcher intel shows in-progress todos no greater than active sessions")
        self.assertEqual(1, digest["journalOnly"], "without a watcher report the work journal stands in")
        self.assertEqual(10, digest["watcherWins"], "the watcher said 10; the digest must not say 0")
        self.assertEqual(1, digest["staleFallsBack"], "a stale watcher report does not own the digest")
        self.assertEqual(1, digest["staleStillCounts"])
        self.assertTrue(agree["agree"], "digest and watcher report the same number on one tick")

    def test_same_organization_keeps_the_accounting_numbers(self):
        """A moving in-progress count refreshes the stored organization."""
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        script = """
import { organize, sameOrganization } from "file:///PROJECT/scripts/assistant.mjs";
const NOW = 1_800_000_000_000, MINUTE = 60_000;
const session = { id: "ses_a", parentId: null, title: "Wire the crafting bench", timeCreated: NOW - 60 * MINUTE, timeUpdated: NOW - MINUTE };
const todos = (count) => Array.from({ length: count }, (_, index) => ({ sessionId: "ses_a", content: `todo ${index}`, status: "in_progress", position: index }));
const one = organize({ sessions: [session], todos: todos(1), now: NOW });
const two = organize({ sessions: [session], todos: todos(2), now: NOW });
console.log(JSON.stringify({ same: sameOrganization(one, two), different: sameOrganization(one, one) }));
""".replace("PROJECT", STUDIO.as_posix())
        result = subprocess.run([NODE, "--input-type=module", "-"], input=script, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, result.returncode, result.stderr)
        verdict = json.loads(result.stdout)
        self.assertFalse(verdict["same"], "a changed in-progress count must not be mistaken for an unchanged tree")
        self.assertTrue(verdict["different"])

    def test_watcher_wiring_reports_capped_numbers(self):
        """The watcher job's intel facts carry the organization's capped counts."""
        main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        self.assertIn("organization.inProgress", main, "the watcher prefers the capped count")
        self.assertIn("organization.requeuedTodos", main, "the watcher reports the requeued overflow")
        self.assertIn("requeuedTodos,", main, "the requeued count rides the intel facts home")


if __name__ == "__main__":
    unittest.main()
