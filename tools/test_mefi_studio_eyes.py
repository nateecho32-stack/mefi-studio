"""A-Eyes contracts for Mefi's Studio AI+ (standalone repository).

Builds a fixture OpenCode database matching the live schema, runs the real
scripts/eyes.mjs dump against it, and pins the change-feed math (edit diffs,
write content, patch file sets), plus the static IPC/theme wiring. Skips the
executable half when Node is unavailable; no network, no Electron, no LOVE.
"""
from pathlib import Path
import json
import re
import shutil
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
EYES_JS = STUDIO / "scripts" / "eyes.mjs"
FIXTURE_NOW = 1_800_000_000_000

# The live OpenCode store tables eyes.mjs reads. Fixture builders share it:
# a boundary db keeps session/todo empty (collisions read parts only).
_SCHEMA = """
create table session (
  id text primary key, parent_id text, title text, agent text,
  model text, directory text, cost real, tokens_input integer,
  tokens_output integer, tokens_cache_read integer, summary_files integer,
  summary_additions integer, summary_deletions integer,
  time_created integer, time_updated integer
);
create table todo (
  session_id text, content text, status text, priority text,
  position integer, time_created integer, time_updated integer
);
create table part (
  id text primary key, message_id text, session_id text,
  time_created integer, time_updated integer, data text
);
"""


def _fixture_db(path):
    db = sqlite3.connect(path)
    db.executescript(_SCHEMA)
    now = FIXTURE_NOW
    db.execute(
        "insert into session values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "ses_a",
            None,
            "Fixture session",
            "build",
            json.dumps({"id": "deepseek-v4.1-flash", "providerID": "opencode-go", "variant": "max"}),
            "C:/fixture",
            0.25,
            100,
            50,
            10,
            3,
            10,
            2,
            now - 60_000,
            now,
        ),
    )
    db.execute(
        "insert into session values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "ses_b",
            "ses_a",
            "Subagent session",
            "explore",
            json.dumps({"id": "gpt-5.6-luna", "providerID": "opencode-go"}),
            "C:/fixture",
            0.05,
            10,
            5,
            0,
            0,
            0,
            0,
            now - 30_000,
            now - 1_000,
        ),
    )
    db.executemany(
        "insert into todo values (?,?,?,?,?,?,?)",
        [
            ("ses_a", "first task", "completed", "high", 0, now - 50_000, now - 40_000),
            ("ses_a", "second task", "in_progress", "high", 1, now - 50_000, now),
        ],
    )
    diff = "\n".join(
        [
            "Index: C:/fixture/main.lua",
            "===================================================================",
            "--- C:/fixture/main.lua",
            "+++ C:/fixture/main.lua",
            "@@ -1,3 +1,4 @@",
            "-old line",
            "+new line",
            "+another line",
            " context",
        ]
    )
    parts = [
        (
            "part_edit",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/main.lua"},
                        "metadata": {"diff": diff},
                    },
                }
            ),
            "ses_a",
            now - 20_000,
        ),
        (
            "part_write",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "write",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/new.lua", "content": "line1\nline2\nline3"},
                    },
                }
            ),
            "ses_a",
            now - 19_999,
        ),
        (
            "part_patch",
            json.dumps({"type": "patch", "hash": "abc123", "files": ["C:/fixture/a.lua", "C:/fixture/b.lua"]}),
            "ses_a",
            now - 19_998,
        ),
        (
            "part_read",
            json.dumps(
                {"type": "tool", "tool": "read", "state": {"status": "completed", "input": {"filePath": "C:/fixture/main.lua"}}}
            ),
            "ses_a",
            now - 19_997,
        ),
        (
            "part_edit_b",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/main.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+only"},
                    },
                }
            ),
            "ses_b",
            now - 19_996,
        ),
        # Same session pair on a second file: must group into the same collision.
        (
            "part_shared_a",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/shared.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+shared a"},
                    },
                }
            ),
            "ses_a",
            now - 30_000,
        ),
        (
            "part_shared_b",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/shared.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+shared b"},
                    },
                }
            ),
            "ses_b",
            now - 29_000,
        ),
        # Same pair but 15 minutes apart: a stale hand-off, not a live collision.
        (
            "part_stale_a",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/stale.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+stale a"},
                    },
                }
            ),
            "ses_a",
            now - 1_800_000,
        ),
        (
            "part_stale_b",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/stale.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+stale b"},
                    },
                }
            ),
            "ses_b",
            now - 900_000,
        ),
        # Live pair on a file outside any repo root passed via --root.
        (
            "part_outside_a",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/outside/outside.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+outside a"},
                    },
                }
            ),
            "ses_a",
            now - 25_000,
        ),
        (
            "part_outside_b",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/outside/outside.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+outside b"},
                    },
                }
            ),
            "ses_b",
            now - 24_000,
        ),
        # ses_a's second shared.lua edit: makes ses_a the group owner (3 edits
        # vs 2) while main.lua's per-file owner stays ses_b (its latest edit).
        (
            "part_shared_a2",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/shared.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+shared a2"},
                    },
                }
            ),
            "ses_a",
            now - 28_500,
        ),
        # Owner with more history goes idle while a peer is still live:
        # that's a handoff, not a new owner. ses_c last-touched 11 min ago
        # (inactive); ses_d edited 8 min ago (active); the 3 min gap is
        # inside overlapMs so it stays a collision.
        (
            "part_handoff_c1",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/handoff.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+handoff c1"},
                    },
                }
            ),
            "ses_c",
            now - 12 * 60_000,
        ),
        (
            "part_handoff_c2",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/handoff.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+handoff c2"},
                    },
                }
            ),
            "ses_c",
            now - 11 * 60_000 - 30_000,
        ),
        (
            "part_handoff_c3",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/handoff.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+handoff c3"},
                    },
                }
            ),
            "ses_c",
            now - 11 * 60_000,
        ),
        (
            "part_handoff_d",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/handoff.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+handoff d"},
                    },
                }
            ),
            "ses_d",
            now - 8 * 60_000,
        ),
        # Negative case — idle-only pair: ses_e/ses_f overlap in time (2 min
        # gap, inside overlapMs) so a collision group still forms, but both
        # last edits are older than ACTIVE_EDIT_MS, so nobody is active. Like
        # ses_c/ses_d they have no session rows: collisions read parts only.
        (
            "part_idle_e",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/idleonly.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+idle e"},
                    },
                }
            ),
            "ses_e",
            now - 16 * 60_000,
        ),
        (
            "part_idle_f",
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "C:/fixture/idleonly.lua"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+idle f"},
                    },
                }
            ),
            "ses_f",
            now - 14 * 60_000,
        ),
        # Turn-end markers: ses_a's final step finished with reason "stop" (a
        # normal completion — finished even with a pending todo), ses_b's last
        # step ended mid-turn on "tool-calls" (not finished). These are not
        # tool parts, so the change/activity/collision math above never sees
        # them; only the finished flag reads them.
        (
            "part_finish_a",
            json.dumps({"type": "step-finish", "reason": "stop", "snapshot": "abc", "tokens": {"total": 25139}}),
            "ses_a",
            now - 500,
        ),
        (
            "part_finish_b",
            json.dumps({"type": "step-finish", "reason": "tool-calls", "snapshot": "abc"}),
            "ses_b",
            now - 400,
        ),
    ]
    for part_id, data, session_id, time_created in parts:
        db.execute(
            "insert into part values (?,?,?,?,?,?)",
            (part_id, f"msg_{part_id}", session_id, time_created, time_created, data),
        )
    db.commit()
    db.close()


def _boundary_db(path):
    """Boundary cases for the temporal-overlap window: adjacent windows that
    touch at one instant, a gap of exactly overlapMs (inclusive), one just past
    it (excluded), a fully contained window, a three-session nested group whose
    windows interleave so the common intersection is the innermost session's
    single instant, and two zero-length windows on the same single edit
    instant. Each case lives on its own file with distinct sessions, so the
    groups never merge."""
    db = sqlite3.connect(path)
    db.executescript(_SCHEMA)
    now = FIXTURE_NOW

    def edit(part_id, session_id, file_name, at):
        return (
            part_id,
            json.dumps(
                {
                    "type": "tool",
                    "tool": "edit",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": f"C:/fixture/{file_name}"},
                        "metadata": {"diff": "--- a\n+++ b\n@@\n+bound"},
                    },
                }
            ),
            session_id,
            at,
        )

    parts = [
        # Adjacent: s1's last edit and s2's first edit are the same instant, so
        # the shared window is zero-length (first == last) but still real.
        edit("b_adj_a1", "s1_adj", "adjacent.lua", now - 120_000),
        edit("b_adj_a2", "s1_adj", "adjacent.lua", now - 60_000),
        edit("b_adj_b1", "s2_adj", "adjacent.lua", now - 60_000),
        # Inclusive boundary: a gap of exactly overlapMs (10 min) is still a
        # collision — the windows never share a point, so overlap is inverted.
        edit("b_exact_a", "s1_exact", "exactgap.lua", now - 1_200_000),
        edit("b_exact_b", "s2_exact", "exactgap.lua", now - 600_000),
        # One millisecond past overlapMs: a stale hand-off, not a collision.
        edit("b_past_a", "s1_past", "pastgap.lua", now - 1_200_001),
        edit("b_past_b", "s2_past", "pastgap.lua", now - 600_000),
        # Contained: s2's whole window sits inside s1's, so the shared window
        # is exactly s2's (the intersection), not the outer span.
        edit("b_cont_a1", "s1_cont", "contained.lua", now - 300_000),
        edit("b_cont_a2", "s1_cont", "contained.lua", now),
        edit("b_cont_b1", "s2_cont", "contained.lua", now - 200_000),
        edit("b_cont_b2", "s2_cont", "contained.lua", now - 150_000),
        # Nested three-session group: outer ⊃ mid ⊃ tip. Every pair is inside
        # overlapMs so one three-session group forms, and the group's common
        # intersection collapses to the innermost session's single instant.
        edit("b_nest_o1", "s3_outer", "nested3.lua", now - 300_000),
        edit("b_nest_o2", "s3_outer", "nested3.lua", now),
        edit("b_nest_m1", "s3_mid", "nested3.lua", now - 200_000),
        edit("b_nest_m2", "s3_mid", "nested3.lua", now - 50_000),
        edit("b_nest_t1", "s3_tip", "nested3.lua", now - 100_000),
        # Zero-length: both sessions each made exactly one edit at the same
        # instant — the smallest possible real collision.
        edit("b_inst_a", "s1_inst", "instant.lua", now - 45_000),
        edit("b_inst_b", "s2_inst", "instant.lua", now - 45_000),
    ]
    for part_id, data, session_id, time_created in parts:
        db.execute(
            "insert into part values (?,?,?,?,?,?)",
            (part_id, f"msg_{part_id}", session_id, time_created, time_created, data),
        )
    db.commit()
    db.close()


class MefiStudioEyesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.eyes = EYES_JS.read_text(encoding="utf-8")
        cls.styles = (STUDIO / "renderer" / "styles.css").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.explorer = (STUDIO / "renderer" / "explorer.js").read_text(encoding="utf-8")
        cls.nav = (STUDIO / "renderer" / "nav.js").read_text(encoding="utf-8")
        cls.tasks = (STUDIO / "renderer" / "tasks.js").read_text(encoding="utf-8")
        cls.overhead = (STUDIO / "renderer" / "overhead.js").read_text(encoding="utf-8")
        cls.idle = (STUDIO / "renderer" / "idle.js").read_text(encoding="utf-8")
        cls.eyesRenderer = (STUDIO / "renderer" / "eyes.js").read_text(encoding="utf-8")
        cls.boot = (STUDIO / "renderer" / "boot.js").read_text(encoding="utf-8")
        cls.booklet = (STUDIO / "renderer" / "booklet.html").read_text(encoding="utf-8")
        cls.reconcile = (STUDIO / "scripts" / "reconcile-board.mjs").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_eyes_reads_the_store_read_only(self):
        self.assertIn("readOnly: true", self.eyes)
        self.assertIn("activitySince", self.eyes)
        self.assertIn("listPngs", self.eyes)
        self.assertIn("activeSessions", self.eyes, "assistantFacts names the live sessions on a collision")
        self.assertIn("function uncommittedOnly", self.eyes, "dirty-vs-HEAD features are detected")
        self.assertIn("function parsePorcelain", self.eyes)
        self.assertIn("function gitPorcelain", self.eyes)
        self.assertIn("ownerIsInactive", self.eyes, "inactive owners are a handoff, not a silent reassignment")
        self.assertIn("confirm handoff before further edits", self.eyes)
        self.assertIn("overlapRangeOf", self.eyes, "request inputs validate the overlap window before citing it")
        self.assertIn("first > last", self.eyes, "an inverted window is a handoff, never a shared clash")
        self.assertIn("typeof overlap !== \"object\"", self.eyes, "a corrupt range normalizes to null instead of reaching a prompt")

    def test_review_facts_carry_the_finished_signal(self):
        # A session that finished normally (final step-finish reason "stop")
        # but kept no todo list was flagged "Idle session lacks recorded work
        # … stalled or unscoped" — completed work read as a stall and re-filed
        # as a fix. The store now reports a finished session, the facts carry
        # the flag, and the review prompt may not alert finished sessions.
        self.assertIn('reason === "stop"', self.eyes, "only a normal step-finish ends a session")
        self.assertIn("finished: finished.has(row.id)", self.eyes, "listSessions carries the finished flag")
        self.assertIn("finished: session.finished === true", self.eyes, "assistantFacts carries the finished flag")
        # The three feed builders in main.cjs (checkpoint recentSessions, grow
        # recentTitles, grow archive) must carry the flag into every prompt.
        self.assertIn(
            "recentSessions: facts.sessions.map((session) => ({ title: session.title, agent: session.agent, finished: session.finished === true, todos: session.todos.slice(0, 6) }))",
            self.main,
            "checkpoint feed builder carries the finished flag",
        )
        self.assertIn(
            "recentTitles: base.sessions.slice(0, 6).map((session) => ({ title: session.title, finished: session.finished === true }))",
            self.main,
            "grow recent-titles feed builder carries the finished flag",
        )
        self.assertIn(
            ".map((session) => ({ id: session.id, title: session.title, agent: session.agent, finished: session.finished === true }))",
            self.main,
            "grow archive feed builder carries the finished flag",
        )
        self.assertEqual(3, self.main.count("finished: session.finished === true"), "exactly the three main.cjs feed builders carry the finished flag")
        self.assertIn("never alert it as idle, stalled, or unscoped", self.main, "the review prompt protects finished sessions")
        self.assertIn("Only sessions whose facts show open todos and no finished marker can be stale", self.main, "stale claims still need open todos")

    def test_main_registers_the_eyes_surface(self):
        for channel in (
            '"eyes:state"',
            '"eyes:log"',
            '"eyes:pins-read"',
            '"eyes:pins-write"',
            '"eyes:watch"',
        ):
            with self.subTest(channel=channel):
                self.assertIn(channel, self.main)
        self.assertIn("startEyesWatch", self.main)
        self.assertIn("eyes:activity", self.main)

    def test_settlement_heals_a_stale_saved_file_scope(self):
        # A collision card's saved scope copies session edit records verbatim;
        # after a project move those records name a path that no longer exists
        # and every dispatched worker burns its run hunting a ghost file. The
        # executor must re-anchor stale entries itself at settlement — Studio
        # heals its own store, a worker run may not rewrite saved scope.
        self.assertIn("resolveStaleFileScope", self.main, "settlement consults the scope resolver")
        # The settle row is built in the dispatcher core; main passes the heal in.
        core = (STUDIO / "scripts" / "executor-core.cjs").read_text(encoding="utf-8")
        self.assertIn("file scope healed", core, "the heal is visible on the card's work log")
        self.assertIn("scopeHeal, queuedJob }", self.main, "settlement hands the resolved heal to the settle row")
        self.assertIn("async function findBasenamesUnderRoot(root, bases", self.main, "the locator is a bounded basename search under the project root")
        self.assertIn('const SCOPE_WALK_SKIP = new Set(["node_modules", ".git", "dist"', self.main, "the walk never descends into dependency and build trees")
        self.assertIn("maxEntries = 20000, maxDepth = 6", self.main, "the walk is bounded so it can never hold the board lock long")

    def test_housekeeping_heals_every_stale_saved_file_scope(self):
        # Settlement only heals the card a run just finished; a done card never
        # settles again, so its saved scope would name a ghost path forever.
        # The housekeeping pass re-derives every saved scope from the filesystem
        # — walk outside the board lock, guarded apply inside the transaction.
        self.assertIn("async function healBoardFileScopes(", self.main, "a board-wide scope heal exists")
        self.assertIn('healBoardFileScopes("housekeeping")', self.main, "housekeeping runs the heal before its own mutation")
        self.assertIn("stillStale", self.main, "the apply re-checks the stale path is still the saved one")
        # The standalone migration pass carries the same heal so another
        # install's store can be repaired without the app running.
        self.assertIn("resolveStaleFileScope", self.reconcile, "reconcile-board re-anchors stale saved scopes")
        self.assertIn("--scope-heal", self.reconcile, "the focused pass skips compact/tidy side effects")
        self.assertIn("--data=", self.reconcile, "the pass can target another install's data dir")
        self.assertIn("SCOPE_WALK_SKIP", self.reconcile, "the script's walk uses the same skip list as the app")

    def test_preload_exposes_the_eyes_bridge(self):
        for name in ("eyesState", "eyesLog", "eyesPinsRead", "eyesPinsWrite", "eyesWatch", "onEyesActivity"):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)

    def test_poll_timers_pause_while_the_window_is_hidden(self):
        for name, source in (("eyes.js", self.eyesRenderer), ("nav.js", self.nav), ("overhead.js", self.overhead), ("idle.js", self.idle), ("explorer.js", self.explorer), ("tasks.js", self.tasks)):
            with self.subTest(source=name):
                self.assertIn("visibilitychange", source, f"{name} resumes its poll the moment the window is shown")
                self.assertIn("document.hidden", source, f"{name} skips its poll fetch while the window is hidden")
        self.assertIn("if (document.hidden) return;", self.eyesRenderer, "the log tail makes no fetch while hidden")
        self.assertIn('!document.hidden && state.mode === "log"', self.eyesRenderer, "the visible log snaps back on show")
        self.assertIn("if (!document.hidden) refreshBadges();", self.nav, "the badge poll makes no fetch while hidden")
        self.assertIn("function pollStart(key, fn, ms)", self.boot, "boot.js owns the shared poll guard other modules register through")
        self.assertIn("pollStop(key);", self.boot, "every start clears before it sets, so hide/show toggles cannot stack intervals")
        self.assertIn("if (!document.hidden) poll.timer = setInterval(fn, ms);", self.boot, "a poll started while hidden holds no timer until the window shows")
        self.assertIn("pollStart, pollStop", self.boot, "MefiBoot exposes the shared guard to the renderer modules")
        self.assertIn('window.MefiBoot.pollStart("nav.badges", badgeTick, BADGE_POLL_MS)', self.nav, "the badge poll's interval itself stops while the window hides, not just its fetch")
        self.assertIn('window.MefiBoot.pollStart("explorer.state", explorerTick, EXPLORER_POLL_MS)', self.explorer, "the explorer poll's interval itself stops while the window hides, not just its fetch")
        self.assertIn('if (document.visibilityState === "visible" && els.overlay && !els.overlay.hidden) load();', self.explorer, "the explorer poll reads the visibility state before each fetch while the sheet is open")
        self.assertIn('window.MefiBoot.pollStart("tasks.board", tasksTick, TASKS_POLL_MS)', self.tasks, "the tasks poll's interval itself stops while the window hides, not just its fetch")
        self.assertIn("if (!document.hidden && !els.overlay.hidden) load();", self.tasks, "the tasks poll makes no fetch while hidden or while the sheet is closed")
        self.assertIn('window.MefiBoot.pollStart("eyes.log", refreshLog, 5000)', self.eyesRenderer, "the eyes log poll's interval itself stops while the window hides, not just its fetch")
        # The built page bakes the renderer sources: the shared guard and the
        # badge poll's registration through it must survive the build.
        for marker in (
            "function pollStart(key, fn, ms)",
            "pollStart, pollStop",
            'window.MefiBoot.pollStart("nav.badges", badgeTick, BADGE_POLL_MS)',
            'window.MefiBoot.pollStart("explorer.state", explorerTick, EXPLORER_POLL_MS)',
            'window.MefiBoot.pollStart("tasks.board", tasksTick, TASKS_POLL_MS)',
            'window.MefiBoot.pollStart("eyes.log", refreshLog, 5000)',
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.booklet, "the built booklet.html carries the shared poll guard")
        self.assertIn("POLL_INTERVAL_MS", self.overhead, "the overhead poll resets to its base cadence while hidden")
        self.assertIn('if (document.visibilityState !== "visible") {', self.overhead, "the overhead poll reads the visibility state before each fetch")
        self.assertIn("if (!initialized || el.overlay.hidden) return;", self.overhead, "the overhead poll snaps back on show")
        self.assertIn("if (document.hidden) { cancelAnimationFrame(raf); raf = null; return; }", self.overhead, "the overhead frame pauses while hidden")
        self.assertIn("if (document.hidden) return; // hidden app: make no fetch", self.idle, "the 4s refresh tick makes no fetch while hidden")
        self.assertIn("if (document.hidden) return; // a hidden window never idles into Command", self.idle, "the idle auto-enter waits for a visible window")
        self.assertIn("if (state.active) tick();", self.idle, "the refresh pass runs the moment Command is shown again")

    def test_hidden_window_makes_zero_poll_fetches(self):
        """Fires visibilitychange against the real modules: the overhead timer and the explorer's shared-guard tick issue zero store reads while hidden, and resume on show."""
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        script = r"""
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.on("unhandledRejection", () => {});

function makeSandbox() {
  const stats = { fetches: 0 };
  const listeners = {};
  const timers = new Map();
  const ticks = {};
  let seq = 0;
  const byId = {};
  const noopCtx = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const makeElement = (id) => {
    const el = {
      id, hidden: false, textContent: "", title: "", value: "", placeholder: "",
      checked: false, disabled: false, className: "", dataset: {}, children: [],
      style: { setProperty() {}, removeProperty() {}, width: "", height: "", cursor: "" },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      append(...nodes) { el.children.push(...nodes); },
      appendChild(node) { el.children.push(node); return node; },
      addEventListener(type, fn) { (el._listeners ??= {})[type] ??= []; el._listeners[type].push(fn); },
      removeEventListener() {},
      click() { for (const fn of el._listeners?.click ?? []) fn({ target: el, preventDefault() {}, stopPropagation() {} }); },
      focus() {},
      getContext: () => noopCtx,
      getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 560 }),
      closest: () => null,
      querySelector: () => null,
      clientWidth: 800,
      clientHeight: 560,
      scrollTop: 0,
      scrollHeight: 0,
    };
    el.parentElement = { clientWidth: 800 };
    return el;
  };
  const doc = {
    readyState: "complete",
    body: null,
    activeElement: null,
    _vis: "visible",
    get hidden() { return doc._vis !== "visible"; },
    get visibilityState() { return doc._vis; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    getElementById: (id) => (byId[id] ??= makeElement(id)),
    createElement: () => makeElement("created"),
    createTextNode: (text) => ({ text, textContent: text }),
  };
  doc.body = makeElement("body");
  const win = {
    devicePixelRatio: 1,
    MefiNav: { noMotion: () => true, claim() {}, release() {}, go() {} },
    MefiTree: { snapshot: () => ({ nodes: [], edges: [] }) },
    MefiBoot: { pollStart: (key, fn) => { ticks[key] = fn; }, pollStop: () => {} },
    mefiStudio: {
      async tasksList() { stats.fetches += 1; return { tasks: [] }; },
      async eyesState() { stats.fetches += 1; return { ok: true, sessions: [], todos: [], changes: [] }; },
      async eyesRequestsRead() { return null; },
      async eyesCheckpointsRead() { return null; },
      async eyesBriefingRead() { return null; },
      async eyesCollisions() { return { collisions: [], presence: [] }; },
      async assistantState() { return null; },
      async machineStatus() { return { ok: true, status: {} }; },
      async machineSet() { return { ok: true, machine: { autoKill: true } }; },
      onAssistant() {},
      onMachineStatus() {},
      onCheckpoints() {},
      onBriefing() {},
      onRequests() {},
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const sandbox = {
    document: doc,
    window: win,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout: (fn) => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => { const id = ++seq; timers.set(id, fn); return id; },
    clearInterval: (id) => timers.delete(id),
    console,
    __stats: stats,
    __ticks: ticks,
    __fire: (type) => { for (const fn of listeners[type] ?? []) fn(); },
    __pump: (times) => {
      for (let i = 0; i < times; i += 1) {
        const due = [...timers.values()];
        timers.clear();
        for (const fn of due) fn();
      }
    },
    __flush: flush,
  };
  return { sandbox, context: vm.createContext(sandbox) };
}

function boot(path) {
  const { sandbox, context } = makeSandbox();
  vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  return sandbox;
}

// Overhead: the sheet owns a re-arming timer; each pass reads the visibility
// state before fetching, so a hidden window pumps the timer with zero reads.
const overhead = boot(__OVERHEAD__);
await overhead.window.MefiOverhead.open();
await overhead.__flush();
const overheadOpen = overhead.__stats.fetches;
overhead.__pump(1);
await overhead.__flush();
const overheadVisible = overhead.__stats.fetches;
overhead.document._vis = "hidden";
overhead.__fire("visibilitychange");
overhead.__pump(8);
await overhead.__flush();
const overheadHidden = overhead.__stats.fetches;
overhead.document._vis = "visible";
overhead.__fire("visibilitychange");
await overhead.__flush();
const overheadResumed = overhead.__stats.fetches;

// Explorer: its tick registers through boot.js's shared poll guard; fire the
// captured tick and the visibilitychange listener at each visibility state.
const explorer = boot(__EXPLORER__);
explorer.document.getElementById("explorer-overlay").hidden = false;
const explorerOpen = explorer.__stats.fetches;
explorer.__ticks["explorer.state"]();
await explorer.__flush();
const explorerVisible = explorer.__stats.fetches;
explorer.document._vis = "hidden";
explorer.__fire("visibilitychange");
explorer.__ticks["explorer.state"]();
await explorer.__flush();
const explorerHidden = explorer.__stats.fetches;
explorer.document._vis = "visible";
explorer.__fire("visibilitychange");
await explorer.__flush();
const explorerResumed = explorer.__stats.fetches;

console.log(JSON.stringify({
  overhead: { open: overheadOpen, visible: overheadVisible, hidden: overheadHidden, resumed: overheadResumed },
  explorer: { open: explorerOpen, visible: explorerVisible, hidden: explorerHidden, resumed: explorerResumed },
}));
"""
        replacements = {
            "OVERHEAD": STUDIO / "renderer" / "overhead.js",
            "EXPLORER": STUDIO / "renderer" / "explorer.js",
        }
        for key, value in replacements.items():
            script = script.replace(f"__{key}__", json.dumps(str(value)))
        result = subprocess.run([node, "--input-type=module", "-"], input=script, cwd=STUDIO, capture_output=True, text=True, timeout=120)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(1, payload["overhead"]["open"], "opening the overhead sheet reads the task list once")
        self.assertEqual(2, payload["overhead"]["visible"], "a visible window fetches on every timer pass")
        self.assertEqual(2, payload["overhead"]["hidden"], "a hidden window fires the timer eight times with zero fetches")
        self.assertEqual(3, payload["overhead"]["resumed"], "the visibilitychange snap-back fetches the moment the window shows")
        self.assertEqual(0, payload["explorer"]["open"], "the explorer tick sits idle until the shared guard calls it")
        self.assertEqual(1, payload["explorer"]["visible"], "a visible window's shared-guard tick reads the eyes store")
        self.assertEqual(1, payload["explorer"]["hidden"], "a hidden window's shared-guard tick fires with zero fetches")
        self.assertEqual(2, payload["explorer"]["resumed"], "the visibilitychange listener fetches the moment the window shows")

    def test_club_blackout_tokens_and_rail_exist(self):
        for marker in ("--gold", "--live", "backdrop-filter", "#tree-rail"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.styles)
        self.assertIn('id="tree-rail"', self.template)
        self.assertIn('data-tab="eyes"', self.template)
        self.assertIn("__BOOKLET_STYLES__", self.template)

    def test_dump_against_fixture_database(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "fixture.db"
            _fixture_db(db_path)
            porcelain_path = Path(directory) / "porcelain.txt"
            porcelain_path.write_text(
                " M main.lua\n?? new.lua\n D gone.lua\n M other.lua\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    node,
                    str(EYES_JS),
                    "--dump",
                    "--fixture",
                    str(db_path),
                    "--root",
                    "C:/fixture",
                    "--now",
                    str(FIXTURE_NOW),
                    "--porcelain",
                    str(porcelain_path),
                ],
                cwd=STUDIO,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            payload = json.loads(result.stdout)
        self.assertEqual(["ses_a", "ses_b"], [s["id"] for s in payload["sessions"]])
        self.assertEqual("max", payload["sessions"][0]["model"]["variant"])
        finished = {s["id"]: s["finished"] for s in payload["sessions"]}
        self.assertTrue(finished["ses_a"], "a final step-finish with reason 'stop' marks the session finished")
        self.assertFalse(finished["ses_b"], "a mid-turn 'tool-calls' tail never counts as finished")
        facts_finished = {s["id"]: s["finished"] for s in payload["facts"]["sessions"]}
        self.assertEqual({"ses_a": True, "ses_b": False}, facts_finished, "assistantFacts carries the finished signal to the A-Eyes review")
        self.assertEqual(2, len(payload["todos"]))
        changes = {change["tool"]: change for change in payload["changes"]}
        self.assertIn("edit", changes)
        self.assertIn("write", changes)
        self.assertIn("patch", changes)
        edit_by_key = {
            (change["sessionId"], change["file"]): change
            for change in payload["changes"]
            if change["tool"] == "edit"
        }
        self.assertEqual(2, edit_by_key[("ses_a", "C:/fixture/main.lua")]["additions"])
        self.assertEqual(1, edit_by_key[("ses_a", "C:/fixture/main.lua")]["deletions"])
        self.assertEqual(3, changes["write"]["additions"])
        self.assertEqual(0, changes["write"]["deletions"])
        self.assertEqual(["C:/fixture/a.lua", "C:/fixture/b.lua"], changes["patch"]["files"])
        self.assertTrue(all("read" != change["tool"] for change in payload["changes"]), "reads are not changes")
        tools = {entry["tool"] for entry in payload["activity"]}
        self.assertIn("read", tools, "activity includes reads for tree pulses")
        self.assertEqual(3, len(payload["collisions"]), "ses_a/ses_b, the inactive-owner handoff pair, and the idle-only pair")
        collision_group = payload["collisions"][0]
        self.assertEqual(2, len(collision_group["sessions"]))
        self.assertIn("C:/fixture/main.lua", collision_group["file"])
        self.assertEqual(
            ["C:/fixture/main.lua", "C:/outside/outside.lua", "C:/fixture/shared.lua"],
            collision_group["files"],
            "one session pair on several files groups into a single collision, newest file first",
        )
        scoped = payload["collisionsScoped"]
        self.assertEqual(3, len(scoped), "root scoping drops the outside-repo file and keeps the handoff and idle pairs")
        self.assertEqual(["C:/fixture/main.lua", "C:/fixture/shared.lua"], scoped[0]["files"])
        handoff_group = next(
            group
            for group in payload["collisions"]
            if any(str(path).endswith("handoff.lua") for path in (group.get("files") or [group["file"]]))
        )
        self.assertEqual("ses_c", handoff_group["owner"], "most edits still own the file after going idle")
        self.assertTrue(handoff_group["handoff"], "an idle owner with a live peer is a handoff")
        self.assertTrue(handoff_group["active"], "the group stays live because the peer is still editing")
        handoff_by_session = {entry["sessionId"]: entry for entry in handoff_group["sessions"]}
        self.assertFalse(handoff_by_session["ses_c"]["active"])
        self.assertTrue(handoff_by_session["ses_d"]["active"])
        self.assertEqual(["C:/fixture/handoff.lua"], scoped[1]["files"])
        # Negative case — idle-only pair: the temporal overlap still makes it
        # a collision, but with every session idle it is history, not a live
        # conflict: no active side, no activeSessions, and it never reaches
        # the live presence surface.
        idle_group = scoped[2]
        self.assertEqual(["C:/fixture/idleonly.lua"], idle_group["files"])
        self.assertFalse(idle_group["active"], "an idle-only pair has no live side")
        self.assertTrue(all(entry["active"] is False for entry in idle_group["sessions"]))
        self.assertEqual("ses_f", idle_group["owner"], "an edit-count tie breaks on latest touch")
        self.assertEqual([{"file": "C:/fixture/idleonly.lua", "owner": "ses_f"}], idle_group["ownership"])
        self.assertTrue(idle_group["handoff"], "the owner is explicitly idle, so a handoff must be confirmed")
        facts_idle = next(
            group
            for group in payload["facts"]["collisions"]
            if group["files"] == ["C:/fixture/idleonly.lua"]
        )
        self.assertEqual(
            [],
            facts_idle["activeSessions"],
            "an idle-only collision carries no active sessions",
        )
        self.assertFalse(facts_idle["active"])
        self.assertTrue(facts_idle["handoff"])
        self.assertNotIn(
            "C:/fixture/stale.lua",
            scoped[0]["files"],
            "a 15-minute edit gap is a stale hand-off, not a live collision",
        )
        self.assertEqual(
            "ses_a",
            collision_group["owner"],
            "the session with the most edits in the group owns the conflict",
        )
        self.assertEqual(
            [
                {"file": "C:/fixture/main.lua", "owner": "ses_b"},
                {"file": "C:/outside/outside.lua", "owner": "ses_b"},
                {"file": "C:/fixture/shared.lua", "owner": "ses_a"},
            ],
            collision_group["ownership"],
            "per-file ownership follows each file's latest edit",
        )
        by_session = {entry["sessionId"]: entry for entry in collision_group["sessions"]}
        self.assertEqual(4, by_session["ses_a"]["edits"], "main + outside + two shared edits")
        self.assertEqual(3, by_session["ses_b"]["edits"])
        self.assertTrue(all("active" in entry for entry in collision_group["sessions"]), "sessions carry the live-activity flag")
        self.assertTrue(collision_group["active"])
        self.assertEqual(
            FIXTURE_NOW - 30_000,
            by_session["ses_a"]["firstEdit"],
            "each session carries the start of its edit window so the explorer can show time ranges",
        )
        self.assertEqual(FIXTURE_NOW - 20_000, by_session["ses_a"]["lastEdit"])
        self.assertEqual(FIXTURE_NOW - 29_000, by_session["ses_b"]["firstEdit"])
        self.assertEqual(
            {"first": FIXTURE_NOW - 29_000, "last": FIXTURE_NOW - 20_000},
            collision_group["overlap"],
            "the overlap window is the span every session in the group was editing inside",
        )
        self.assertGreater(
            handoff_group["overlap"]["first"],
            handoff_group["overlap"]["last"],
            "a gap-tolerated handoff never co-edited: its overlap window is inverted, so the renderer shows edit spans",
        )
        self.assertEqual(2, len(payload["facts"]["sessions"]))
        self.assertTrue(payload["facts"]["sessions"][0]["todos"], "facts carry todos for the assistant")
        facts_collision = payload["facts"]["collisions"][0]
        self.assertEqual("ses_a", facts_collision["owner"], "AI facts carry the owner")
        self.assertTrue(facts_collision["active"], "AI facts carry the live-activity flag")
        facts_by_session = {entry["sessionId"]: entry for entry in facts_collision["sessions"]}
        self.assertIn("C:/fixture/shared.lua", facts_by_session["ses_a"]["files"], "AI facts name each session's actual files")
        self.assertIn("lastEdit", facts_by_session["ses_a"], "AI facts carry lastEdit so ownership ties can be broken")
        self.assertIn("firstEdit", facts_by_session["ses_a"], "AI facts carry the edit-window start for time ranges")
        self.assertEqual(
            {"first": FIXTURE_NOW - 29_000, "last": FIXTURE_NOW - 20_000},
            facts_collision["overlap"],
            "AI facts carry the group's overlap window",
        )
        self.assertEqual(
            ["ses_b"],
            sorted(facts_collision["activeSessions"]),
            "the finished ses_a remains edit history, not a live editor",
        )
        self.assertTrue(facts_by_session["ses_a"]["finished"])
        self.assertFalse(facts_by_session["ses_a"]["active"])
        self.assertEqual(
            [
                {"file": "C:/fixture/main.lua", "owner": "ses_b"},
                {"file": "C:/fixture/shared.lua", "owner": "ses_a"},
            ],
            facts_collision["ownership"],
            "AI facts carry per-file ownership (root-scoped)",
        )
        presence_by_file = {row["file"]: row for row in payload["facts"]["presence"]}
        self.assertEqual("ses_b", presence_by_file["C:/fixture/main.lua"]["owner"], "facts presence names the live owner")
        self.assertFalse(presence_by_file["C:/fixture/main.lua"]["colliding"])
        self.assertEqual("ses_b", presence_by_file["C:/fixture/shared.lua"]["owner"])
        self.assertNotIn("C:/fixture/new.lua", presence_by_file, "a finished session no longer holds live presence")
        self.assertNotIn("C:/outside/outside.lua", presence_by_file, "facts presence honours --root")
        self.assertNotIn(
            "C:/fixture/idleonly.lua",
            presence_by_file,
            "idle-only work is outside the ACTIVE_EDIT_MS presence window",
        )
        self.assertTrue(
            all(entry.get("active") for entry in presence_by_file["C:/fixture/main.lua"]["editors"]),
            "facts presence editors carry the live-activity flag",
        )
        self.assertEqual(
            ["C:/fixture/main.lua", "C:/fixture/shared.lua"],
            facts_collision["files"],
            "AI facts collisions are root-scoped",
        )
        self.assertTrue(facts_collision.get("handoff"), "the finished owner's edits remain available for adoption")
        facts_handoff = next(row for row in payload["facts"]["collisions"] if row.get("owner") == "ses_c")
        self.assertEqual("ses_c", facts_handoff["owner"])
        self.assertEqual(["ses_d"], facts_handoff["activeSessions"])
        self.assertEqual("ses_d", presence_by_file["C:/fixture/handoff.lua"]["owner"], "presence names the live peer, not the idle owner")
        self.assertFalse(presence_by_file["C:/fixture/handoff.lua"]["colliding"])
        self.assertEqual(0, payload["facts"]["sessions"][0]["updatedMinutesAgo"], "facts clock from --now, not wall time")
        uncommitted = {row["path"]: row for row in payload["uncommitted"]}
        self.assertIn("main.lua", uncommitted, "session-touched modified files are uncommitted-only vs HEAD")
        self.assertIn("new.lua", uncommitted, "session-touched untracked files are uncommitted-only vs HEAD")
        self.assertNotIn("gone.lua", uncommitted, "deleted files are not a missing-from-HEAD feature")
        self.assertNotIn("other.lua", uncommitted, "dirty files no session edited are not a feature warning")
        self.assertIn("ses_a", uncommitted["main.lua"]["sessions"])
        self.assertIn("not in committed HEAD", uncommitted["main.lua"]["warning"])
        self.assertTrue(uncommitted["new.lua"]["untracked"])
        self.assertEqual(
            ["main.lua", "new.lua"],
            [row["path"] for row in payload["facts"]["uncommitted"]],
            "AI facts carry uncommitted-only features",
        )

    def test_simulated_briefing_becomes_fix_requests(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "fixture.db"
            _fixture_db(db_path)
            result = subprocess.run(
                [node, str(EYES_JS), "--simulate", "--fixture", str(db_path), "--now", str(FIXTURE_NOW)],
                cwd=STUDIO,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            payload = json.loads(result.stdout)
        self.assertEqual(3, len(payload["fromCollisions"]), "grouped pair, handoff pair, and idle-only pair each queue once")
        collision_request = next(request for request in payload["fromCollisions"] if request["owner"] == "ses_a")
        self.assertEqual("collision", collision_request["source"])
        self.assertIn("main.lua", collision_request["prompt"])
        self.assertEqual(2, len(collision_request["sessions"]))
        self.assertEqual("ses_a", collision_request["owner"], "the request names its owner")
        self.assertIn(
            "ownership to ses_a",
            collision_request["prompt"],
            "the prompt assigns ownership instead of leaving it vague",
        )
        self.assertIn(
            "collaborating on one feature",
            collision_request["prompt"],
            "split per-file owners keep their files instead of one side rebasing off",
        )
        self.assertTrue(collision_request["collaborating"])
        self.assertEqual(
            {"ses_a": 4, "ses_b": 3},
            {row["sessionId"]: row["edits"] for row in collision_request["edits"]},
            "the request carries each session's actual edits from the live store",
        )
        self.assertIn("Active on it right now", collision_request["prompt"])
        self.assertEqual(
            {"first": FIXTURE_NOW - 29_000, "last": FIXTURE_NOW - 20_000},
            collision_request["overlap"],
            "a shared request carries the group's overlap window",
        )
        self.assertRegex(
            collision_request["prompt"],
            r"Overlap window: \d{2}:\d{2}–\d{2}:\d{2}\.",
            "the dispatched fix prompt cites the HH:MM–HH:MM the clash happened",
        )
        handoff_request = next(row for row in payload["fromCollisions"] if row["owner"] == "ses_c")
        self.assertEqual("ses_c", handoff_request["owner"])
        self.assertTrue(handoff_request["handoff"])
        self.assertIsNone(handoff_request["overlap"], "a gap-tolerated handoff claims no shared window")
        self.assertIn("Owner ses_c is marked inactive; confirm handoff before further edits", handoff_request["prompt"])
        self.assertIn("Active on it right now: ses_d", handoff_request["prompt"])
        self.assertRegex(
            handoff_request["prompt"],
            r"Edit span: \d{2}:\d{2}–\d{2}:\d{2} — the sessions never actually co-edited",
            "a handoff prompt cites its span as a handoff, not a shared clash window",
        )
        # Negative case — the idle-only pair queues once, but its prompt must
        # say nobody is active instead of pointing at a live editor.
        idle_request = next(row for row in payload["fromCollisions"] if row["owner"] == "ses_f")
        self.assertEqual(["C:/fixture/idleonly.lua"], idle_request["files"])
        self.assertTrue(idle_request["handoff"])
        self.assertFalse(idle_request["collaborating"], "a single per-file owner is not a collaboration split")
        self.assertIn("Owner ses_f is marked inactive; confirm handoff before further edits", idle_request["prompt"])
        self.assertIn("No session has touched it in the last 10 minutes", idle_request["prompt"])
        self.assertNotIn("Active on it right now", idle_request["prompt"])
        demo = payload["ownershipDemo"]
        self.assertEqual(4, len(demo))
        self.assertEqual("ses_a", demo[0]["owner"])
        self.assertIn("per file: a.lua -> ses_a; b.lua -> ses_b", demo[0]["prompt"], "grouped collisions split per-file owners")
        self.assertIn("collaborating on one feature", demo[0]["prompt"])
        self.assertIn("ses_gone must stop or rebase", demo[1]["prompt"], "a single-owner group still tells the other session to rebase")
        self.assertIn("No session has touched it in the last 10 minutes", demo[1]["prompt"], "idle collisions say so")
        self.assertEqual("ses_legacy", demo[2]["owner"], "a collision without an owner falls back to its first session")
        self.assertIn("ses_other must stop or rebase", demo[2]["prompt"])
        self.assertEqual("ses_owner", demo[3]["owner"], "an idle owner keeps ownership while a live peer is editing")
        self.assertTrue(demo[3]["handoff"])
        self.assertIn("Owner ses_owner is marked inactive; confirm handoff before further edits", demo[3]["prompt"])
        self.assertIn("ses_peer must stop or rebase", demo[3]["prompt"])
        self.assertIn("Active on it right now: ses_peer", demo[3]["prompt"])
        range_demo = payload["rangeDemo"]
        self.assertEqual(
            4,
            len(range_demo),
            "the range demo covers a shared window, a gap handoff, a zero-length window, and a corrupt window",
        )
        self.assertRegex(range_demo[0]["prompt"], r"Overlap window: \d{2}:\d{2}–\d{2}:\d{2}\.")
        self.assertIsNotNone(range_demo[0]["overlap"])
        self.assertRegex(range_demo[1]["prompt"], r"Edit span: \d{2}:\d{2}–\d{2}:\d{2} — the sessions never actually co-edited")
        self.assertIsNone(range_demo[1]["overlap"])
        self.assertEqual(2, len(payload["fromBriefing"]), "info alerts are ignored")
        self.assertEqual("fix", payload["fromBriefing"][0]["source"])
        self.assertEqual("Two sessions editing main.lua", payload["fromBriefing"][0]["alertTitle"])
        titles = [request["alertTitle"] for request in payload["fromBriefing"]]
        self.assertNotIn("ses_b triage stalled", titles,
                         "an alert sharing a session must not queue a second fix")
        self.assertIn("Unrelated file churn", titles, "a distinct session still queues")
        self.assertEqual([], payload["deduped"], "duplicate alerts are not re-queued")
        self.assertEqual(
            [], payload["historyDeduped"],
            "a dispatched fix keeps claiming its sessions even after it leaves the queue",
        )
        theme = payload["themeDedup"]
        self.assertEqual(2, len(theme), "same-theme disjoint-session alerts collapse to one fix")
        theme_titles = [request["alertTitle"] for request in theme]
        self.assertEqual("Duplicate root-cause sessions", theme_titles[0])
        self.assertIn("Idle camera drift", theme_titles)
        self.assertNotIn("Stalled duplicate-session triage", theme_titles)
        self.assertNotIn("eyes.mjs subsystem overlap", theme_titles)
        self.assertEqual("dup", theme[0].get("problemFamily"))
        self.assertEqual(2, len(payload["pairDedup"]), "a shared session on two partners is two requests")
        self.assertEqual([], payload["samePairQueued"], "the same session pair already in the inbox is not re-queued")
        self.assertEqual(2, len(payload["uncommitted"]), "simulate uncommitted skips deletes and untouched dirty files")
        self.assertEqual("mefi-studio/main.cjs", payload["uncommitted"][0]["path"])
        self.assertIn("Wire the parallel executor", payload["uncommitted"][0]["warning"])
        self.assertTrue(payload["uncommitted"][1]["untracked"])
        self.assertEqual(1, len(payload["fromUncommitted"]))
        self.assertEqual("uncommitted", payload["fromUncommitted"][0]["source"])
        self.assertIn("Do not re-implement it from committed HEAD", payload["fromUncommitted"][0]["prompt"])
        self.assertEqual(
            [{"name": "foo", "lines": [1, 3]}],
            payload["duplicateDemo"],
            "top-level duplicate function names are the merge-corruption fingerprint",
        )
        self.assertEqual("duplicate", payload["fromDuplicates"][0]["source"])
        self.assertIn("foo @1,3", payload["fromDuplicates"][0]["prompt"])
        self.assertEqual([], payload["dupDeduped"], "a file already queued is not re-queued")
        self.assertIn("ses_peer", payload["adoptHit"])
        self.assertIn("Adopt their work", payload["adoptHit"])
        self.assertEqual("", payload["adoptMiss"], "unrelated work does not get a generic adopt lecture")

    def test_range_demo_covers_window_boundaries(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "unused.db"
            _boundary_db(db_path)
            result = subprocess.run(
                [node, str(EYES_JS), "--simulate", "--fixture", str(db_path), "--now", str(FIXTURE_NOW)],
                cwd=STUDIO,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            payload = json.loads(result.stdout)
        range_demo = payload["rangeDemo"]
        self.assertEqual(
            4,
            len(range_demo),
            "the range demo covers a shared window, a gap handoff, a zero-length window, and a corrupt window",
        )
        self.assertRegex(range_demo[0]["prompt"], r"Overlap window: \d{2}:\d{2}–\d{2}:\d{2}\.")
        self.assertIsNotNone(range_demo[0]["overlap"])
        self.assertRegex(range_demo[1]["prompt"], r"Edit span: \d{2}:\d{2}–\d{2}:\d{2} — the sessions never actually co-edited")
        self.assertIsNone(range_demo[1]["overlap"])
        self.assertEqual(
            {"first": 1_800_002_000_000, "last": 1_800_002_000_000},
            range_demo[2]["overlap"],
            "a zero-length window is a real single-instant clash, not a corrupt one",
        )
        self.assertRegex(range_demo[2]["prompt"], r"Overlap window: \d{2}:\d{2}–\d{2}:\d{2}\.")
        self.assertIsNone(range_demo[3]["overlap"], "a corrupt window validates to null instead of leaking into the prompt")
        self.assertRegex(range_demo[3]["prompt"], r"Edit span: \d{2}:\d{2}–\d{2}:\d{2} — the sessions never actually co-edited")
        self.assertNotIn("NaN", range_demo[3]["prompt"], "a corrupt range must not print NaN–NaN in a dispatched prompt")

    def test_collision_overlap_window_boundaries(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node unavailable; static contracts still ran")
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "boundary.db"
            _boundary_db(db_path)
            outputs = {}
            for mode in ("--dump", "--simulate"):
                result = subprocess.run(
                    [node, str(EYES_JS), mode, "--fixture", str(db_path), "--now", str(FIXTURE_NOW)],
                    cwd=STUDIO,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=60,
                )
                self.assertEqual(0, result.returncode, result.stderr)
                outputs[mode] = json.loads(result.stdout)
        now = FIXTURE_NOW
        by_file = {}
        for group in outputs["--dump"]["collisions"]:
            for file in group.get("files") or [group["file"]]:
                by_file[file] = group
        requests = {tuple(sorted(row["sessions"])): row for row in outputs["--simulate"]["fromCollisions"]}
        # Adjacent: the windows touch at one instant — a collision whose
        # shared window is zero-length rather than inverted.
        adjacent = by_file.get("C:/fixture/adjacent.lua")
        self.assertIsNotNone(adjacent, "windows that touch at one instant are still a collision")
        self.assertEqual(
            {"first": now - 60_000, "last": now - 60_000},
            adjacent["overlap"],
            "adjacent windows share exactly one instant: the overlap window is zero-length, not inverted",
        )
        # Inclusive gap boundary: a gap of exactly overlapMs still collides,
        # but the windows share no point, so the overlap stays inverted.
        exact = by_file.get("C:/fixture/exactgap.lua")
        self.assertIsNotNone(exact, "a gap of exactly overlapMs is inside the window (inclusive boundary)")
        self.assertGreater(exact["overlap"]["first"], exact["overlap"]["last"], "a gap-tolerated pair never co-edited")
        # Just past overlapMs: not a collision at all.
        self.assertNotIn(
            "C:/fixture/pastgap.lua",
            by_file,
            "a gap one ms past overlapMs is a stale hand-off, not a live collision",
        )
        # Contained: the intersection is exactly the inner session's window.
        contained = by_file.get("C:/fixture/contained.lua")
        self.assertIsNotNone(contained, "a window fully inside another is a collision")
        self.assertEqual(
            {"first": now - 200_000, "last": now - 150_000},
            contained["overlap"],
            "a contained window intersects to exactly the inner session's window",
        )
        # Nested three-session group: every pair sits inside overlapMs, so one
        # group holds all three, and the common intersection collapses to the
        # innermost session's single instant — a real zero-length window.
        nested = by_file.get("C:/fixture/nested3.lua")
        self.assertIsNotNone(nested, "three nested windows form one group")
        self.assertEqual(3, len(nested["sessions"]), "all three nested sessions join the group")
        self.assertEqual(
            {"first": now - 100_000, "last": now - 100_000},
            nested["overlap"],
            "nested windows intersect at the innermost session's single instant",
        )
        # Zero-length: two single-edit sessions on the same instant.
        instant = by_file.get("C:/fixture/instant.lua")
        self.assertIsNotNone(instant, "two single-edit sessions on the same instant collide")
        self.assertEqual({"first": now - 45_000, "last": now - 45_000}, instant["overlap"])
        # The request inputs validate the same shapes before citing them.
        self.assertEqual(
            {"first": now - 60_000, "last": now - 60_000},
            requests[("s1_adj", "s2_adj")]["overlap"],
            "an adjacent pair's zero-length window is real, so the request keeps it",
        )
        self.assertRegex(requests[("s1_adj", "s2_adj")]["prompt"], r"Overlap window: \d{2}:\d{2}–\d{2}:\d{2}\.")
        exact_request = requests[("s1_exact", "s2_exact")]
        self.assertIsNone(exact_request["overlap"], "an inclusive-gap pair cites an edit span, not a shared window")
        self.assertRegex(exact_request["prompt"], r"Edit span: \d{2}:\d{2}–\d{2}:\d{2} — the sessions never actually co-edited")
        self.assertEqual(
            5,
            len(requests),
            "adjacent, exact-gap, contained, instant, and the nested three-session pair-set queue once each; the past-gap pair does not",
        )
        nested_request = requests[("s3_mid", "s3_outer", "s3_tip")]
        self.assertEqual(
            {"first": now - 100_000, "last": now - 100_000},
            nested_request["overlap"],
            "the nested group's zero-length intersection is real, so the request keeps it",
        )
        self.assertRegex(nested_request["prompt"], r"Overlap window: \d{2}:\d{2}–\d{2}:\d{2}\.")

    def test_explorer_collision_list_names_owner_and_activity(self):
        self.assertIn(" · owner ", self.explorer, "the collision list names the owner")
        self.assertIn(" ← owner", self.explorer, "the tooltip flags the owning session")
        self.assertIn("entry.files", self.explorer, "the tooltip names each session's actual files")
        self.assertIn(" (idle)", self.explorer)
        self.assertIn(" (active)", self.explorer)
        self.assertIn("idle", self.explorer)
        self.assertIn("liveSolo", self.explorer, "collateral watch lists live solo editors beside collisions")
        self.assertIn("collisionIsLive", self.explorer, "the same live rule idle.js applies: an idle-only collision group is history and must not suppress live solo editors on its files")
        self.assertIn("entry.active === true", self.explorer, "only sessions with an active edit count a collision as live here")
        self.assertIn("No live editors or file collisions.", self.explorer)
        self.assertIn("state.presence = collisions?.presence ?? []", self.explorer)
        self.assertIn("collisions still paint when the brief column is empty", self.explorer)
        self.assertIn('duplicate: "DUP"', self.explorer)
        self.assertIn(" → ${shortId(row.owner)}", self.explorer, "tooltip maps per-file owners")
        self.assertIn("confirm handoff", self.explorer, "an idle owner is flagged instead of silently stolen")
        self.assertIn("collision.overlap", self.explorer, "the group's overlap window feeds the row's time range")
        self.assertIn("firstEdit", self.explorer, "collision tooltips show each session's edit window")
        self.assertIn("overlap window", self.explorer, "the collision detail view names the shared overlap window, not a bare range")
        self.assertIn("no shared window", self.explorer, "a handoff pair's detail says so instead of citing a fake shared window")
        self.assertIn("handoff span", self.explorer, "the detail label for a gap-tolerated pair matches the fix prompt's wording")
        self.assertIn("splitOwners", self.explorer, "every per-file owner is shown, not one stale group owner")
        self.assertIn(" live`", self.explorer, "an idle owner's live overlapping peer is named beside it")
        self.assertIn("Live editors and file collisions", self.template)
        # booklet.html inlines the renderer sources at build time: the
        # overlap-range display pinned above must survive into the bundle too,
        # or the built sheet silently loses the collision time ranges.
        for marker in ("collision.overlap", "overlap window", "no shared window", "handoff span"):
            self.assertIn(marker, self.booklet, f"the built booklet.html carries the collision overlap display ({marker})")

    def test_live_store_and_executor_carry_presence_owners(self):
        # assistantFacts already names owners; the live path used to drop
        # presence, so a single editor never reached collaborate / local replies.
        self.assertIn("eyes.filePresence({ root: projectRoot() })", self.main)
        self.assertIn("assistantFacts({ sessionLimit: 8, changeLimit: 40, todoLimitPerSession: 8, root: projectRoot() })", self.main)
        self.assertIn("eyes.uncommittedOnly", self.main)
        self.assertIn("uncommitted: assistantCache.store?.uncommitted ?? []", self.main)
        self.assertIn("presence: store.presence", self.main)
        self.assertIn("presence: assistantCache.store?.presence ?? []", self.main)
        self.assertIn("presence: []", self.main)
        self.assertIn("an owner whose work the others should adopt", self.main)
        self.assertIn("updatedMinutesAgo: Math.round((now - session.timeUpdated) / 60000)", self.eyes)
        self.assertIn("active: entry.active === true", self.eyes)
        self.assertIn("owner: row.owner", self.eyes)
        collisions_ipc = self.main.split('ipcMain.handle("eyes:collisions"')[1].split("ipcMain.handle(")[0]
        self.assertIn("filePresence", collisions_ipc, "the collisions IPC also returns live presence")
        self.assertIn("presence:", collisions_ipc)

    def test_dispatched_fix_claims_feed_the_dedup_baseline(self):
        # A dispatched fix's claimed sessions must keep the next briefing from
        # diagnosing the same stall again and spawning an overlapping fix.
        # Direct request runs left an assistant-history record for that; only
        # tasks run now, and a fix reaches a worker as its promoted card, which
        # carries the claim (sessions, alertTitle, problemFamily) and makes
        # promotion refuse a second card for the same fix problem. The
        # baseline still folds in the history records older builds wrote.
        self.assertIn("await eyes.readJson(ASSISTANT_HISTORY_PATH, [])", self.main)
        # Board cards join the baseline too: a promoted request's inbox copy is
        # absorbed by compaction, and a filer that saw only the inbox filed the
        # same work again while its card was live. Deliberately changed: done
        # cards count until archived (workAdmission.standsOnBoard), the rule
        # promotion and compaction apply, or the finding churned every pass.
        self.assertIn("const known = [...existing, ...dispatched, ...standing]", self.main)
        baseline = self.main[self.main.index("async function requestBaseline(eyes)") : self.main.index("// briefing.expand[] items become real queue entries here")]
        self.assertIn("workAdmission.standsOnBoard(task)", baseline)
        self.assertNotIn("sessions: [...new Set(claimed)]", self.main, "no run writes the retired direct-request history record")
        self.assertIn("eyes.sameFixProblem(request, task)", self.main, "promotion refuses a second card for a fix problem already on the board")
        self.assertIn("problemFamily", self.main)
        self.assertIn("export function sameFixProblem", self.eyes)
        self.assertIn("export function alertProblem", self.eyes)
        self.assertIn("sameFixProblem(request,", self.eyes)

    def test_fixture_databases_use_unique_per_run_temp_dirs(self):
        # The A-Eyes eyes-test collisions recurred because parallel sessions
        # ran this suite against the same fixture paths. The durable fix is
        # unique fixture naming: every fixture database is built inside its
        # own per-run tempfile.TemporaryDirectory(), so two concurrent runs
        # (or sessions) never share a fixture path, and no fixture ever lands
        # inside the repository tree. See CONTRIBUTING.md "Test file
        # conventions" and the spec-collisions guard (`npm run check:specs`).
        source = Path(__file__).resolve().read_text(encoding="utf-8")
        self.assertEqual(
            ["_boundary_db", "_fixture_db"],
            sorted(re.findall(r"^def (_(?:fixture|boundary)_db)\(path\):", source, re.M)),
            "fixture databases are built only by the two shared helpers",
        )
        self.assertEqual(
            2,
            len(re.findall(r"sqlite3\.connect\(path\)", source)),
            "no ad-hoc fixture connection escapes the shared helpers",
        )
        with_blocks = re.findall(r"with tempfile\.TemporaryDirectory\(\) as directory:", source)
        call_sites = re.findall(r"^ {12}_(?:fixture|boundary)_db\(db_path\)", source, re.M)
        db_paths = re.findall(r"db_path = Path\(directory\) / ", source)
        self.assertGreaterEqual(len(with_blocks), 4, "the fixture-backed tests keep their per-run blocks")
        self.assertEqual(
            len(with_blocks),
            len(call_sites),
            "every fixture db call site sits inside its own per-run TemporaryDirectory block",
        )
        self.assertEqual(
            len(with_blocks),
            len(db_paths),
            "every fixture db path is derived from that per-run temp directory",
        )
        self.assertNotIn("tools/" + "logs", source, "the suite never writes fixtures into the shared evidence tree")
        self.assertFalse(
            re.search(r'(?:ROOT|STUDIO) / ["\'][^"\']*\.db', source),
            "no fixture database path is anchored inside the repository tree",
        )
        stem = Path(__file__).stem.lower()
        siblings = {
            path.stem.lower()
            for path in Path(__file__).resolve().parent.iterdir()
            if path != Path(__file__).resolve()
        }
        self.assertNotIn(
            stem,
            siblings,
            "no sibling spec shares this basename — a duplicate shadows unittest discovery (the recurrence behind the eyes collisions; guarded repo-wide by check:specs)",
        )

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_eyes.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
