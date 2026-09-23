"""Always-on assistant contracts for Mefi's Studio AI+ (standalone repository).

Feeds one fixture through the real scripts/assistant.mjs (--fixture) and pins
the pure logic: tree organisation (active / working / stale / folded, display
order, hidden todos), housekeeping (archive done tasks after 24 h, prune done
ideas, drop resolved audit and collision requests, keep manual ones, dedupe and
cap), intent routing (including the suggest and agents queries), grounded
local replies (greetings, ranked next-work picks, the roster report, the
executor line), the AI backoff table and state
normalisation on garbage, the thinker (log-grounded inner monologue and
proactive dispatch), plus the agent pool: the ordered roster, cadence
scheduling (dueRoles), roster transitions (applyAgentEvent) with pool counts,
and stale running rows reset on load; and the work journal: pendingWork on
the raw saved state (in-flight jobs, unanswered messages, interrupted roles),
applyWork add/update/remove/cap, the resumeSummary boot line, the resume-work
intent and the status reply listing what is being worked on. The overseer —
the R&D layer above the assistant — is pinned too: playbook normalisation,
the telemetry digest (including the tree's stale sessions), the deterministic
local review, lesson merging, the bounded pref tuner, and the stale-session
rescue plan the repair pass turns into resume requests. Node folders — every
session/todo/task node acting as a
folder for its own context — are pinned as well: apply/dedupe/cap of context
entries, junk ignored, the keeper cleaning finished nodes' folders out with
the rest of the housekeeping, the facts carrying the focused folder, replies
quoting it, the clear path and the main/preload/renderer wiring. The static
half pins the service wiring: IPC and
preload names, the boot hook in app.whenReady, the keep-awake blocker, the
gitignored state file, the template ids, the tree/Command-view node kinds, the
M key and the README section. No network, no key, no Electron; the Node half
skips cleanly without Node.
"""
from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
ASSISTANT = STUDIO / "scripts" / "assistant.mjs"
NODE = shutil.which("node")

NOW = 1_800_000_000_000
MINUTE = 60_000
HOUR = 60 * MINUTE
DAY = 24 * HOUR


def _session(session_id, minutes_ago, **extra):
    row = {
        "id": session_id,
        "parentId": None,
        "title": f"Session {session_id}",
        "agent": "build",
        "model": {"id": "x"},
        "timeCreated": NOW - (minutes_ago + 60) * MINUTE,
        "timeUpdated": NOW - minutes_ago * MINUTE,
    }
    row.update(extra)
    return row


def _todo(session_id, content, status, position=0):
    return {"sessionId": session_id, "content": content, "status": status, "position": position}


def _checkpoint(note, at):
    return {"note": note, "at": at, "source": "deepseek-v4.1-flash", "files": [], "png": None}


def _fixture():
    return {
        "now": NOW,
        "sessions": [
            _session("ses_active", 2, title="Fix the crafting bench"),
            _session("ses_progress", 5 * 60, title="Steam achievements audit"),
            _session("ses_working", 3 * 60, title="Tide pool fish"),
            _session("ses_stale", 30 * 60, title="Swamp biome rename"),
            _session("ses_done", 2 * 60, title="Booklet polish"),
            _session("ses_empty", 90, title="Empty hands"),
            _session("ses_child", 1, parentId="ses_active"),
            _session("ses_ancient", 20 * 24 * 60),
        ],
        "todos": [
            _todo("ses_active", "Wire the crafting bench", "pending"),
            _todo("ses_progress", "Verify every achievement", "in_progress"),
            _todo("ses_working", "Draw the tide pool fish", "pending"),
            _todo("ses_stale", "Rename the swamp biome", "in_progress"),
            _todo("ses_done", "Polish the booklet", "completed"),
            _todo("ses_done", "Ship the booklet", "cancelled", 1),
        ],
        "tasks": [
            {"id": "task_old_done", "title": "Old finished task", "prompt": "x", "status": "done", "createdAt": NOW - 3 * DAY, "updatedAt": NOW - 30 * HOUR, "logs": [{"at": NOW - 30 * HOUR, "kind": "status", "text": "done"}], "ideas": [], "refs": []},
            {"id": "task_fresh_done", "title": "Fresh finished task", "prompt": "x", "status": "done", "createdAt": NOW - DAY, "updatedAt": NOW - 2 * HOUR, "logs": [], "ideas": [], "refs": []},
            {"id": "task_open", "title": "Crafting bench recipes", "prompt": "x", "status": "open", "createdAt": NOW - 3 * DAY, "updatedAt": NOW - 40 * HOUR, "logs": [], "ideas": [], "refs": []},
        ],
        "ideas": [
            {"id": "idea_accepted_old", "title": "Accepted a while ago", "status": "accepted", "read": True, "at": NOW - 30 * HOUR},
            {"id": "idea_done_fresh", "title": "Done just now", "status": "done", "read": True, "updatedAt": NOW - HOUR, "at": NOW - 3 * DAY},
            {"id": "idea_new", "title": "Glowing tide pools", "status": "new", "read": False, "at": NOW - HOUR},
            {"id": "idea_keep", "title": "Keep this one", "status": "keep", "read": False, "at": NOW - 5 * DAY},
        ],
        "requests": [
            {"title": "Audit: ipc", "prompt": 'A-Eyes auditor found a error: preload invokes "x:y" but main.cjs has no handler. Fix it.', "area": "ipc", "source": "audit", "at": NOW - HOUR},
            {"title": "Audit: dom", "prompt": "A-Eyes auditor found a error: renderer looks up #gone but the template has no such id. Fix it.", "area": "dom", "source": "audit", "at": NOW - HOUR},
            {"title": "Resolve collision: crafting.lua", "prompt": "A-Eyes collision: C:\\repo\\game\\crafting.lua is being edited by 2 sessions.", "file": "C:\\repo\\game\\crafting.lua", "sessions": ["ses_active", "ses_working"], "source": "collision", "at": NOW - HOUR},
            {"title": "Resolve collision: old.lua", "prompt": "A-Eyes collision: C:\\repo\\game\\old.lua is being edited by 2 sessions.", "file": "C:\\repo\\game\\old.lua", "sessions": ["ses_stale", "ses_done"], "source": "collision", "at": NOW - HOUR},
            {"title": "Owner note", "prompt": "Please keep the swamp tar torches.", "source": "manual", "at": NOW - 10 * DAY},
            {"title": "Old chat", "prompt": "add a night mode", "source": "chat", "at": NOW - 4 * DAY},
            {"title": "Fix: dup", "prompt": "A-Eyes warn alert: same thing.", "source": "fix", "at": NOW - 2 * HOUR},
            {"title": "Fix: dup", "prompt": "A-Eyes warn alert: same thing.", "source": "fix", "at": NOW - 3 * HOUR},
        ],
        "checkpoints": {
            "ses_active": [_checkpoint("keep me", NOW - HOUR)],
            "ses_gone_old": [_checkpoint("old", NOW - 20 * DAY), _checkpoint("older", NOW - 21 * DAY)],
            "ses_gone_fresh": [_checkpoint("fresh", NOW - DAY)],
            "ses_working": [_checkpoint(f"note {index}", NOW - index * HOUR) for index in range(60)],
        },
        "collisions": [{"file": "C:\\repo\\game\\crafting.lua", "owner": "ses_active", "active": True, "sessions": [{"sessionId": "ses_active", "edits": 2, "active": True}, {"sessionId": "ses_working", "edits": 1, "active": True}]}],
        "audit": {"ok": False, "errors": 1, "warnings": 0, "findings": [{"level": "error", "area": "ipc", "message": 'preload invokes "x:y" but main.cjs has no handler'}]},
        "machine": {"wait": True, "lines": ["EXCLUSIVE lease held by perf — wait for it to finish"], "running": [{"pid": 101, "status": "healthy", "ageMinutes": 3}]},
        "executor": {"enabled": True, "running": [{"title": "Fix ipc handler", "minutes": 2}], "queued": 3, "waiting": None},
        "prefs": {"tidyDoneAfterHours": 24},
        "overseerTune": {"staleAfterHours": 200, "parallel": 2, "nonsense": 9, "tidyDoneAfterHours": "x"},
        "state": {
            "status": "running",
            "tickCount": 41,
            "nextTickAt": NOW + 2 * MINUTE,
            "heartbeatAt": NOW - 1000,
            "ai": {"keyPresent": True, "online": False, "lastError": "HTTP 401 unauthorized", "failures": 2},
            "problems": [{"kind": "update-held", "text": "live update held: renderer/idle.js failed the syntax check", "since": NOW - MINUTE}],
            "housekeeping": {"lastAt": NOW - HOUR, "tasksArchived": 1, "lastText": "archived 1 done task"},
            "messages": "not-a-list",
            "log": [1, {"kind": "tick", "text": "tick 40"}],
            "prefs": {"proactive": "yes", "foldAfterMinutes": -3, "parallel": 99, "aiParallel": 0},
            "agents": [
                {"role": "watcher", "status": "running", "since": NOW - 5000, "lastRunAt": NOW - 10_000, "runs": 3, "text": "watching", "target": {"kind": "session", "id": "ses_active"}, "targets": [{"kind": "session", "id": "ses_active"}], "progress": 0.4},
                {"role": "machine", "status": "done", "lastRunAt": NOW - 119_000, "runs": 1, "lastMs": 400, "text": "no strays", "target": None, "targets": [{"kind": "root", "id": "__root__"}], "progress": 1},
                {"role": "auditor", "status": "queued", "lastRunAt": NOW - HOUR},
                {"role": "briefer", "status": "error", "lastRunAt": NOW - 4 * MINUTE, "runs": 2, "error": "HTTP 429"},
                {"role": "ghost", "status": "running"},
            ],
            "overseer": {
                "reviews": 2,
                "lastReviewAt": NOW - 2 * HOUR,
                "lastSummary": "fair · ai link failing",
                "score": 72,
                "health": "fair",
                "findings": [{"severity": "warn", "title": "AI link failing", "detail": "earlier pass"}],
                "lessons": [{"text": "AI link failing: 2 consecutive failure(s)", "hits": 1, "firstAt": NOW - DAY, "lastAt": NOW - 2 * HOUR, "source": "ai"}, "junk", {"text": ""}],
                "directives": [{"at": NOW - 2 * HOUR, "kind": "pref", "text": "aiParallel 2→1"}, {"nope": True}],
                "scores": [{"at": NOW - DAY, "score": 80}, {"at": NOW - 2 * HOUR, "score": 72}, "junk"],
                "digest": {"logErrors": 0},
            },
            "junk": {"nested": True},
        },
        "messages": [
            "Status?",
            "What's happening",
            "Any open tasks",
            "ideas!",
            "Collisions?",
            "is the machine busy",
            "clean up please",
            "Fix the problems",
            "organise the tree",
            "pause",
            "resume",
            "help",
            "What can you do?",
            "Add a night mode to the booklet",
            "Update the README for the crafting bench",
            "how are you today",
            "Work on the upgrade this app so that the agent task I made",
            "Continue working on existing tasks using sub agents until done",
            "oversee the assistant",
            "hello",
            "tell me about the swamp torches",
            "what should I work on",
            "what are the agents doing",
            "test test",
        ],
    }


EXPECTED_INTENTS = [
    "status", "status", "tasks", "ideas", "collisions", "machine", "tidy", "fix", "organize", "pause", "resume", "help", "help", "request", "request", "chat", "request", "request", "overseer", "chat", "chat", "suggest", "agents", "request",
]


AGENT_ROLES = ["watcher", "machine", "auditor", "keeper", "compactor", "foreman", "thinker", "briefer", "overseer", "improver", "ideas", "grower", "responder", "reference", "cluster-planner", "cluster-reviewer"]

AGENT_EVENTS = [
    {"role": "watcher", "status": "running", "at": NOW + 1000, "target": {"kind": "session", "id": "ses_active"}, "targets": [{"kind": "session", "id": "ses_active"}, {"kind": "session", "id": "ses_stale"}], "progress": 0.5},
    {"role": "auditor", "status": "queued", "at": NOW + 1000},
    {"role": "auditor", "status": "running", "at": NOW + 2000, "text": "auditing the wiring", "target": {"kind": "assistant", "id": "__assistant__"}, "targets": [{"kind": "assistant", "id": "__assistant__"}], "progress": None},
    {"role": "watcher", "status": "done", "at": NOW + 2400, "text": "6 sessions · 2 folded", "target": None, "targets": [{"kind": "session", "id": "ses_active"}, {"kind": "session", "id": "ses_stale"}], "progress": 1},
    {"role": "briefer", "status": "error", "at": NOW + 3000, "error": "HTTP 429", "ms": 900},
    {"role": "keeper", "status": "running", "at": NOW + 4000},
    {"role": "responder", "status": "queued", "at": NOW + 4000},
    {"role": "ghost", "status": "running", "at": NOW + 4000},
    {"role": "machine", "status": "weird", "at": NOW + 4000},
]


def _journal_fixture():
    """The base fixture as a saved state with work in flight: two journal entries,
    one unanswered message, a running auditor row, closed 2 h 13 m ago."""
    fixture = _fixture()
    fixture["state"]["heartbeatAt"] = NOW - (2 * 60 + 13) * MINUTE
    fixture["state"]["agents"] = [{"role": "auditor", "status": "running", "since": NOW - 3 * HOUR, "lastRunAt": NOW - 3 * HOUR}, {"role": "machine", "status": "done", "lastRunAt": NOW - 3 * HOUR}]
    fixture["state"]["work"] = [
        {"id": "job_improve", "kind": "improve", "payload": {"focus": "explorer"}, "text": "improve the explorer column", "startedAt": NOW - 3 * HOUR, "attempts": 1, "status": "running", "target": {"kind": "session", "id": "ses_active"}, "targets": [{"kind": "session", "id": "ses_active"}, "junk", {"kind": "todo"}, {"kind": "assistant", "id": "__assistant__"}], "progress": 0.5},
        {"id": "job_ref", "kind": "reference", "taskId": "task_open", "payload": {"text": "crafting bench"}, "text": "gather for task Crafting bench recipes", "startedAt": NOW - 3 * HOUR, "status": "queued", "target": "nope", "progress": "half"},
        {"id": "", "kind": "junk"},
        "not an entry",
    ]
    fixture["state"]["messages"] = [
        {"id": "m1", "at": NOW - 4 * HOUR, "role": "user", "text": "status", "intent": "status"},
        {"id": "m2", "at": NOW - 4 * HOUR + 1, "role": "assistant", "text": "6 sessions.", "via": "local", "intent": "status"},
        {"id": "m3", "at": NOW - 3 * HOUR, "role": "user", "text": "please check the swamp torches", "intent": "request"},
    ]
    fixture["state"]["closedAt"] = NOW - DAY
    fixture["state"]["resumed"] = {"at": NOW - DAY, "jobs": ["improve"], "closedForMs": 5 * MINUTE}
    fixture["messages"] = ["status", "restart the interrupted work", "Resume the work!", "pick up where you left off", "what are you working on?", "continue the jobs you were doing", "resume"]
    return fixture


def _folders_fixture():
    """The base fixture with node context folders: junk mixed in, a folder on a
    task that the tidy will archive, one on a vanished task, a stale session
    folder, a fresh one, plus context events the service would write."""
    fixture = _fixture()
    fixture["state"]["nodeFolders"] = {
        "session:ses_active": {
            "updatedAt": NOW - HOUR,
            "entries": [
                {"at": NOW - 3 * HOUR, "kind": "run", "role": "executor", "text": 'autopilot "Fix the crafting bench" — done (exit 0)'},
                {"at": NOW - HOUR, "kind": "chat", "role": "responder", "text": 'asked "status" — 6 sessions, 3 active.'},
                "junk",
                {"text": ""},
            ],
        },
        "task:task:task_old_done": {"updatedAt": NOW - 30 * HOUR, "entries": [{"at": NOW - 30 * HOUR, "kind": "run", "role": "executor", "text": "old run on a task about to be archived"}]},
        "task:task:task_gone": {"updatedAt": NOW - HOUR, "entries": [{"at": NOW - HOUR, "kind": "note", "text": "the task vanished from the board"}]},
        "session:ses_gone": {"updatedAt": NOW - 20 * DAY, "entries": [{"at": NOW - 20 * DAY, "kind": "chat", "text": "stale talk"}]},
        "session:ses_gone_fresh": {"updatedAt": NOW - DAY, "entries": [{"at": NOW - DAY, "kind": "note", "text": "still warm"}]},
        "weird": {"entries": [{"at": NOW - HOUR, "text": "no colon in the key"}]},
    }
    fixture["state"]["focus"] = {"kind": "session", "id": "ses_active", "label": "Fix the crafting bench", "at": NOW - MINUTE}
    # A repeat of the folder's newest chat line (dedupes in place), a write on
    # a real task, and junk that must be ignored.
    fixture["nodeContext"] = [
        {"target": {"kind": "session", "id": "ses_active"}, "kind": "chat", "role": "responder", "text": 'asked "status" — 6 sessions, 3 active.', "at": NOW - 30 * MINUTE},
        {"target": {"kind": "task", "id": "task:task_open"}, "kind": "agent", "role": "reference", "text": "gathered 3 code hits · 1 sessions · 0 web", "at": NOW - 30 * MINUTE},
        {"text": "no target at all"},
        {"target": {"kind": "assistant", "id": "__assistant__"}, "text": "not a folder node"},
    ]
    return fixture


def _run_fixture(fixture):
    with tempfile.TemporaryDirectory() as directory:
        fixture_path = Path(directory) / "fixture.json"
        fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
        result = subprocess.run([NODE, str(ASSISTANT), "--fixture", str(fixture_path)], cwd=STUDIO, capture_output=True, text=True, encoding="utf-8", timeout=60)
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def _agent_roles_table():
    """AGENT_ROLES from scripts/assistant.mjs as [{role, cadenceMs, ai}], in order."""
    source = ASSISTANT.read_text(encoding="utf-8")
    block = re.search(r"export const AGENT_ROLES = \[(.*?)\n\];", source, re.S)
    assert block, "AGENT_ROLES table not found"
    rows = []
    for role, cadence, ai in re.findall(
        r'\{\s*role:\s*"([\w-]+)",\s*cadenceMs:\s*([^,]+),\s*ai:\s*(true|false)\s*\}', block.group(1)
    ):
        expression = cadence.strip().replace("MINUTE", "60000")
        rows.append({"role": role, "cadenceMs": int(eval(expression)), "ai": ai == "true"})  # noqa: S307 - fixed table
    return rows


def _function_body(source, name):
    """The braces-balanced body of `function name(` (or `async function name(`)."""
    match = re.search(r"(?:async\s+)?function\s+" + re.escape(name) + r"\s*\(", source)
    if not match:
        return ""
    start = source.index("{", match.end())
    depth = 0
    for index in range(start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    return source[start:]


class MefiStudioAssistantTests(unittest.TestCase):
    _payload = None

    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.tree3d = (STUDIO / "renderer" / "tree3d.js").read_text(encoding="utf-8")
        cls.idle = (STUDIO / "renderer" / "idle.js").read_text(encoding="utf-8")
        cls.explorer = (STUDIO / "renderer" / "explorer.js").read_text(encoding="utf-8")
        cls.readme = (STUDIO / "README.md").read_text(encoding="utf-8")
        cls.architecture = (STUDIO / "docs" / "architecture.md").read_text(encoding="utf-8")
        cls.gitignore = (STUDIO / ".gitignore").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")
        cls.module = ASSISTANT.read_text(encoding="utf-8")

    def payload(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        if MefiStudioAssistantTests._payload is None:
            MefiStudioAssistantTests._payload = _run_fixture(_fixture())
        return MefiStudioAssistantTests._payload

    # --- static: main.cjs / preload.cjs -------------------------------------------------

    def test_ipc_and_preload_wiring(self):
        for channel in ('ipcMain.handle("assistant:state"', 'ipcMain.handle("assistant:message"', 'ipcMain.handle("assistant:control"', 'ipcMain.handle("assistant:prefs"', 'ipcMain.handle("assistant:focus"', 'ipcMain.handle("assistant:work-on"'):
            with self.subTest(channel=channel):
                self.assertIn(channel, self.main)
        for name in ("assistantState", "assistantMessage", "assistantControl", "assistantPrefs", "assistantFocus", "assistantWorkOn", "onAssistant"):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)
        self.assertIn('"eyes:assistant"', self.preload, "the push listener must subscribe to eyes:assistant")
        self.assertIn('send("eyes:assistant"', self.main)
        work_on = self.main[self.main.index("async function assistantWorkOn") : self.main.index("async function assistantQueuePinnedWork")]
        self.assertIn("machine capacity and task requirements allow", work_on)
        self.assertIn("repeat", work_on)
        self.assertIn("if (!repeat)", work_on)

    def test_log_errors_carry_the_calling_role(self):
        # The digest's logErrors records must name who logged the error:
        # logError() stamps the calling role (an unknown caller falls back to
        # the innermost running agent, then the host), pool failures log their
        # own entry's role, and the auditor stamps the record the digest
        # reconciles against.
        self.assertIn("function logError(", self.main)
        error_fn = _function_body(self.main, "logError")
        self.assertIn('assistantLog("error"', error_fn, "logError routes through the shared log writer")
        self.assertIn("role ?? fallback", error_fn, "the caller's role wins")
        self.assertIn('?? "assistant"', error_fn, "an unknown caller falls back to the host, never an empty role")
        log_fn = _function_body(self.main, "assistantLog")
        self.assertIn("role: who", log_fn, "assistantLog stamps the role onto the row")
        settle_region = self.main[self.main.index("function assistantTimeout") : self.main.index("function assistantDrain")]
        self.assertIn("logError(text, entry.role)", settle_region, "a failed pool job logs its own role")
        self.assertIn("logError(entry.text, entry.role)", settle_region, "a timed-out job logs its own role")
        self.assertIn(
            "assistantState.audit = { ok: !result.errors",
            _function_body(self.main, "assistantAuditorJob"),
            "the audit pass stamps the reconciliation record the digest resets against",
        )
        self.assertIn("role", _function_body(self.module, "normalizeLog"), "loaded log rows keep their role")
        digest_fn = _function_body(self.module, "overseerDigest")
        self.assertIn('str(entry.role).trim() || "assistant"', digest_fn, "digest records default the role so a record is never anonymous")
        self.assertIn("auditClean", digest_fn, "the digest reconciles the counter against the last audit pass")

    def test_fresh_clone_catalog_and_csp_fallbacks(self):
        self.assertNotIn('models.snapshot.json', self.main, "the snapshot is retired; catalog:read reads the committed models.json")
        self.assertIn('const catalogDocument = createCatalogFileReader("models.json")', self.main)
        self.assertIn('ipcMain.handle("catalog:read", () => catalogDocument.read())', self.main)
        self.assertIn('path.join(STUDIO_ROOT, "data", fileName)', self.main)
        self.assertIn('http-equiv="Content-Security-Policy"', self.template)
        # worker-src falls back to script-src, which lists no blob: — without an
        # explicit worker-src the lag probe's blob worker is refused and the
        # occlusion-vs-lag disambiguation silently degrades to the old sentinel.
        self.assertIn("worker-src 'self' blob:;", self.template)

    def test_service_boots_from_when_ready_with_a_timeout_chain(self):
        self.assertIn("function startAssistant", self.main)
        self.assertIn("function assistantTick", self.main)
        ready = self.main.index("app.whenReady()")
        boot = re.search(r"setTimeout\((?:\(\)\s*=>\s*)?startAssistant", self.main)
        self.assertIsNotNone(boot, "startAssistant must be scheduled with setTimeout after app.whenReady")
        self.assertGreater(boot.start(), ready, "the boot hook lives inside app.whenReady")
        boot_line = self.main[self.main.rfind("\n", 0, boot.start()) + 1 : self.main.index("\n", boot.start())]
        self.assertTrue("CAPTURE" in boot_line and "CLI_MODE" in boot_line, f"the boot hook must skip capture and CLI modes: {boot_line.strip()}")
        for name in ("startAssistant", "assistantTick"):
            with self.subTest(function=name):
                self.assertNotIn("setInterval(", _function_body(self.main, name), "the service loop is a setTimeout chain")
        self.assertNotIn("setInterval(assistantTick", self.main)
        self.assertNotIn("setInterval(startAssistant", self.main)
        self.assertIn("powerSaveBlocker", self.main)
        self.assertIn("eyes-assistant.json", self.main)
        self.assertIn("normalizeState", self.main)

    def test_state_file_is_gitignored(self):
        self.assertIn("data/eyes-assistant.json", self.gitignore)

    def test_chat_payload_leads_with_the_message(self):
        # A fat facts/thread payload once pushed `message` past the 14k slice
        # and the model replied "no new message reached me". The user's text
        # must head the payload so trimming can never cut it.
        payload = self.main.index("{ message: text, did: done, thread, facts }")
        respond = self.main.index("async function assistantRespond")
        self.assertGreater(payload, respond, "the chat payload lives in assistantRespond")
        self.assertIn("slice(0, 14000)", self.main)

    def test_chat_requests_kick_the_executor_and_report_back(self):
        action = self.main.index('action === "queue-request"')
        region = self.main[action : self.main.index('} else if (action === "compact")', action)]
        self.assertIn('assistantAskForWork("chat instruction")', region, "a chat request starts work now, not on the next tick")
        self.assertIn('if (created) assistantAskForWork', region, "reusing existing work does not dispatch it again")
        self.assertIn("assistantCreateTask", region, "chat work lands on the task board, not the inbox")
        finish = self.main.index("pushAutopilotHistory(\"paused\"")
        report = self.main[finish : finish + 1600]
        self.assertIn('job.source === "chat"', report, "a finished chat job posts its result to the thread")
        self.assertNotIn(
            'job.kind === "request" && job.source === "chat"',
            report,
            "chat work is a board task; gating the report on kind===request swallowed every finish",
        )

    def test_chat_requests_dispatch_the_roster(self):
        # "the only working job is this responder" was the bug: a work
        # instruction must send every roster agent out, in parallel.
        action = self.main.index('action === "agents"')
        self.assertIn("assistantDispatchAgents", self.main[action : action + 300])
        body = _function_body(self.main, "assistantDispatchAgents")
        for role in ("watcher", "machine", "auditor", "keeper", "briefer", "thinker", "improver", "grower", "ideas", "reference"):
            with self.subTest(role=role):
                self.assertIn(f'"{role}"', body)
        self.assertIn("roster", self.main[self.main.index("ASSISTANT_CHAT_SYSTEM") : self.main.index("assistantFetch")], "the chat model is told it has agents")

    def test_node_focus_reaches_the_responder(self):
        # A tree click stores state.focus; the responder walks to the node when
        # the text names nothing else, and chat work carries it as claim context.
        self.assertIn("function assistantFocusSubject", self.main)
        respond = _function_body(self.main, "assistantRespond")
        self.assertIn("assistantFocusSubject(facts)", respond, "the focus grounds a reply that names nothing")
        action = self.main.index('action === "queue-request"')
        region = self.main[action : action + 1600]
        self.assertIn("assistantFocusSubject(facts)", region, "the focus rides the queued work")
        self.assertIn("focused,", region, "the focused node rides along as claim context on the board task")
        focus_fn = _function_body(self.main, "assistantFocus")
        self.assertIn('assistantLog("focus"', focus_fn, "a focus change is a log entry so the rail can pulse it")

    def test_replies_see_the_inbox_the_executor_and_the_picks(self):
        # The reply used to run half-blind: no request inbox, no idea what the
        # executor was building, and a payload trim that nulled ideas/briefing
        # outright — so the model answered "no briefing or ideas data". Now the
        # facts carry all of it plus ranked next-work picks.
        body = _function_body(self.main, "assistantMessageFacts")
        self.assertIn("REQUESTS_PATH", body, "the reply facts read the request inbox")
        self.assertIn("autopilot.jobs", body, "the reply facts see what the executor is building")
        self.assertIn("assistantState.log", body, "the reply facts read the assistant activity log")
        self.assertIn("suggestWork", body, "the reply facts carry ranked picks")
        for marker in ('"suggest"', '"agents"', '"log"', "export function suggestWork", "export function thinkPlan", "requests:", "executor:", "log:"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.module)
        chat = self.main[self.main.index("ASSISTANT_CHAT_SYSTEM") : self.main.index("async function assistantSessionId")]
        self.assertIn("suggestions", chat, "the chat model is told the picks exist")
        self.assertIn("facts.log", chat, "the chat model is told the activity log exists")
        respond = _function_body(self.main, "assistantRespond")
        self.assertIn("(facts?.ideas ?? []).slice(0, 8)", respond, "the payload trim shrinks facts, never drops them")
        dispatch = _function_body(self.main, "assistantDispatchAgents")
        self.assertIn("isFresh", dispatch, "a role that just ran is not fired again on the next instruction")

    def test_executor_width_scales_with_the_machine(self):
        # The parallel executor: the default width comes from the host's core
        # count instead of one fixed number, a saved pref always wins, spawns
        # stay inside the 1-12 band, and every spawn re-checks the machine lease.
        declarations = re.findall(r"function machineParallelDefault\(", self.main)
        self.assertEqual(len(declarations), 1, "machineParallelDefault must be declared exactly once (duplicate = merge corruption)")
        machine = _function_body(self.main, "machineParallelDefault")
        self.assertIn("os.cpus()", machine, "the width derives from the host's core count")
        self.assertIn("Math.min(2, Math.max(1, cores))", machine, "new installations default to two workers on multicore hosts")
        self.assertIn("EXECUTOR_PARALLEL_CAP = 3", self.main, "worker processes have a separate small cap")
        self.assertIn("Math.min(EXECUTOR_PARALLEL_MAX", self.main)
        self.assertIn("EXECUTOR_PARALLEL_MAX = 12", self.main)
        boot = _function_body(self.main, "bootAutopilot")
        self.assertIn("savedExecutorParallel(saved)", boot, "saved settings pass through the bounded worker setting")
        self.assertIn("Number.isFinite(width) && width >= 1 ? Math.min(EXECUTOR_PARALLEL_CAP, width) : machineParallelDefault()", self.main, "a saved width — narrow included — remains the operator's setting")
        # _function_body misreads `setAutopilot(prefs = {})`, so assert the
        # clamp line itself.
        self.assertRegex(self.main, r"prefs\.parallel !== undefined\)[^\n]*Math\.min\(EXECUTOR_PARALLEL_MAX, Math\.max\(1", "a manual patch is clamped into the 1-12 band too")
        dispatch = _function_body(self.main, "executeNextRequest")
        self.assertIn("autopilot.jobs.length < Math.max(1, autopilot.parallel)", dispatch, "the dispatcher fills every slot the width allows")
        next_job = _function_body(self.main, "spawnNextJob")
        self.assertIn('leases?.exclusive) return "busy"', next_job, "every spawn re-checks the machine lease before starting")
        self.assertIn("leaseStatus", next_job, "a spawn must not write machine-status.json — that hung dispatch on OneDrive")
        self.assertGreaterEqual(next_job.count("leaseStatus"), 2, "the spawn rechecks the lease after the claim lands, not only before the pick")
        self.assertIn("one transactional mutation", next_job, "the claim is a CAS so two fills (or two processes) cannot execute the same title")
        self.assertIn('return "lost"', next_job, "a lost claim must not launch a child")
        self.assertIn("Race recheck of the machine lease after the claim", next_job)
        self.assertIn("releaseExecutorClaim", next_job, "an exclusive holder that wins the race gets the claim dropped, not a failed run")
        self.assertNotIn('resourcePass({ kill: false, reason: "autopilot"', next_job, "resourcePass on every spawn wrote two JSON files and could stall the fill")
        self.assertIn('assistantAskForWork("the pool was widened")', self.main, "widening the pool fills the new slots at once")
        self.assertIn('stop === "lost"', dispatch, "a lost claim retries the next piece instead of parking the fill")
        self.assertIn("claimWork", next_job, "file claims and live editors are checked before the board claim lands")
        self.assertIn('return deferred ? "deferred"', next_job, "a blocked file skips this pick; the executor is not parked")
        self.assertIn("waiting on live editors", dispatch, "deferred file claims surface as waiting, not as a machine-busy park")
        self.assertEqual(len(re.findall(r"async function releaseExecutorClaim\(", self.main)), 1, "claim release must be declared once")
        self.assertIn("watches test leases", self.architecture, "the lease-aware machine coordination is documented")
        self.assertEqual(1, len(re.findall(r"const EXECUTOR_PARALLEL_MAX = 12", self.main)), "one EXECUTOR_PARALLEL_MAX — a second copy is merge corruption")
        self.assertEqual(1, len(re.findall(r"function assistantParallel\(", self.main)), "assistantParallel must be declared exactly once")
        self.assertEqual(1, len(re.findall(r"let executorFillInFlight", self.main)), "the fill mutex is a single binding")
        load = _function_body(self.main, "loadAssistant")
        self.assertNotIn("(Number(assistantState.prefs.parallel) || 0) <= 3", load, "a saved roster width — narrow included — is the operator's setting, never silently widened")
        self.assertNotIn("(Number(assistantState.prefs.aiParallel) || 0) <= 2", load, "a saved AI width is the operator's setting, never silently widened")
        self.assertIn("assistantParallel(prefs.parallel, EXECUTOR_PARALLEL_MAX, 8)", self.main)
        self.assertIn("assistantParallel(prefs.aiParallel, AI_PARALLEL_MAX, 4)", self.main)

    def test_duplicate_declarations_are_scanned_before_a_merge(self):
        # Parallel-executor patches colliding in main.cjs show up as two copies
        # of the same top-level function/const. The watcher scans the host
        # files (and whatever collisions/presence name) and queues a fix
        # instead of writing a second copy.
        self.assertIn("function executorScanFiles", self.main)
        self.assertIn("async function duplicateDeclarationRequests", self.main)
        self.assertIn("scanDuplicateDeclarations", self.main)
        self.assertIn("requestsFromDuplicates", self.main)
        self.assertIn('path.join(projectRoot(), "main.cjs")', _function_body(self.main, "executorScanFiles"))
        watcher = _function_body(self.main, "assistantWatcherJob")
        self.assertIn("duplicateDeclarationRequests", watcher, "the watcher queues merge-corruption fixes even when there is no collision")
        self.assertIn("assistantCache.duplicateScan", self.main, "the keeper tidies resolved duplicate requests from the last scan")
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn("adoptAdvice", spawn, "a peer session that already implemented the feature is named in the prompt")
        self.assertIn("requestsFromCollisions", watcher)
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        script = (
            "import { duplicateDeclarations, requestsFromDuplicates } from './scripts/eyes.mjs';"
            "import { readFile } from 'node:fs/promises';"
            "import { setTimeout as sleep } from 'node:timers/promises';"
            "const dirty = ["
            "  'function foo() {}',"
            "  'const x = 1;',"
            "  'function foo() {}',"
            "  'export const EXECUTOR_PARALLEL_MAX = 12;',"
            "  'const EXECUTOR_PARALLEL_MAX = 12;',"
            "].join('\\n');"
            "const hits = duplicateDeclarations(dirty);"
            "if (!hits.some((row) => row.name === 'foo' && row.lines.length === 2)) throw new Error('foo ' + JSON.stringify(hits));"
            "if (!hits.some((row) => row.name === 'EXECUTOR_PARALLEL_MAX' && row.lines.length === 2)) throw new Error('const ' + JSON.stringify(hits));"
            # The live scan re-reads main.cjs through a short settle: the full
            # suite runs while sibling autopilot sessions edit the same tree,
            # and an in-flight patch can transiently hold two copies of one
            # declaration (run_1789855386972_4 saw the suite one-shot
            # failures=1 in exactly that window). A real merge corruption
            # persists across the settle and still fails the run.
            "let live = [];"
            "for (let attempt = 0; attempt < 3; attempt += 1) {"
            "  live = duplicateDeclarations(await readFile('main.cjs', 'utf8'));"
            "  if (!live.length) break;"
            "  await sleep(1500);"
            "}"
            "if (live.length) throw new Error('main.cjs duplicates ' + JSON.stringify(live));"
            "const file = 'C:/repo/mefi-studio/main.cjs';"
            "const queued = requestsFromDuplicates([{ file, duplicates: hits }], []);"
            "if (queued.length !== 1 || queued[0].source !== 'duplicate') throw new Error(JSON.stringify(queued));"
            "const skipped = requestsFromDuplicates([{ file, duplicates: hits }], queued);"
            "if (skipped.length) throw new Error('dedupe failed');"
            "console.log(JSON.stringify({ ok: true }));"
        )
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", script],
            cwd=STUDIO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)["ok"])

    # --- static: renderer + docs ---------------------------------------------------------

    def test_template_ids(self):
        for element_id in ("assistant-input", "assistant-send", "assistant-thread", "assistant-activity", "assistant-service", "idle-pill-assistant"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)

    def test_chat_composers_are_chatbot_shaped(self):
        # Both composers are multiline textareas with quick-ask chips, the
        # renderer grows them as you type, Enter sends while Shift+Enter makes
        # a newline, and a pending reply shows a thinking bubble.
        for element_id in ("assistant-chips", "idle-chat-chips"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        self.assertIn('<textarea id="assistant-input"', self.template)
        self.assertIn('<textarea id="idle-chat-input"', self.template)
        self.assertIn('data-msg="what should I work on"', self.template)
        self.assertIn('data-msg="read the log"', self.template)
        for marker in ("growArea", "thinkingBubble", "replyPending", "event.shiftKey", "chat-chips", "el.chatChips", "thinking?.text"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)
        for marker in ("growArea", "thinkingBubble", "replyPending", "event.shiftKey", "thinking?.text"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.explorer)
        styles = (STUDIO / "renderer" / "styles.css").read_text(encoding="utf-8")
        for selector in (".chat-chips", ".assistant-msg.thinking", "msg-dot", ".assistant-msg.thinking .thought"):
            with self.subTest(selector=selector):
                self.assertIn(selector, styles)

    def test_tree_and_command_view_handle_the_new_node_kinds(self):
        for kind in ('"assistant"', '"folded"'):
            with self.subTest(kind=kind):
                self.assertIn(kind, self.tree3d)
        self.assertIn("__assistant__", self.tree3d)
        self.assertIn("__folded__", self.tree3d)
        help_rows = re.search(r"const HELP_ROWS = \[(.*?)\n\s*\];", self.idle, re.S)
        self.assertIsNotNone(help_rows, "idle.js must keep its HELP_ROWS table")
        self.assertIn('"M"', help_rows.group(1), "the M key row belongs in HELP_ROWS")
        for kind in ('"assistant"', '"folded"'):
            with self.subTest(idle_kind=kind):
                self.assertIn(kind, self.idle)

    def test_tree_clicks_point_the_assistant_at_nodes(self):
        # The rail: a session/todo click hands the node to assistantFocus, the
        # focused node wears a ring, and the "focus" event pulses to it.
        for marker in ("focusAssistant", "assistantFocus", 'event.kind === "focus"', "event.focus", "focused on"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.tree3d)
        # The Command view: selecting a work node points the assistant at it,
        # the card can unfocus or dispatch "Work on it", and the focus event
        # re-renders the open card.
        for marker in ("focusAssistant(node)", 'kind === "focus"', '"Work on it"', "focused on this"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)
        # The Explorer: a rail click stages the instruction in an empty composer.
        explorer = (STUDIO / "renderer" / "explorer.js").read_text(encoding="utf-8")
        self.assertIn('event.detail?.node', explorer)
        self.assertIn('Work on "', explorer)

    def test_readme_documents_the_assistant(self):
        self.assertIn("docs/architecture.md", self.readme, "the README links the feature walkthrough")
        self.assertIn("Assistant that keeps working", self.architecture)
        self.assertIn("service loop", self.architecture)
        self.assertIn("overseer", self.architecture, "the walkthrough names the overseer")

    def test_overseer_is_wired_above_the_assistant(self):
        # The R&D layer: its own prompt, its own job on the roster, a cadence
        # entry, a control action, UI buttons, and a satellite drawn above the
        # assistant node rather than in the worker ring.
        for marker in ("ASSISTANT_OVERSEER_SYSTEM", "overseer: assistantOverseerJob", '"briefer", "overseer"', 'action === "overseer"'):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        # The repair half of the overseer: stale sessions are rescued from the
        # pure module's plan, and the staliest one can take the assistant's focus.
        self.assertIn("assistantModule.staleRescues(", self.main, "the repair pass plans the rescues in the pure module")
        self.assertIn("filed resume work for", self.main, "the repair reports the rescues it filed")
        self.assertIn("focused the assistant on", self.main, "the repair points the assistant at the stale work")
        for element_id in ("idle-chat-overseer", "assistant-overseer"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        self.assertIn('overseer: "overseeing…"', self.tree3d)
        self.assertIn('agent.role === "overseer"', self.tree3d)
        self.assertIn("assistantNode.y - 26", self.tree3d, "the overseer hovers above the assistant node")
        self.assertIn('assistantControl("overseer"', self.idle)
        self.assertIn("assistant-overseer", self.idle, "the assistant card carries the overseer line")
        self.assertNotIn('role !== "overseer"', self.main, "the cadence filter never gates the overseer — it runs 24/7")
        job = _function_body(self.main, "assistantOverseerJob")
        self.assertIn("overseerTalk", job, "the overseer speaks findings to the assistant instead of only filing upgrades")
        self.assertIn('assistantCommitThought(talk.say, "overseer")', job)
        self.assertIn('assistantCommitThought(talk.reply, "thinker")', job)
        self.assertIn("assistantEnqueueRole(role, ASSISTANT_PRIORITY.demand)", job, "the assistant sends the owning scouts to fix what the overseer found")
        self.assertIn('assistantAskForWork("overseer: fix what I found")', job)

    def test_executor_verdict_is_the_sentinel_not_the_exit_code(self):
        # `opencode run` exits 1 even on a clean run. Judging by exit code meant
        # every finished job was filed as a failure: tasks bounced back to open,
        # collected runFailures until they were dropped at 5, and three short
        # runs tripped the infra breaker and parked the executor. The run is
        # asked to print a sentinel instead, and that is the verdict.
        self.assertIn('EXECUTOR_DONE_MARK = "MEFI_JOB_DONE"', self.main)
        self.assertIn("${EXECUTOR_DONE_MARK} as the last thing you say", self.main, "the prompt has to ask for the sentinel")
        self.assertIn("isDoneMarkerLine(line, EXECUTOR_DONE_MARK)", self.main, "the stream sets sawDone by STRICT line match — quoting the protocol in prose must not fake a verdict")
        self.assertIn("export function isDoneMarkerLine", self.module, "the strict match is a pure, tested rule")
        self.assertIn("parseExecutorResult", self.module, "the worker may attach its own account of done/remaining to the attempt")
        self.assertIn("const ok = errorMessage == null && (entry.sawDone || code === 0);", self.main)
        body = _function_body(self.main, "spawnNextJob")
        self.assertNotIn("if (code === 0) {", body, "nothing inside the executor may branch on the exit code alone")
        self.assertIn("opencode run --auto", self.main, "a headless run has nobody to answer a permission prompt")
        # A run killed at the deadline can never print the sentinel, so it is
        # always a failure however much it achieved. The budget it is told about
        # has to leave headroom before the kill, and the tail carrying the
        # sentinel is budgeted out of the prompt before the task text is.
        budget = int(re.search(r"EXECUTOR_BUDGET_MINUTES = (\d+)", self.main).group(1))
        kill_minutes = int(re.search(r"EXECUTOR_KILL_MS = (\d+) \* 60 \* 1000", self.main).group(1))
        self.assertLess(budget, kill_minutes, "the told budget must leave room to wrap up before the hard kill")
        self.assertIn("EXECUTOR_KILL_MS + 90 * 1000", self.main, "wedged is after the kill, or live jobs get flagged while still allowed to work")
        self.assertIn("EXECUTOR_PROMPT_MAX - tailFlat.length", self.main, "the sentinel instruction is never what gets truncated")
        self.assertIn("const body = String(job.prompt ?? \"\")", self.main, "the task's own text is budgeted separately — obligations are trimmed last, not first")
        self.assertIn("!ok && !entry.spoke", self.main, "a run that talked is never an infrastructure failure")

    def test_the_assistant_hands_out_the_work(self):
        # The auto builder files requests and owns the child processes; deciding
        # WHAT runs belongs to the assistant. The foreman is the only thing that
        # fills an executor slot, so every dispatch is a visible roster job
        # rather than a side effect somewhere in the autopilot.
        self.assertIn("async function assistantForemanJob", self.main)
        self.assertIn("foreman: assistantForemanJob", self.main)
        self.assertIn("function assistantAskForWork", self.main)
        # Exactly two mentions: the definition, and the foreman's single call.
        # Anything else reaching into the executor means a dispatch the assistant
        # did not make and cannot show on the roster.
        self.assertEqual(
            2,
            len(re.findall(r"executeNextRequest\(\)", self.main)),
            "only the foreman may fill a slot; everything else asks via assistantAskForWork",
        )
        self.assertIn("await executeNextRequest();", _function_body(self.main, "assistantForemanJob"))
        self.assertIn("executorFillInFlight", _function_body(self.main, "executeNextRequest"), "two timed-out foremen must not claim the same work")
        pump = _function_body(self.main, "assistantPump")
        self.assertIn('!["responder", "foreman", "machine"].includes(entry.role)', pump, "the foreman and machine agent bypass the roster cap so watcher ticks cannot starve dispatch or capacity checks")
        # The auto builder's own pass files work and then asks, it never dispatches.
        pass_body = _function_body(self.main, "autopilotPass")
        self.assertIn("assistantAskForWork(", pass_body)
        self.assertNotIn("executeNextRequest", pass_body)
        roles = _agent_roles_table()
        row = next((item for item in roles if item["role"] == "foreman"), None)
        self.assertIsNotNone(row, "the foreman is on the roster, so its dispatches are attributable")
        self.assertGreater(row["cadenceMs"], 0, "it keeps the builders fed on its own")
        self.assertFalse(row["ai"], "handing out work must not need an API key")
        self.assertIn('foreman: "handing out work"', self.main)
        self.assertIn('foreman: "handing out work…"', self.tree3d)

    def test_the_assistant_owns_the_auto_builder_card(self):
        # The Auto Builder card is a view of the assistant's dispatch, not of
        # executor internals: idle is a decision ("all slots busy", "nothing to
        # hand out"), so the card shows the foreman's line and the reason the
        # assistant last reached for work.
        self.assertIn("function foremanStatus", self.main)
        self.assertIn("foreman: foremanStatus()", self.main, "the status payload carries it to the renderer")
        self.assertIn("autopilot.lastAsk = { reason", self.main, "why the assistant reached for work rides along")
        self.assertIn("assistant.foreman", self.idle, "the card reads the assistant, not the raw queue")
        self.assertIn("assistant · ", self.idle)
        # The builder nodes have to sit on the work, not pile onto the hub.
        self.assertIn("function hostForJob", self.idle)
        self.assertIn("BUILDER_FIELD", self.idle, "a job with no node on the board gets its own ring")
        self.assertIn("node.onHost", self.idle, "on-the-work and adrift orbit differently")
        sync = _function_body(self.idle, "syncAgentMotion")
        self.assertNotIn('node.label = `building · ${elapsed}`', sync, "three identical labels said nothing")

    def test_compactor_keeps_the_queue_runnable(self):
        # The keeper prunes by age; the compactor works on shape and always ends
        # by firing off what can run, so a compacted queue starts moving in the
        # same pass instead of waiting for the next autopilot tick.
        self.assertIn("export function compact({", self.module)
        self.assertIn("COMPACT_LIMITS", self.module)
        self.assertIn("function planThemeKey", self.module, "overlapping idea-fold plans collapse by theme")
        self.assertIn("isFinishedTask", self.module, "done duplicates collapse instead of sitting on the board")
        self.assertIn('task.status !== "archived"', self.module, "a leftover request matching a done task is absorbed")
        self.assertIn("function mergeCollisionRequest", self.module, "same session pair collision alerts collapse into one")
        self.assertIn("function fixThemeKey", self.module, "same-theme Fix: tickets collapse even when titles differ")
        self.assertIn("function isFixTicket", self.module)
        self.assertIn("conflictsWithLiveFix", self.main, "a live Fix: job holds its subsystem so a twin cannot spawn")
        self.assertIn("function collisionRequestLive", self.module, "tidy keeps a grouped collision by file or session pair")
        self.assertIn("files: uniqueStrings(collisionFiles(entry))", self.module, "AI facts keep the grouped file list")
        for marker in ("compactor: assistantCompactorJob", "async function assistantCompactorJob", "assistant.compact({ requests: board.requests, tasks: stamped, ideas: board.ideas, collisions: assistantCache.store?.collisions, now"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        body = _function_body(self.main, "assistantCompactorJob")
        self.assertIn('assistantAskForWork("compacted")', body, "compacting without handing the work on is only half the job")
        # Ideas pile up faster than anyone reads them, so they fold into plans.
        self.assertIn("function planIdeas", self.module)
        for marker in ("planMinIdeas", "maxPlansPerPass", "planIdeaCap", "stalePlanHours"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.module)
        self.assertIn('idea.source === "chat"', self.module, "session dumps do not fold into plans")
        self.assertIn("report.plansDropped", self.module, "leftover unclaimed idea-fold plans leave the board")
        # The board gateway owns every write: the compactor reads and persists
        # through mutateBoard, so a promotion landing mid-pass survives.
        self.assertIn("await mutateBoard((board) => {", body, "the compactor mutates the board through the gateway, not raw file writes")
        self.assertIn("ideas: out.ideas", body, "a planned idea has to be written back or it re-plans forever")
        self.assertIn("autopilot.jobs.map((job) => job.taskId)", body, "a task the executor holds must survive the pass")
        # Compaction preserves intent: merges rewire references and rebuild the
        # prompt; nothing an idea said is lost when its plan expires.
        self.assertIn("function applyRelink", self.module, "merged/expired plans rewire their ideas' task links")
        self.assertIn("function rebuildPlanPrompt", self.module, "a merged plan's prompt is rebuilt from the surviving obligation set")
        # The Command view keeps the tree summary and the autopilot status in one
        # slot and both carry a `running`: a roster COUNT vs the list of build
        # jobs. Replacing wholesale let the count win on every rebuild, so the
        # builder nodes tracked a phantom job and never the real ones.
        self.assertNotIn("state.assistant = snapshot.assistant", self.idle, "the summary must not clobber the job list")
        for marker in ("rosterRunning: summary.running", "appendBuilderNodes()", "const autopilotBusyIds ="):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)
        roles = _agent_roles_table()
        row = next((item for item in roles if item["role"] == "compactor"), None)
        self.assertIsNotNone(row, "the compactor is on the roster")
        self.assertGreater(row["cadenceMs"], 0, "it runs on its own")
        self.assertFalse(row["ai"], "it must work with no API key")
        # Every per-role table has to know it, or the tree draws a nameless node.
        self.assertIn('compactor: "compacting the queue"', self.main)
        self.assertIn('compactor: "compacting the queue…"', self.tree3d)
        self.assertIn("compactor:", self.module)

    def test_duplicate_requests_and_directives_dedupe_at_write(self):
        # A-Eyes overseer directives: the compactor hashes request payloads and
        # drops exact duplicates before they enqueue (a refiled snapshot under
        # reworded display text is one request), and the overseer dedupes its
        # directives at write time by normalized text — a rephrase bumps the
        # recorded row instead of appending a third copy.
        self.assertIn("export function requestPayloadKey", self.module, "the payload hash is the module's own normaliser, not a second copy in main")
        compact_body = self.module[self.module.index("export function compact({") :]
        self.assertIn("requestPayloadKey(request)", compact_body, "the compactor hashes every request payload")
        self.assertIn("payloadKeys.has(payloadKey)", compact_body, "exact payload duplicates drop before enqueue")
        self.assertIn("recorded.findIndex((row) => compactKey(row.text) === key)", self.module, "directives dedupe by normalized text")
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        script = (
            "import { compact, overseerMerge } from './scripts/assistant.mjs';"
            "const now = 1800000000000;"
            "const dup = compact({ now, tasks: [], requests: ["
            "  { title: 'Resume: eyes.mjs atomic write guards', prompt: 'A-Eyes overseer: resume the atomic write guards.', source: 'overseer', at: now - 60000 },"
            "  { title: 'Atomic write guards: resume eyes.mjs', prompt: 'A-Eyes overseer: resume the atomic write guards.', source: 'overseer', at: now },"
            "]});"
            "if (dup.requests.length !== 1 || dup.report.duplicateRequests !== 1) throw new Error('payload duplicates survived: ' + JSON.stringify({ kept: dup.requests.map((request) => request.title), report: dup.report }));"
            "const distinct = compact({ now, tasks: [], requests: ["
            "  { title: 'Resume: eyes.mjs atomic write guards', prompt: 'resume the atomic write guards', source: 'overseer', at: now },"
            "  { title: 'Resume: eyes.mjs queue gates', prompt: 'resume the queue gates', source: 'overseer', at: now },"
            "]});"
            "if (distinct.requests.length !== 2) throw new Error('a different ask collapsed: ' + JSON.stringify(distinct.requests.map((request) => request.title)));"
            "const base = { reviews: 1, directives: [{ at: now - 3600000, kind: 'finding', text: 'Resume: eyes.mjs atomic write guards' }] };"
            "const again = overseerMerge(base, {}, now + 1000, { directives: [{ text: 'resume eyes mjs atomic write guards' }] });"
            "if (again.directives.length !== 1 || again.directives[0].at !== now + 1000) throw new Error('rephrase appended instead of bumping: ' + JSON.stringify(again.directives));"
            "const thrice = overseerMerge(again, {}, now + 2000, { directives: [{ text: 'Resume: eyes.mjs atomic write guards!' }] });"
            "if (thrice.directives.length !== 1) throw new Error('third copy appended: ' + JSON.stringify(thrice.directives));"
            "const fresh = overseerMerge(thrice, {}, now + 3000, { directives: [{ text: 'Resume: eyes.mjs queue gates' }] });"
            "if (fresh.directives.length !== 2) throw new Error('a new directive was dropped: ' + JSON.stringify(fresh.directives.map((entry) => entry.text)));"
            "console.log(JSON.stringify({ ok: true }));"
        )
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", script],
            cwd=STUDIO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)["ok"])

    def test_ai_review_compacts_the_board_and_groups_tasks_into_plans(self):
        # The AI review button is not only ingestion: it reviews the board it
        # was pressed on. Inside the same locked write the pass compacts with
        # the compactor's own rules (duplicate tasks collapse, loose ideas fold
        # into plans) and the model's taskGroups fold near-duplicate open tasks
        # into plan tasks the local title keys could never see.
        prompt = self.main[self.main.index("ASSISTANT_IDEAS_SYSTEM") : self.main.index("ASSISTANT_OVERSEER_SYSTEM")]
        self.assertIn("taskGroups", prompt, "the ideas system prompt carries the taskGroups contract")
        self.assertIn("openTasks", prompt, "the model is told the groups name live board tasks")
        ideas_body = _function_body(self.main, "scanIdeasInternal")
        self.assertIn("openTasks", ideas_body, "the review payload carries the live board")
        self.assertIn("assistantModule.compact(", ideas_body, "the AI review compacts through the pure module's rules")
        self.assertIn("autopilot.jobs.map((job) => job.taskId)", ideas_body, "a task the executor holds must survive the review's compaction")
        self.assertIn("taskGroups", ideas_body, "the model's groups ride into the compaction")
        self.assertIn("function planTaskGroups", self.module)
        self.assertIn("planTaskCap", self.module, "one plan may not absorb the whole board")
        self.assertIn("report.taskPlans", self.module, "the review reports which plans it folded")
        # Task plans share the idea-plan lifecycle: the theme key recognises
        # both shapes, so same-theme plans merge and unclaimed ones expire.
        self.assertIn("(?:ideas?|tasks?)", self.module, "planThemeKey recognises task plans too")
        ideas_js = (STUDIO / "renderer" / "ideas.js").read_text(encoding="utf-8")
        self.assertIn("result.text ||", ideas_js, "the status line shows the pass's own summary")

    def test_persistence_guarantees_reach_the_running_loop(self):
        # The review's persistence regressions: the guarantees live in the
        # store helpers, but they only count when the runtime loop enforces
        # them. The gateway awaits the (synchronous-contract) store mutation
        # before broadcasting; the claim, its release, and the settlement are
        # transactional gateway mutations, not read-then-write pairs; a torn
        # board VIEW is regenerated from the authority, never salvaged back
        # into it; and completion is verified against the acceptance contract
        # with a bounded retry budget.
        gateway = _function_body(self.main, "mutateBoard")
        self.assertIn("await eyes.boardMutate(", gateway, "the gateway awaits the store mutation, or every broadcast rides an unresolved Promise")
        self.assertIn("mutator must be synchronous", gateway, "a Promise-returning mutator loses its replacement arrays and must be refused")
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn("await mutateBoard(", spawn, "the claim is one transactional mutation")
        self.assertIn("lease = { pid: process.pid, at: startedAt }", spawn, "the claim stamps a durable lease")
        self.assertIn('"verifying"', spawn, "a request mid-verification is not re-spawnable")
        release = _function_body(self.main, "releaseExecutorClaim")
        self.assertIn("await mutateBoard(", release, "claim release rides the same transactional path")
        settle = _function_body(self.main, "autopilotHousekeeping")
        self.assertIn("verifyCompletion", settle, "verification uses the acceptance contract")
        self.assertIn("verifyAttempts", settle, "verification retries are bounded, not an infinite respawn loop")
        fix = _function_body(self.main, "assistantFixPass")
        self.assertIn("repairBoardView", fix, "a torn board view is quarantined and regenerated from the store")
        scan = _function_body(self.main, "scanIdeasInternal")
        self.assertIn("after: { at:", scan, "the ingestion cursor is a keyset tuple, oldest-first")
        self.assertIn("lastId", scan, "the part id rides with the timestamp so duplicate stamps cannot skip rows")
        self.assertIn("sourceKey", scan, "the scan stamps the source line so a re-scanned note dedupes")

    def test_keyless_ideas_scan_never_mints_chat_rows(self):
        # The regex harvest used to mint a store row per candidate chat line
        # (71 chat-noise excerpts had to be swept out of the backlog). The
        # keyless pass may only consume the cursor window; chat lines reach
        # the AI review as candidates, and only its additions — stamped
        # source: "ai" — may enter the ideas store.
        scan = _function_body(self.main, "scanIdeasInternal")
        self.assertNotIn('pushAddition(idea, "chat")', scan, "the keyless scan mints chat rows again")
        self.assertNotIn('source: "chat"', scan, "the scan itself cannot stamp chat provenance into the store")
        self.assertIn('pushAddition(idea, "ai")', scan, "only the AI review's additions reach the store")
        self.assertIn("no new chat material since the last scan", scan, "a quiet window is consumed, not re-scanned")
        self.assertIn('idea.source !== "chat"', self.module, "a stray chat row still cannot auto-promote from the backlog")

    def test_real_work_outranks_the_assistants_own_upkeep(self):
        # The overseer files upkeep chores by the dozen. Picking on
        # source == "a-eyes" meant those took every executor slot the moment it
        # warmed up (20 of 34 open tasks) while the app and game work waited.
        # The pick is now one ranking across the inbox and the board
        # (compareWork / workPriority), so a chat task never waits behind
        # auto-filed requests whatever either is worth.
        self.assertIn("function workPriority", self.main)
        self.assertNotIn('runnable.find((item) => item.source === "a-eyes")', self.main, "the old pick order starved real work")
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn("compareWork(a.ref, b.ref)", spawn, "one ranking across the inbox and the board, worth first")
        self.assertIn("workTitleKey", spawn, "inbox titles already on the board must not spawn a second run")
        self.assertIn("conflictsWithLiveFix", spawn, "two Fix: jobs on the same subsystem must not fill two slots")
        self.assertIn("compileMemory", spawn, "builders get a pushed memory primer, they do not have to search")
        self.assertIn("DIG REQUIRED", spawn)
        self.assertIn("status !== \"archived\"", spawn, "a finished task's title stays taken so a leftover request cannot re-run it")
        # The worth ranking lives behind the Policy Lab's frozen baseline
        # policy (scripts/policy.mjs) with the inline port as the load-failure
        # fallback: compareWork delegates, and BOTH paths must keep the pin
        # rule (a pin outranks every band).
        compare = _function_body(self.main, "compareWork")
        self.assertIn("policyBaselinePort.compare(a, b)", compare, "the live ranking delegates to the extracted baseline policy")
        self.assertIn("fallbackCompareWork(a, b)", compare, "dispatch survives the policy module failing to load")
        self.assertIn("fallbackWorkPriority(a)", _function_body(self.main, "fallbackCompareWork"), "a pin outranks every band, in the fallback too")
        policy = (STUDIO / "scripts" / "policy.mjs").read_text(encoding="utf-8")
        self.assertIn("baselineCompareWork", policy, "the extracted baseline owns the ordering")
        self.assertIn("PIN: 5", policy, "a pin is the top worth band")
        self.assertIn("if (item?.pin) return BAND.PIN", policy)
        priority = _function_body(self.main, "fallbackTaskPriority")
        self.assertIn("SELF_MAINTENANCE.test(title)", priority)
        self.assertIn("return 0", priority, "upkeep sorts last, it is not dropped")
        self.assertIn('task?.source === "chat"', priority, "what the user asked for by hand goes first")
        # The compactor caps the backlog so it cannot simply refill.
        self.assertIn("maxSelfMaintenance", self.module)
        self.assertIn("export const isSelfMaintenance", self.module)
        self.assertIn("!task.runId", self.module, "a claimed chore is never shelved")
        # The housekeeping backlog cap kept the 25 NEWEST, so a board full of
        # fresh upkeep chores silently deleted real work that had waited
        # longest. The rules live in the pure module (housekeepingSweep, tested
        # behaviorally in tests/); the host applies them under the
        # board lock. _function_body cannot parse the destructured signature,
        # so these pin the sweep-unique lines in the module source.
        self.assertIn("No queue-length truncation", self.module, "bounded scheduling retains all accepted work")
        self.assertIn("if (task.runId) return true", self.module, "never cut a task a run is holding")
        self.assertIn("assistant.housekeepingSweep(", _function_body(self.main, "autopilotHousekeeping"), "the host applies the pure sweep under the board lock")

    def test_assistant_is_always_on_and_owns_the_active_jobs(self):
        # The roster and the executor used to run blind to each other: the
        # assistant could report "idle, no problems" while the executor sat
        # parked with a full queue and nothing was being built.
        self.assertIn("function assistantSuperviseJobs", self.main)
        self.assertIn("assistantSuperviseJobs(now)", _function_body(self.main, "assistantTick"))
        supervise = _function_body(self.main, "assistantSuperviseJobs")
        for marker in ("autopilot.execute", "ASSISTANT_JOB_WEDGED_MS", "assistantAskForWork(", 'assistantSetProblems(["executor"]'):
            with self.subTest(marker=marker):
                self.assertIn(marker, supervise)
        self.assertIn("function queuedWorkCount", self.main)
        self.assertIn("async function refreshAutopilotQueue", self.main)
        self.assertIn("PROBLEM_ROLES", self.module)
        self.assertIn("rolesForProblems", self.module)
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn("lastRunError", spawn, "a failed run's next prompt must name the failure")
        self.assertIn("Previous run failed", spawn)
        self.assertIn("claimWork", spawn, "parallel builders get adopt-don't-clobber advice; a live editor skips this pick instead of parking the pool")
        self.assertIn("shouldHoldWork", spawn, "pins, chat asks, and collision jobs still run against a live editor")
        self.assertIn('"deferred"', spawn, "a blocked file is a skipped pick, not a busy park")
        self.assertIn("sessions:", spawn, "title/todo overlap with a live session is an adopt, not a rewrite")
        self.assertIn("uncommitted:", spawn, "dirty files warn the builder before a merge")
        self.assertIn("assistantHearBuilder", spawn, "a finished builder reports home so the overseer can respond")
        self.assertIn("entry.reap = finish", spawn, "supervise must be able to reap a job whose close() never fires")
        self.assertIn("killed after budget", spawn, "taskkill without close() must still unclaim the slot")
        self.assertIn("runFailures", spawn, "a failed inbox request retries instead of vanishing")
        self.assertIn("liveTaskIds", spawn, "in-memory live jobs must not be claimed twice")
        supervise = _function_body(self.main, "assistantSuperviseJobs")
        self.assertIn("job.reap", supervise, "wedged and ghost jobs are reaped, not only reported")
        self.assertIn("machine busy", supervise, "a dropped exclusive lease must not leave the executor parked")
        self.assertIn("function assistantHearBuilder", self.main)
        self.assertIn("hearReport", self.main)
        self.assertIn('"builder"', self.module, "executor runs report home as builder intel")
        self.assertIn("rolesForProblems", _function_body(self.main, "assistantControl"), "Fix dispatches the roles that own open problems")
        self.assertIn("task.status === \"open\"", _function_body(self.main, "queuedWorkCount"), "board tasks count as queued work")
        self.assertIn("refreshAutopilotQueue(eyes)", _function_body(self.main, "autopilotPass"))
        self.assertIn('"executor"', self.module, "the problem kind is part of the contract")
        # A finished job compacts behind itself, so the board reshapes every time.
        finish = _function_body(self.main, "spawnNextJob")
        self.assertIn('assistantEnqueueRole("compactor", ASSISTANT_PRIORITY.demand, { automatic: true })', finish)
        # A tripped breaker is a pause, not a power-off.
        self.assertIn("autopilot.parkedUntil && Date.now() >= autopilot.parkedUntil", self.main)
        self.assertIn("autopilot.execute = true", _function_body(self.main, "executeNextRequest"))

    def test_agents_can_hand_work_to_other_agents(self):
        # A finished run is allowed to pass work on: MEFI_NEXT queues a request
        # the next executor agent picks up, MEFI_CALL wakes a roster agent.
        # Without this every job was a dead end and the board only shrank.
        for marker in (
            'EXECUTOR_NEXT_MARK = "MEFI_NEXT:"',
            'EXECUTOR_CALL_MARK = "MEFI_CALL:"',
            "function parseExecutorHandoff",
            "async function runExecutorHandoffs",
            "runExecutorHandoffs(entry, job)",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        self.assertIn("EXECUTOR_MAX_DEPTH = 3", self.main, "a chain has to terminate")
        self.assertIn("EXECUTOR_MAX_HANDOFFS = 3", self.main, "one run cannot flood the queue")
        self.assertIn("entry.depth < EXECUTOR_MAX_DEPTH", self.main, "the depth guard gates both the prompt and the queueing")
        self.assertNotIn('"responder"', _function_body(self.main, "parseExecutorHandoff"), "a job never summons the responder")
        callable_roles = re.search(r"const EXECUTOR_CALLABLE = new Set\(\[(.*?)\]\);", self.main, re.S)
        self.assertIsNotNone(callable_roles)
        self.assertNotIn("responder", callable_roles.group(1), "the responder answers the user, not a job")
        # The chain survives the request -> task promotion, or the guard stops biting.
        promote = _function_body(self.main, "promoteRequestsToTasks")
        self.assertIn("Number(request.depth)", promote)
        self.assertIn('request.source === "collision"', promote, "collision ownership survives promotion onto the board")
        self.assertIn("request.files", promote, "promoted collision tasks keep the file list the spawn claim reads")
        self.assertIn("request.owner", promote, "promoted collision tasks keep the assigned owner")

    def test_build_roles_run_on_a_cadence_and_queue_work(self):
        # improver and grower had cadenceMs 0, so they had never run once: the
        # roster watched all day and proposed nothing. Each now has a cadence
        # and ends by queueing requests the executor can actually pick up.
        for marker in ("improver: assistantImproverJob", "grower: assistantGrowerJob", "ideas: assistantIdeasJob"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        self.assertIn("requestsFromExpand(briefing, await requestBaseline(eyes), role)", self.main, "a build pass queues its expand[] as requests")
        self.assertIn('ASSISTANT_AI_ROLES = new Set(["briefer", "improver", "grower"])', self.main)
        for role in ("improver", "grower", "ideas"):
            with self.subTest(role=role):
                self.assertIn(f'"{role}"', self.main)
        roles = _agent_roles_table()
        on_demand = [row for row in roles if row["cadenceMs"] == 0]
        self.assertEqual(["responder", "reference", "cluster-planner", "cluster-reviewer"], [row["role"] for row in on_demand], "cluster advisors run only for a claimed task")
        for role in ("improver", "grower", "ideas"):
            with self.subTest(role=role):
                cadence = next(row["cadenceMs"] for row in roles if row["role"] == role)
                self.assertGreater(cadence, 0, "a build role without a cadence never runs on its own")

    def test_thinker_reads_the_log_and_works_proactively(self):
        # The assistant box is where the agent thinks: a thinker role reads
        # the activity log, posts inner monologue (no unread), and kicks the
        # foreman when the board is idle with a real pick. Proactive off holds it.
        self.assertIn("thinker: assistantThinkerJob", self.main)
        self.assertIn("function assistantThink(", self.main)
        self.assertIn("function assistantCommitThought(", self.main)
        self.assertIn('assistantAskForWork(`thinker: ${title}`)', self.main)
        self.assertIn("assistantOrganize(now, store)", _function_body(self.main, "assistantThinkerJob"), "the assistant itself reshapes the node tree")
        self.assertIn("overseer: assistantState.overseer", _function_body(self.main, "assistantThinkerJob"), "the thinker hears what the overseer found")
        self.assertIn("assistantState.log", _function_body(self.main, "assistantMessageFacts"))
        self.assertIn("call.reasoning", _function_body(self.main, "assistantRespond"))
        roles = _agent_roles_table()
        thinker = next(row for row in roles if row["role"] == "thinker")
        self.assertGreater(thinker["cadenceMs"], 0)
        self.assertFalse(thinker["ai"], "the inner monologue is local; a missing key must not hold it")
        self.assertIn("role === \"thinker\" && !rules.proactive", self.module)
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["messages"] = ["read the log"]
        fixture["state"]["log"] = [
            {"kind": "tick", "text": "tick 40"},
            {"kind": "audit", "text": "audit: 1 error(s), 0 warning(s)"},
            {"kind": "error", "text": "AI offline: HTTP 429"},
        ]
        payload = _run_fixture(fixture)
        self.assertEqual(["log"], payload["intents"])
        reply = payload["replies"][0]["text"]
        self.assertIn("audit: 1 error", reply)
        self.assertIn("AI offline", reply)
        self.assertNotIn("tick 40", reply, "heartbeat ticks stay out of the quoted log")

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_assistant.py`", self.guide)

    # --- the module itself -----------------------------------------------------------------

    def test_module_is_pure_and_exports_the_contract(self):
        for name in ("DEFAULT_PREFS", "DEFAULT_POLICY", "CAPS", "AGENT_ROLES", "emptyState", "normalizeState", "organize", "tidy", "classifyIntent", "localReply", "nextBackoffMs", "summarizeForTree", "dueRoles", "rolesForProblems", "applyAgentEvent", "pendingWork", "applyWork", "resumeSummary", "emptyOverseer", "normalizeOverseer", "overseerDigest", "overseerReview", "overseerTune", "overseerMerge", "overseerTalk", "suggestWork", "thinkPlan", "applyThought", "hearReport", "INTEL_ROLES", "PARALLEL_MAX", "AI_PARALLEL_MAX", "RESCUE_LIMITS", "staleRescues", "MEMORY_CELLS", "inferMemoryCell", "admitMemory", "compileMemory", "collaborate", "claimWork", "claimedFiles", "shouldHoldWork"):
            with self.subTest(export=name):
                self.assertRegex(self.module, r"export (?:const|function) " + re.escape(name) + r"\b")
        for forbidden in ("node:sqlite", "electron", "fetch(", "writeFile", "readFileSync"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.module)
        self.assertIn("--fixture", self.module)
        self.assertIn("--self-test", self.module)
        self.assertNotIn("TODO", self.module)

    def test_module_syntax_and_self_test(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        check = subprocess.run([NODE, "--check", str(ASSISTANT)], cwd=STUDIO, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, check.returncode, check.stderr)
        result = subprocess.run([NODE, str(ASSISTANT), "--self-test"], cwd=STUDIO, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        verdict = json.loads(result.stdout)
        self.assertTrue(verdict["ok"], verdict)
        self.assertEqual([], verdict["failures"])

    # --- fixture: organize -----------------------------------------------------------------

    def test_fixture_organize(self):
        organization = self.payload()["organization"]
        self.assertEqual(["ses_active", "ses_progress"], organization["active"], "recent update or an in_progress todo makes a session active")
        self.assertEqual(["ses_stale"], organization["stale"], "only started work untouched for a day goes stale")
        self.assertEqual(["ses_empty", "ses_done"], organization["folded"], "finished or empty sessions fold after an hour, newest first")
        self.assertEqual(["ses_active", "ses_progress", "ses_working", "ses_stale"], organization["order"], "active, then working, then stale; folded never in order")
        self.assertNotIn("ses_child", json.dumps(organization), "child sessions are not classified")
        self.assertNotIn("ses_ancient", json.dumps(organization), "sessions older than 14 days are ignored")
        self.assertEqual({"sessions": 6, "active": 2, "stale": 1, "folded": 2, "hiddenTodos": 2}, organization["counts"])
        self.assertEqual({"foldAfterMinutes": 60, "staleAfterHours": 24, "maxSessions": 8, "maxTodosPerSession": 14}, organization["policy"])
        self.assertEqual(30 * 60, organization["staleQuietMin"], "the staliest stale session's quiet time rides the organization for the overseer digest")
        self.assertEqual(NOW, organization["updatedAt"])

    def test_fixture_organize_respects_policy_and_cap(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["prefs"] = {"foldAfterMinutes": 240, "staleAfterHours": 2}
        fixture["policy"] = {"maxSessions": 2}
        organization = _run_fixture(fixture)["organization"]
        self.assertEqual(["ses_done", "ses_working"], organization["folded"], "pending roadmap work folds at the stale horizon")
        self.assertEqual(["ses_progress", "ses_stale"], organization["stale"], "pending roadmap work does not become stale")
        self.assertEqual(["ses_active", "ses_empty"], organization["order"], "order is capped at maxSessions")
        self.assertEqual({"foldAfterMinutes": 240, "staleAfterHours": 2, "maxSessions": 2, "maxTodosPerSession": 14}, organization["policy"])

    # --- fixture: tidy -----------------------------------------------------------------------

    def test_fixture_tidy(self):
        tidy = self.payload()["tidy"]
        report = tidy["report"]
        self.assertTrue(tidy["changed"])
        self.assertEqual(1, report["tasksArchived"])
        by_id = {task["id"]: task for task in tidy["tasks"]}
        self.assertEqual("archived", by_id["task_old_done"]["status"])
        self.assertEqual("archived by the assistant", by_id["task_old_done"]["logs"][-1]["text"])
        self.assertEqual("status", by_id["task_old_done"]["logs"][-1]["kind"])
        self.assertEqual("done", by_id["task_fresh_done"]["status"], "done tasks younger than tidyDoneAfterHours stay")
        self.assertEqual("open", by_id["task_open"]["status"], "open tasks are never touched")
        self.assertEqual(NOW - 30 * HOUR, by_id["task_old_done"]["updatedAt"], "only status and logs change")
        self.assertEqual(0, report["ideasPruned"])
        self.assertEqual(["idea_accepted_old", "idea_done_fresh", "idea_new", "idea_keep"], [idea["id"] for idea in tidy["ideas"]])
        self.assertEqual(3, report["requestsCleared"])
        titles = [request["title"] for request in tidy["requests"]]
        self.assertEqual(["Audit: ipc", "Resolve collision: crafting.lua", "Owner note", "Old chat", "Fix: dup"], titles)
        self.assertEqual(NOW - 2 * HOUR, next(request["at"] for request in tidy["requests"] if request["title"] == "Fix: dup"), "duplicates keep the newest")
        self.assertEqual(12, report["checkpointsDropped"])
        self.assertNotIn("ses_gone_old", tidy["checkpoints"])
        self.assertIn("ses_gone_fresh", tidy["checkpoints"], "unknown sessions keep recent checkpoints")
        self.assertEqual(50, len(tidy["checkpoints"]["ses_working"]))
        self.assertEqual("note 0", tidy["checkpoints"]["ses_working"][0]["note"], "the newest notes survive the cap")
        self.assertEqual(1, len(tidy["checkpoints"]["ses_active"]))
        for piece in ("archived 1 done task", "cleared 3 requests", "dropped 12 checkpoints"):
            with self.subTest(piece=piece):
                self.assertIn(piece, report["text"])

    def test_fixture_tidy_second_pass_changes_nothing(self):
        first = self.payload()["tidy"]
        fixture = _fixture()
        fixture.update({"tasks": first["tasks"], "ideas": first["ideas"], "requests": first["requests"], "checkpoints": first["checkpoints"]})
        second = _run_fixture(fixture)["tidy"]
        self.assertFalse(second["changed"])
        self.assertEqual("nothing to tidy", second["report"]["text"])
        for key in ("tasks", "ideas", "requests", "checkpoints"):
            with self.subTest(collection=key):
                self.assertEqual(first[key], second[key])

    def test_fixture_tidy_leaves_unknown_collections_alone(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["tasks"] = None
        fixture["audit"] = None
        fixture["collisions"] = None
        fixture["sessions"] = None
        tidy = _run_fixture(fixture)["tidy"]
        self.assertEqual([], tidy["tasks"])
        self.assertEqual(0, tidy["report"]["tasksArchived"])
        titles = [request["title"] for request in tidy["requests"]]
        self.assertIn("Audit: dom", titles, "without an audit result audit requests are kept")
        self.assertIn("Resolve collision: old.lua", titles, "without a collision list collision requests are kept")
        self.assertIn("Old chat", titles, "operator work must never expire on a housekeeping clock")
        self.assertIn("ses_gone_old", tidy["checkpoints"], "without a session list no checkpoint key is dropped")
        self.assertEqual(50, len(tidy["checkpoints"]["ses_working"]), "the per-session cap still applies")

    # --- fixture: node context folders -----------------------------------------------------

    def test_fixture_node_folders_apply_and_ignore_junk(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        folders = _run_fixture(_folders_fixture())["nodeFolders"]
        active = folders["session:ses_active"]
        self.assertEqual(2, len(active["entries"]), "junk entries are dropped and an exact repeat replaces the newest line")
        self.assertEqual("run", active["entries"][0]["kind"])
        chat = active["entries"][1]
        self.assertEqual("chat", chat["kind"])
        self.assertEqual("responder", chat["role"])
        self.assertEqual(NOW - 30 * MINUTE, chat["at"], "the repeated report replaced the line and restamped it")
        self.assertEqual(NOW - 30 * MINUTE, active["updatedAt"])
        opened = folders["task:task:task_open"]
        self.assertEqual(["gathered 3 code hits · 1 sessions · 0 web"], [entry["text"] for entry in opened["entries"]], "the reference agent's find lands on the task folder")
        self.assertNotIn("weird", folders, "keys without a node kind are not folders")

    def test_fixture_node_folders_cap_entries(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["nodeContext"] = [
            {"target": {"kind": "session", "id": "ses_active"}, "kind": "note", "text": f"note {index}", "at": NOW - (20 - index) * MINUTE}
            for index in range(12)
        ]
        folder = _run_fixture(fixture)["nodeFolders"]["session:ses_active"]
        self.assertEqual(8, len(folder["entries"]), "a folder keeps its newest entries only")
        self.assertEqual("note 11", folder["entries"][-1]["text"])
        self.assertEqual("note 4", folder["entries"][0]["text"], "the oldest four fell off the front")

    def test_fixture_tidy_cleans_finished_node_folders(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        tidy = _run_fixture(_folders_fixture())["tidy"]
        report = tidy["report"]
        node_folders = tidy["nodeFolders"]
        self.assertNotIn("task:task:task_gone", node_folders, "a folder whose task left the board goes")
        self.assertNotIn("task:task:task_old_done", node_folders, "a folder on a task archived by this same pass goes with it")
        self.assertNotIn("session:ses_gone", node_folders, "a session folder quiet past the checkpoint horizon goes once the session is gone")
        self.assertIn("session:ses_gone_fresh", node_folders, "a folder on a fresh (even unknown) session stays")
        self.assertIn("session:ses_active", node_folders)
        self.assertIn("task:task:task_open", node_folders)
        self.assertEqual(3, report["foldersCleaned"])
        self.assertIn("cleaned 3 node folders", report["text"])
        self.assertTrue(tidy["changed"])

    def test_fixture_node_folder_lines_and_focus_folder(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        payload = _run_fixture(_folders_fixture())
        facts = payload["facts"]
        folder = facts["focusFolder"]
        self.assertEqual("session:ses_active", folder["key"])
        self.assertEqual(2, folder["count"])
        self.assertTrue(folder["lines"][0].startswith("chat · responder"), folder["lines"][0])
        self.assertIn("asked", folder["lines"][0])
        self.assertIn("run · executor", folder["lines"][1])

    def test_fixture_replies_quote_the_focused_folder(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _folders_fixture()
        fixture["messages"] = ["test test", "Add a night mode to the booklet"]
        replies = dict(zip(fixture["messages"], _run_fixture(fixture)["replies"]))
        chatter = replies["test test"]["text"]
        self.assertIn("Focused: session", chatter)
        self.assertIn("Folder: 2 notes", chatter, "the focused node's saved context rides the reply")
        self.assertIn("asked", chatter)
        self.assertIn("Memory:", chatter, "a focused chat reply carries the pushed memory primer")
        request = replies["Add a night mode to the booklet"]["text"]
        self.assertIn("Folder: 2 notes", request, "a queued ask quotes the folder too")
        self.assertIn("Memory:", request, "a queued ask compiles memory against the instruction")

    def test_fixture_node_folder_clear(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _folders_fixture()
        fixture["nodeContext"] = [{"target": {"kind": "session", "id": "ses_active"}, "clear": True}]
        folders = _run_fixture(fixture)["nodeFolders"]
        self.assertNotIn("session:ses_active", folders, "a cleared folder is gone")
        self.assertIn("session:ses_gone_fresh", folders, "a clear touches one folder only")

    def test_node_folders_are_wired(self):
        # The loop writes them (executor verdicts, reference gathers, chat
        # replies, the owner's notes), the keeper cleans them with everything
        # else, the facts carry the focused folder, and the card shows it.
        for marker in (
            'ipcMain.handle("assistant:node-context"',
            "function assistantNodeContext",
            "applyNodeContext",
            "clearNodeFolder",
            "nodeFolders: assistantState.nodeFolders",
            "foldersCleaned",
        ):
            with self.subTest(main=marker):
                self.assertIn(marker, self.main)
        self.assertIn("assistantNodeContext", self.preload)
        for marker in ("export const FOLDER_LIMITS", "export function nodeFolderLines", "export function applyNodeContext", "export function clearNodeFolder", "export function normalizeNodeFolders", "export function compileMemory", "export function admitMemory"):
            with self.subTest(module=marker):
                self.assertRegex(self.module, r"export (?:const|function) " + re.escape(marker.split()[-1]) + r"\b")
        for marker in ("appendNodeFolder", "Context folder (", "assistantNodeContext"):
            with self.subTest(idle=marker):
                self.assertIn(marker, self.idle)
        self.assertIn("node folder", self.architecture.lower())

    def test_push_memory_compiles_a_primer_and_supersedes(self):
        # Recall's loop, in-process: typed cells, one write gate, a compile
        # primer pushed into facts / chat / executor prompts. No SQLite, no
        # second model — the same folders the keeper already tidies.
        self.assertIn('export const MEMORY_CELLS = ["dec", "obs", "bel", "rsk", "ver"]', self.module)
        self.assertIn("compileMemory", self.module)
        self.assertIn("memory.dig", self.main, "the chat model is told when a fact was superseded")
        self.assertIn("facts.memory", self.main)
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn("compileMemory", spawn)
        self.assertIn("query", _function_body(self.main, "assistantMessageFacts"))

    # --- fixture: intents, replies, backoff, state ---------------------------------------

    def test_fixture_intents(self):
        self.assertEqual(EXPECTED_INTENTS, self.payload()["intents"])

    def test_fixture_local_replies_are_grounded(self):
        payload = self.payload()
        replies = dict(zip(_fixture()["messages"], payload["replies"]))
        status = replies["Status?"]["text"]
        for piece in ("6 sessions", "3 active", "Fix the crafting bench", "1 collision", "crafting.lua", "1 open task", "2 unread ideas", "Machine busy", "Audit: 1 error", "tick 41", "next in 2m", "AI offline (HTTP 401 unauthorized)"):
            with self.subTest(piece=piece):
                self.assertIn(piece, status)
        self.assertIn('Building now (1 building · machine managed): "Fix ipc handler"', status, "the status reply names the worker and machine scheduling mode")
        self.assertEqual([], replies["Status?"]["actions"])
        self.assertIn('"Crafting bench recipes"', replies["Any open tasks"]["text"])
        self.assertIn("2 done, 0 archived", replies["Any open tasks"]["text"])
        self.assertIn("Top pick:", replies["Any open tasks"]["text"], "the board answer ends with what to start")
        self.assertIn('"Glowing tide pools"', replies["ideas!"]["text"])
        self.assertIn("crafting.lua (2 sessions, owner ses_active)", replies["Collisions?"]["text"])
        self.assertIn("EXCLUSIVE lease held by perf", replies["is the machine busy"]["text"])
        self.assertEqual(["tidy"], replies["clean up please"]["actions"])
        self.assertIn("archived 1 done task", replies["clean up please"]["text"], "the last housekeeping line is quoted")
        self.assertEqual(["fix"], replies["Fix the problems"]["actions"])
        self.assertIn("renderer/idle.js failed the syntax check", replies["Fix the problems"]["text"])
        self.assertIn("Dispatching auditor", replies["Fix the problems"]["text"])
        self.assertEqual(["organize"], replies["organise the tree"]["actions"])
        self.assertEqual(["pause"], replies["pause"]["actions"])
        self.assertEqual([], replies["resume"]["actions"], "resume while running is a no-op")
        self.assertIn("already running", replies["resume"]["text"])
        for piece in ("status", "tasks", "ideas", "collisions", "machine", "tidy", "fix", "organize", "pause", "resume", "request inbox", "agents", "roster", "the log"):
            with self.subTest(help_piece=piece):
                self.assertIn(piece, replies["help"]["text"])
        request = replies["Add a night mode to the booklet"]
        self.assertEqual(["queue-request", "agents"], request["actions"], "a request queues the executor and sends the roster out")
        self.assertIn("put on the task board", request["text"])
        self.assertIn("kept in the thread", request["text"].lower())
        self.assertIn("roster", request["text"])
        work = replies["Work on the upgrade this app so that the agent task I made"]
        self.assertEqual(["queue-request", "agents"], work["actions"], "a work verb in front of a query keyword is an instruction")
        self.assertIn("put on the task board", work["text"])
        related = replies["Update the README for the crafting bench"]["text"]
        self.assertTrue("Crafting bench recipes" in related or "Fix the crafting bench" in related, related)
        chat = replies["how are you today"]
        self.assertEqual([], chat["actions"])
        self.assertIn("Hello", chat["text"], "small talk gets a greeting with status and a pick, not boilerplate")
        self.assertIn("Could work on", chat["text"])
        self.assertNotIn("request inbox", chat["text"].split("Say help")[0], "plain chat is not queued")
        hello = replies["hello"]
        self.assertEqual([], hello["actions"])
        self.assertIn("Hello", hello["text"])
        self.assertIn("sessions", hello["text"])
        self.assertIn("Say help", hello["text"])
        smalltalk = replies["tell me about the swamp torches"]
        self.assertEqual([], smalltalk["actions"], "a description queues nothing")
        self.assertIn('Session "Swamp biome rename"', smalltalk["text"], "tell-me-about describes the matching session")
        self.assertIn("Rename the swamp biome", smalltalk["text"], "the description names its live todo")
        suggest = replies["what should I work on"]
        self.assertEqual([], suggest["actions"], "a suggestion is advice, not an order — nothing is dispatched")
        self.assertIn("crafting.lua", suggest["text"], "the live collision outranks the board")
        self.assertIn("ses_active owns it", suggest["text"], "the pick names the collision owner")
        self.assertIn("Swamp biome rename", suggest["text"], "a quiet session mid-todo is a pick")
        self.assertIn("work on", suggest["text"])
        agents = replies["what are the agents doing"]
        self.assertEqual([], agents["actions"], "a roster question dispatches nothing")
        for piece in ("watcher", "briefer", "HTTP 429", "Building now (1 building · machine managed)"):
            with self.subTest(agents_piece=piece):
                self.assertIn(piece, agents["text"])
        overseer = replies["oversee the assistant"]
        self.assertEqual(["overseer"], overseer["actions"], "an oversee request triggers a review")
        self.assertIn("review #3", overseer["text"], "the fixture playbook already holds two reviews")
        self.assertIn("playbook", overseer["text"])
        chatter = replies["test test"]
        self.assertEqual([], chatter["actions"], "a bare verb chain is chatter — nothing queues until confirmed")
        self.assertIn('"test test"', chatter["text"], "the offer quotes the literal text so a yes can queue it")
        self.assertIn("say yes", chatter["text"].lower())
        for text, reply in replies.items():
            with self.subTest(message=text):
                self.assertTrue(0 < len(reply["text"]) <= 600, reply["text"])

    def test_fixture_local_replies_degrade_without_facts(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["facts"] = {"sessions": None, "collisions": None, "tasks": None, "ideas": None, "machine": None, "audit": None, "briefing": None, "update": None}
        fixture["state"] = {"status": "paused", "ai": {"keyPresent": False, "online": False, "lastError": None}}
        fixture["messages"] = ["status", "tasks", "machine", "add a torch", "resume"]
        replies = _run_fixture(fixture)["replies"]
        self.assertIn("Could not read the session store", replies[0]["text"])
        self.assertIn("Service paused", replies[0]["text"])
        self.assertNotIn("AI offline", replies[0]["text"], "no error text means no offline note")
        self.assertIn("Could not read the task board", replies[1]["text"])
        self.assertIn("Could not read the machine state", replies[2]["text"])
        self.assertIn("Nothing in the current sessions matches it yet", replies[3]["text"])
        self.assertEqual(["resume"], replies[4]["actions"])
        for reply in replies:
            self.assertNotRegex(reply["text"], r"\b\d+ sessions?\b", "no counts may be invented when the store is unreadable")

    def test_fixture_backoff_table(self):
        self.assertEqual([0, 5 * MINUTE, 10 * MINUTE, 20 * MINUTE, 40 * MINUTE, 60 * MINUTE], self.payload()["backoff"])

    def test_fixture_overseer(self):
        # The R&D layer above the assistant: the playbook normalizes on load,
        # the digest reads the assistant's own telemetry, the local review
        # grounds findings in it (keyless), a recurring finding becomes a
        # lesson, merges dedupe lessons by text, and pref tunes stay inside the
        # safe clamps.
        overseer = self.payload()["overseer"]
        normalized = overseer["normalized"]
        self.assertEqual(2, normalized["reviews"])
        self.assertEqual(72, normalized["score"])
        self.assertEqual("fair", normalized["health"])
        self.assertEqual(1, len(normalized["lessons"]), "junk lesson entries are dropped")
        self.assertEqual("AI link failing: 2 consecutive failure(s)", normalized["lessons"][0]["text"])
        self.assertEqual(1, len(normalized["directives"]))
        self.assertEqual(2, len(normalized["scores"]))
        digest = overseer["digest"]
        self.assertEqual(["briefer"], digest["errorRoles"], "the error row survives load and feeds the review")
        self.assertEqual(0, digest["replies"]["unanswered"])
        self.assertEqual([], digest["logErrors"], "a clean log holds no error records")
        self.assertEqual({"count": 1, "kinds": ["update-held"], "aged": 0}, digest["problems"])
        self.assertEqual(60, digest["housekeeping"]["ageMin"])
        self.assertEqual({"stale": 1, "active": 2, "folded": 2, "staleQuietMin": 30 * 60}, digest["sessions"], "the tree's stale section reaches the review")
        review = overseer["review"]
        self.assertEqual(60, review["score"], "warn 12 + info 4 + warn 12 + warn 12 off 100")
        self.assertEqual("fair", review["health"])
        self.assertEqual(["briefer failing", "1 open problem", "stale sessions waiting", "AI link failing"], [finding["title"] for finding in review["findings"]])
        self.assertEqual("warn", review["findings"][0]["severity"])
        stale_finding = review["findings"][2]
        self.assertEqual("warn", stale_finding["severity"])
        self.assertIn("30h ago", stale_finding["detail"], "the stale finding names how long the work has been quiet")
        persisting = [finding for finding in review["findings"] if finding["persisting"]]
        self.assertEqual(["AI link failing"], [finding["title"] for finding in persisting], "a finding seen last review is a confirmed pattern")
        self.assertEqual(["AI link failing: 2 consecutive failure(s)"], review["lessons"], "only persisting warns become lessons")
        self.assertEqual({}, review["prefs"], "two AI failures is under the tune threshold")
        self.assertEqual(["Fix the briefer role", "Resolve update held"], [upgrade["title"] for upgrade in review["upgrades"]])
        merged = overseer["merged"]
        self.assertEqual(3, merged["reviews"])
        self.assertEqual(60, merged["score"])
        self.assertEqual(3, len(merged["scores"]), "the score history rolls")
        self.assertEqual(1, len(merged["lessons"]), "a repeated lesson merges instead of duplicating")
        self.assertEqual(2, merged["lessons"][0]["hits"], "a confirmed pattern's hit count grows")
        tune = overseer["tune"]
        self.assertEqual([("staleAfterHours", 24, 72), ("parallel", 12, 2)], [(entry["key"], entry["from"], entry["to"]) for entry in tune["applied"]], "tunes apply inside the safe clamps")
        self.assertEqual(["nonsense", "tidyDoneAfterHours"], tune["rejected"], "unknown keys and non-numbers are rejected")
        self.assertEqual(72, tune["prefs"]["staleAfterHours"])
        self.assertEqual(2, tune["prefs"]["parallel"])

    def test_fixture_overseer_log_errors_carry_role_and_reset_on_a_clean_audit(self):
        # Error log rows reach the digest as records naming the role that
        # logged them (a missing role falls back to the host, never empty),
        # and the counter resets when the latest audit pass reported zero
        # errors and no problems are open.
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["state"]["log"] = [
            {"at": NOW - 5 * MINUTE, "kind": "error", "role": "watcher", "text": "watcher scan failed: boom"},
            {"at": NOW - MINUTE, "kind": "error", "text": "legacy row logged without a role"},
            {"at": NOW - 2 * MINUTE, "kind": "tick", "text": "tick 40"},
        ]
        digest = _run_fixture(fixture)["overseer"]["digest"]
        records = digest["logErrors"]
        self.assertEqual(2, len(records), "only error rows become records; ticks stay out")
        self.assertEqual(["watcher", "assistant"], [record["role"] for record in records], "a missing role falls back to the host")
        for record in records:
            self.assertTrue(record["role"], "every logErrors record carries a non-empty role")

        fixture["state"]["audit"] = {"ok": True, "errors": 0, "warnings": 0, "at": NOW - MINUTE}
        fixture["state"]["problems"] = []
        digest = _run_fixture(fixture)["overseer"]["digest"]
        self.assertEqual([], digest["logErrors"], "a clean audit with zero open problems resets the log-error counter")

        dirty = _fixture()
        dirty["state"]["log"] = [{"at": NOW - MINUTE, "kind": "error", "role": "auditor", "text": "audit failed"}]
        dirty["state"]["audit"] = {"ok": False, "errors": 1, "warnings": 0, "at": NOW - MINUTE}
        dirty["state"]["problems"] = []
        self.assertEqual(1, len(_run_fixture(dirty)["overseer"]["digest"]["logErrors"]), "a dirty audit keeps the records visible")
        anonymous = _fixture()
        anonymous["state"]["log"] = [{"at": NOW - MINUTE, "kind": "error", "text": "nobody"}]
        for record in _run_fixture(anonymous)["overseer"]["digest"]["logErrors"]:
            self.assertTrue(record["role"], "even junk input yields a named record")

    def test_fixture_overseer_rescues_stale_sessions(self):
        # The repair pass's plan: a session gone quiet mid-work past the stale
        # horizon becomes one resume request the executor can run — named, with
        # the in-progress todo and the pending list in the prompt — and a
        # session whose rescue is already filed (queue, history or board) is
        # left alone, so the 15 min cadence cannot pile up copies.
        rescues = self.payload()["rescues"]
        self.assertEqual(1, len(rescues), "only ses_stale is mid-work and quiet past the horizon")
        rescue = rescues[0]
        self.assertEqual("ses_stale", rescue["id"])
        self.assertEqual("Swamp biome rename", rescue["title"])
        self.assertEqual(30 * 60, rescue["quietMinutes"])
        self.assertEqual("Rename the swamp biome", rescue["todo"])
        self.assertEqual(0, rescue["pending"])
        self.assertEqual("Resume: Swamp biome rename", rescue["request"]["title"])
        self.assertIn('session "Swamp biome rename" went quiet 30h ago', rescue["request"]["prompt"])
        self.assertIn('"Rename the swamp biome" still in progress', rescue["request"]["prompt"])
        self.assertIn("finish that todo", rescue["request"]["prompt"])
        # already filed: the exact title (any capitalisation/punctuation) blocks a re-file
        fixture = _fixture()
        fixture["requests"].append({"title": "resume: swamp biome rename.", "prompt": "an earlier pass", "source": "overseer", "at": NOW - HOUR})
        self.assertEqual([], _run_fixture(fixture)["rescues"], "a rescue already in the inbox does not refire")
        # a task on the board with the rescue's title counts as filed too
        fixture = _fixture()
        fixture["tasks"].append({"id": "task_rescue", "title": "Resume: Swamp biome rename", "prompt": "x", "status": "open", "createdAt": NOW, "updatedAt": NOW})
        self.assertEqual([], _run_fixture(fixture)["rescues"], "a rescue already on the board does not refire")
        # the horizon comes from the policy: a longer stale horizon rescues nothing
        fixture = _fixture()
        fixture["prefs"] = {"staleAfterHours": 48}
        self.assertEqual([], _run_fixture(fixture)["rescues"], "a session under the horizon is not rescued")
        # a shorter horizon picks up the quiet-but-not-yet-stale session too
        fixture = _fixture()
        fixture["prefs"] = {"staleAfterHours": 2}
        titles = [rescue["request"]["title"] for rescue in _run_fixture(fixture)["rescues"]]
        self.assertIn("Resume: Swamp biome rename", titles)
        self.assertIn("Resume: Steam achievements audit", titles, "the horizon is the policy's, not a hardcoded day")

    def test_fixture_normalize_state_on_garbage(self):
        state = self.payload()["state"]
        self.assertEqual(1, state["version"])
        self.assertEqual("running", state["status"])
        self.assertEqual(41, state["tickCount"])
        self.assertEqual([], state["messages"], "a non-list becomes an empty thread")
        self.assertEqual([{"at": 0, "kind": "tick", "text": "tick 40"}], state["log"], "junk log entries are dropped, valid ones kept")
        self.assertNotIn("junk", state)
        self.assertEqual({"proactive": True, "keepAwake": True, "background": True, "backlogMode": False, "foldAfterMinutes": 60, "staleAfterHours": 24, "tidyDoneAfterHours": 24, "parallel": 12, "aiParallel": 1, "memoryAlign": True, "loopGuard": True, "loopGuardApply": True, "compactHistory": True}, state["prefs"], "parallel 99 clamps to 12, aiParallel 0 to 1")
        self.assertEqual("deepseek-v4.1-flash", state["ai"]["model"])
        self.assertEqual(2, state["ai"]["failures"])
        self.assertEqual("HTTP 401 unauthorized", state["ai"]["lastError"])
        self.assertEqual(1, state["housekeeping"]["tasksArchived"])
        self.assertEqual(0, state["housekeeping"]["ideasPruned"])
        self.assertEqual(["update-held"], [problem["kind"] for problem in state["problems"]])
        self.assertIsNone(state["focus"], "the fixture names no focus — a missing one normalizes to null")
        for key in ("organization", "action", "fixes", "unread", "lastError", "intervalMs"):
            with self.subTest(key=key):
                self.assertIn(key, state)
        summary = self.payload()["summary"]
        self.assertEqual("Assistant", summary["label"])
        self.assertEqual("offline", summary["tone"], "key present but the last brief failed")
        self.assertTrue(summary["sublabel"].startswith("AI offline · "), summary)
        self.assertNotRegex(summary["sublabel"], r"\d{4}-\d{2}", "relative text only, never a date")

    def test_fixture_focus_grounds_replies(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        # Clear the louder signals so the idle line reaches the focus.
        fixture["state"]["problems"] = []
        fixture["state"]["ai"] = {"keyPresent": True, "online": True, "lastError": None}
        fixture["state"]["agents"] = []
        fixture["state"]["focus"] = {"kind": "session", "id": "ses_stale", "label": "Swamp biome rename", "at": NOW - 5 * MINUTE}
        payload = _run_fixture(fixture)
        self.assertEqual({"kind": "session", "id": "ses_stale", "label": "Swamp biome rename", "at": NOW - 5 * MINUTE}, payload["state"]["focus"])
        self.assertEqual("focused on Swamp biome rename", payload["summary"]["sublabel"], "an idle assistant wears its focus")
        # An instruction whose words hit no session/task title names the focus
        # instead of "nothing matches".
        fixture["messages"] = ["Add a weather system to the overworld", "how are you today"]
        replies = dict(zip(fixture["messages"], _run_fixture(fixture)["replies"]))
        work = replies["Add a weather system to the overworld"]
        self.assertIn("put on the task board", work["text"])
        self.assertIn('Focused: session "Swamp biome rename"', work["text"], "a request names the focused node when nothing else matches")
        chat = replies["how are you today"]
        self.assertIn('Focused: session "Swamp biome rename"', chat["text"], "plain chat is grounded on the click too")
        # A focus the facts can still see wins over the generic fallback; a junk
        # focus normalizes away and the fallback returns.
        fixture["state"]["focus"] = "junk"
        again = _run_fixture(fixture)
        self.assertIsNone(again["state"]["focus"])
        self.assertEqual("running · next in 2m", again["summary"]["sublabel"])

    # --- fixture: agent pool ----------------------------------------------------------------

    def test_fixture_roster_is_normalized_on_load(self):
        state = self.payload()["state"]
        self.assertEqual(AGENT_ROLES, [row["role"] for row in state["agents"]], "one row per role, roster order, unknown roles dropped, missing roles added")
        by_role = {row["role"]: row for row in state["agents"]}
        self.assertEqual("idle", by_role["watcher"]["status"], "a running row restored from disk becomes idle")
        self.assertEqual("idle", by_role["auditor"]["status"], "a queued row restored from disk becomes idle too")
        self.assertEqual(3, by_role["watcher"]["runs"], "history survives the reset")
        self.assertEqual(NOW - 10_000, by_role["watcher"]["lastRunAt"])
        self.assertEqual("done", by_role["machine"]["status"])
        self.assertEqual(400, by_role["machine"]["lastMs"])
        self.assertEqual("error", by_role["briefer"]["status"])
        self.assertEqual("HTTP 429", by_role["briefer"]["error"])
        self.assertEqual({"role": "keeper", "status": "idle", "since": 0, "lastRunAt": 0, "lastMs": 0, "runs": 0, "text": "", "error": None, "target": None, "targets": [], "progress": None}, by_role["keeper"])
        self.assertEqual((None, [], None), (by_role["watcher"]["target"], by_role["watcher"]["targets"], by_role["watcher"]["progress"]), "a reset row loses its place")
        self.assertEqual((None, [{"kind": "root", "id": "__root__"}], 1), (by_role["machine"]["target"], by_role["machine"]["targets"], by_role["machine"]["progress"]), "a done row keeps where it worked")
        self.assertEqual({"parallel": 12, "aiParallel": 1, "running": 0, "queued": 0}, state["pool"], "pool mirrors the clamped prefs; nothing runs in a freshly loaded state")

    def test_fixture_due_roles(self):
        payload = self.payload()
        self.assertEqual(
            ["machine", "auditor", "keeper", "compactor", "foreman", "thinker", "overseer", "improver", "ideas", "grower"],
            payload["dueRoles"],
            "watcher ran 10 s ago (not due on its 2 min cadence), machine 119 s ago (due at 90% of 2 min), auditor an hour ago;"
            " keeper, thinker, overseer and the three build roles never ran; briefer briefed 4 min ago",
        )
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["state"]["ai"] = {"keyPresent": True, "online": True, "lastError": None, "backoffUntil": 0}
        fixture["state"]["agents"] = [{"role": "briefer", "status": "done", "lastRunAt": NOW - 4 * MINUTE}]
        self.assertNotIn("briefer", _run_fixture(fixture)["dueRoles"], "4 min since the last brief is under the 5 min cadence")
        fixture["state"]["agents"] = [{"role": "briefer", "status": "done", "lastRunAt": NOW - 6 * MINUTE}]
        self.assertIn("briefer", _run_fixture(fixture)["dueRoles"])
        fixture["state"]["ai"]["backoffUntil"] = NOW + MINUTE
        self.assertNotIn("briefer", _run_fixture(fixture)["dueRoles"], "a backoff holds the briefer")
        fixture["state"]["ai"]["backoffUntil"] = 0
        fixture["prefs"] = {"proactive": False}
        held = _run_fixture(fixture)["dueRoles"]
        self.assertNotIn("briefer", held, "proactive off holds the briefer")
        self.assertNotIn("thinker", held, "proactive off holds the thinker")
        self.assertIn("overseer", held, "the overseer runs 24/7 — proactive off never holds it")
        fixture["prefs"] = {"proactive": True}
        fixture["state"]["agents"] = []
        # Live statuses only exist through events: a loaded state never carries running/queued rows.
        fixture["agentEvents"] = [{"role": "briefer", "status": "running", "at": NOW - HOUR}, {"role": "keeper", "status": "queued", "at": NOW - MINUTE}]
        due = _run_fixture(fixture)["dueRolesAfter"]
        self.assertNotIn("briefer", due, "a running role is never enqueued twice, however old its start")
        self.assertNotIn("keeper", due, "a queued role is never enqueued twice")
        self.assertEqual(["watcher", "machine", "auditor", "compactor", "foreman", "thinker", "overseer", "improver", "ideas", "grower"], due)
        for role in ("responder", "reference"):
            with self.subTest(role=role):
                self.assertNotIn(role, due, "only the responder and the reference gatherer are on demand")
        fixture = _fixture()
        fixture["state"]["agents"] = [{"role": "watcher", "status": "done", "lastRunAt": NOW - 10_000}]
        fixture["state"]["problems"] = [{"kind": "collision", "text": "crafting.lua", "since": NOW}]
        pulled = _run_fixture(fixture)["dueRoles"]
        self.assertEqual("watcher", pulled[0], "an open collision pulls the watcher due even though it ran 10 s ago")
        fixture["state"]["problems"] = [{"kind": "collision", "text": "crafting.lua", "since": NOW - HOUR}]
        self.assertNotIn("watcher", _run_fixture(fixture)["dueRoles"], "a problem the watcher already ran against does not jump the cadence")

    def test_fixture_agent_events(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _fixture()
        fixture["agentEvents"] = AGENT_EVENTS
        payload = _run_fixture(fixture)
        state = payload["state"]
        by_role = {row["role"]: row for row in state["agents"]}
        self.assertEqual({"parallel": 12, "aiParallel": 1, "running": 2, "queued": 1}, state["pool"], "auditor + keeper running, responder queued")
        self.assertEqual("done", by_role["watcher"]["status"])
        self.assertEqual(4, by_role["watcher"]["runs"])
        self.assertEqual(1400, by_role["watcher"]["lastMs"], "done without ms measures from the running event")
        self.assertEqual(NOW + 1000, by_role["watcher"]["lastRunAt"], "lastRunAt is the last start")
        self.assertEqual("6 sessions · 2 folded", by_role["watcher"]["text"])
        self.assertEqual((None, [{"kind": "session", "id": "ses_active"}, {"kind": "session", "id": "ses_stale"}], 1), (by_role["watcher"]["target"], by_role["watcher"]["targets"], by_role["watcher"]["progress"]), "done: target cleared, visited list kept, progress complete")
        self.assertEqual({"kind": "assistant", "id": "__assistant__"}, by_role["auditor"]["target"])
        self.assertIsNone(by_role["auditor"]["progress"])
        self.assertEqual((None, [], None), (by_role["keeper"]["target"], by_role["keeper"]["targets"], by_role["keeper"]["progress"]), "a running event without a place keeps the row's (empty) place")
        self.assertEqual("running", by_role["auditor"]["status"])
        self.assertEqual("auditing the wiring", by_role["auditor"]["text"])
        self.assertEqual(NOW + 2000, by_role["auditor"]["since"])
        self.assertEqual("error", by_role["briefer"]["status"])
        self.assertEqual("HTTP 429", by_role["briefer"]["error"])
        self.assertEqual(900, by_role["briefer"]["lastMs"])
        self.assertEqual(3, by_role["briefer"]["runs"])
        self.assertEqual("queued", by_role["responder"]["status"])
        self.assertEqual("done", by_role["machine"]["status"], "an unknown status leaves the row alone")
        self.assertNotIn("ghost", by_role, "an unknown role is ignored")
        self.assertEqual({"kind": "audit", "text": "auditing · tidying", "since": NOW + 2000}, state["action"], "action = running roles in roster order, since = earliest start")
        self.assertEqual({"label": "Assistant", "sublabel": "2 agents working", "tone": "busy", "pulse": True}, payload["summary"])
        self.assertEqual(
            ["machine", "compactor", "foreman", "thinker", "overseer", "improver", "ideas", "grower"],
            payload["dueRolesAfter"],
            "live roles are not re-enqueued; the watcher just started; the build roles have never run",
        )
        fixture["agentEvents"] = AGENT_EVENTS + [
            {"role": "keeper", "status": "running", "at": NOW + 4500, "target": {"kind": "task", "id": "task_open"}, "progress": 0.25},
            {"role": "keeper", "status": "done", "at": NOW + 5000, "text": "nothing to tidy"},
            {"role": "auditor", "status": "error", "at": NOW + 5000, "error": "boom"},
            {"role": "auditor", "status": "running", "at": NOW + 5500, "target": {"kind": "session", "id": "ses_stale"}, "targets": [{"kind": "session", "id": "ses_stale"}], "progress": 0.1},
        ]
        payload = _run_fixture(fixture)
        by_role = {row["role"]: row for row in payload["state"]["agents"]}
        self.assertEqual((None, [], 1), (by_role["keeper"]["target"], by_role["keeper"]["targets"], by_role["keeper"]["progress"]), "a hop's target is cleared on done; no visited list was ever given")
        self.assertEqual({"kind": "session", "id": "ses_stale"}, by_role["auditor"]["target"], "event fields win")
        self.assertEqual(0.1, by_role["auditor"]["progress"])
        self.assertEqual(1, payload["state"]["pool"]["running"])
        self.assertEqual("auditing", payload["state"]["action"]["text"])
        self.assertEqual("auditing…", payload["summary"]["sublabel"], "one running agent keeps the existing wording")
        fixture["agentEvents"] = fixture["agentEvents"] + [{"role": "auditor", "status": "done", "at": NOW + 6000}, {"role": "responder", "status": "idle", "at": NOW + 6000}]
        payload = _run_fixture(fixture)
        self.assertEqual({"parallel": 12, "aiParallel": 1, "running": 0, "queued": 0}, payload["state"]["pool"])
        self.assertEqual("idle", payload["state"]["action"]["kind"])
        self.assertTrue(payload["summary"]["sublabel"].startswith("AI offline · "), "with nothing running the summary falls back to the AI state")

    # --- fixture: work journal + resume on boot ----------------------------------------------

    def test_fixture_pending_work_on_raw_state(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        payload = _run_fixture(_journal_fixture())
        pending = payload["pendingWork"]
        self.assertEqual((2 * 60 + 13) * MINUTE, pending["closedForMs"], "closed for = now - the saved heartbeat")
        self.assertEqual(["job_improve", "job_ref"], [job["id"] for job in pending["jobs"]], "junk entries are dropped")
        self.assertTrue(all(job["reason"] == "interrupted" for job in pending["jobs"]))
        ref = pending["jobs"][1]
        self.assertEqual({"id": "job_ref", "kind": "reference", "role": "reference", "payload": {"text": "crafting bench"}, "taskId": "task_open", "sessionId": None, "text": "gather for task Crafting bench recipes", "startedAt": NOW - 3 * HOUR, "attempts": 1, "status": "queued", "target": None, "targets": [], "progress": None, "reason": "interrupted"}, ref, "role from the kind, attempts default 1, payload kept, junk place dropped")
        improve = pending["jobs"][0]
        self.assertEqual("improver", improve["role"])
        self.assertEqual({"kind": "session", "id": "ses_active"}, improve["target"], "a resumed job restores where its agent was")
        self.assertEqual([{"kind": "session", "id": "ses_active"}, {"kind": "assistant", "id": "__assistant__"}], improve["targets"], "junk targets dropped")
        self.assertEqual(0.5, improve["progress"])
        self.assertEqual({"kind": "session", "id": "ses_active"}, payload["state"]["work"][0]["target"], "normalizeState keeps the place")
        self.assertEqual([{"id": "m3", "at": NOW - 3 * HOUR, "text": "please check the swamp torches"}], pending["unanswered"], "only user messages after the last assistant reply")
        self.assertEqual(["auditor"], pending["interruptedRoles"], "read from the RAW rows, before normalizeState turns them idle")
        state = payload["state"]
        self.assertEqual("idle", next(row for row in state["agents"] if row["role"] == "auditor")["status"], "normalizeState still resets the row")
        self.assertEqual(["job_improve", "job_ref"], [job["id"] for job in state["work"]], "normalizeState keeps the journal")
        self.assertEqual(NOW - DAY, state["closedAt"])
        self.assertEqual({"at": NOW - DAY, "jobs": ["improve"], "closedForMs": 5 * MINUTE}, state["resumed"])
        empty = _run_fixture({"now": NOW, "state": {"heartbeatAt": NOW - 45_000}})
        self.assertEqual({"closedForMs": 45_000, "jobs": [], "unanswered": [], "interruptedRoles": []}, empty["pendingWork"])

    def test_fixture_resume_summary_wording(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        payload = _run_fixture(_journal_fixture())
        self.assertEqual(
            'closed for 2 h 13 m · restarting 4 jobs: reply to "please check the swamp torches", auditor, improve "improve the explorer column", reference "gather for task Crafting bench recipes"',
            payload["resumeSummary"],
        )
        self.assertEqual("closed for 45 s · nothing to restart", _run_fixture({"now": NOW, "state": {"heartbeatAt": NOW - 45_000}})["resumeSummary"])
        self.assertEqual("no previous heartbeat · nothing to restart", _run_fixture({"now": NOW, "state": {}})["resumeSummary"])
        fixture = _journal_fixture()
        fixture["state"]["heartbeatAt"] = NOW - 3 * DAY - 4 * HOUR
        fixture["state"]["work"] = [{"id": "a", "kind": "audit", "role": "auditor"}]
        fixture["state"]["messages"] = []
        self.assertEqual("closed for 3 d 4 h · restarting 1 job: audit", _run_fixture(fixture)["resumeSummary"], "a role covered by a journal entry is not listed twice")

    def test_fixture_apply_work(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _journal_fixture()
        fixture["workEvents"] = [
            {"id": "job_improve", "done": True},
            {"id": "job_ref", "kind": "reference", "text": "gather for task Crafting bench recipes", "attempts": 2, "status": "running", "startedAt": NOW - 3 * HOUR},
            {"id": "job_new", "kind": "responder", "text": "please check the swamp torches"},
            {"id": "job_bad"},
            {"done": True},
        ]
        work = _run_fixture(fixture)["state"]["work"]
        self.assertEqual(["job_ref", "job_new"], [entry["id"] for entry in work], "done removes, same id updates in place, new appends, junk ignored")
        self.assertEqual(2, work[0]["attempts"])
        self.assertEqual("running", work[0]["status"])
        self.assertEqual("responder", work[1]["role"])
        self.assertEqual(NOW, work[1]["startedAt"], "a missing startedAt defaults to now")
        fixture["workEvents"] = [{"id": f"job_{index}", "kind": "brief", "startedAt": NOW - index} for index in range(45)]
        work = _run_fixture(fixture)["state"]["work"]
        self.assertEqual(40, len(work), "the journal is capped at 40")
        self.assertEqual("job_5", work[0]["id"], "47 entries: the two loaded ones and job_0..job_4 fall off the head, the newest tail stays")
        self.assertEqual("job_44", work[-1]["id"])

    def test_fixture_resume_work_intent_and_replies(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _journal_fixture()
        payload = _run_fixture(fixture)
        self.assertEqual(["status", "resume-work", "resume-work", "resume-work", "status", "resume-work", "resume"], payload["intents"])
        replies = dict(zip(fixture["messages"], payload["replies"]))
        status = replies["status"]["text"]
        self.assertIn('Working on 2 jobs: improve "improve the explorer column", reference "gather for task Crafting bench recipes"', status)
        self.assertIn("Working on 2 jobs", replies["what are you working on?"]["text"])
        resume = replies["restart the interrupted work"]
        self.assertEqual(["resume-work"], resume["actions"])
        # The reply reads the live (normalised) state: a running roster row is live there, not
        # interrupted, so only the journal entries and the unanswered message are re-queued.
        self.assertIn("Re-queuing 3 jobs now", resume["text"])
        for piece in ('reply to "please check the swamp torches"', 'improve "improve the explorer column"', 'reference "gather for task Crafting bench recipes"'):
            with self.subTest(piece=piece):
                self.assertIn(piece, resume["text"])
        self.assertNotIn("auditor", resume["text"])
        self.assertNotIn("restart the interrupted work", resume["text"], "the message being answered is not an unanswered message")
        self.assertIn("Last boot restarted 1 job after being closed for 5 m", resume["text"])
        self.assertEqual([], replies["resume"]["actions"], "a bare resume is still the service control")
        quiet = _journal_fixture()
        quiet["state"]["work"] = []
        quiet["state"]["messages"] = []
        quiet["state"]["agents"] = []
        quiet["state"]["resumed"] = None
        quiet["messages"] = ["resume the work"]
        reply = _run_fixture(quiet)["replies"][0]
        self.assertEqual(["resume-work"], reply["actions"])
        self.assertIn("Nothing is interrupted right now", reply["text"])
        self.assertNotIn("Last boot", reply["text"])

    def test_fixture_resume_work_ignores_its_own_responder_job(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _journal_fixture()
        fixture["state"]["agents"] = []
        fixture["state"]["resumed"] = None
        fixture["state"]["messages"] = [{"id": "m9", "at": NOW - 1000, "role": "user", "text": "resume the work", "intent": "resume-work"}]
        fixture["state"]["work"] = [{"id": "job_reply_m9", "kind": "responder", "payload": {"messageId": "m9"}, "text": "resume the work", "startedAt": NOW - 1000}]
        fixture["messages"] = ["resume the work"]
        reply = _run_fixture(fixture)["replies"][0]
        self.assertEqual(["resume-work"], reply["actions"])
        self.assertIn("Nothing is interrupted right now", reply["text"], "the message's own in-flight responder job is not interrupted work")
        self.assertNotIn("Re-queuing", reply["text"])
        fixture["state"]["work"] = [{"id": "job_reply_m9", "kind": "responder", "payload": {}, "text": "resume the work", "startedAt": NOW - 1000}]
        self.assertIn("Nothing is interrupted right now", _run_fixture(fixture)["replies"][0]["text"], "the job_reply_<id> form is enough without a payload")
        fixture["state"]["work"] = [
            {"id": "job_reply_m9", "kind": "responder", "payload": {"messageId": "m9"}, "text": "resume the work", "startedAt": NOW - 1000},
            {"id": "job_reply_m1", "kind": "responder", "payload": {"messageId": "m1"}, "text": "older question", "startedAt": NOW - HOUR},
        ]
        text = _run_fixture(fixture)["replies"][0]["text"]
        self.assertIn("Re-queuing 1 job now", text)
        self.assertIn('reply to "older question"', text)
        self.assertNotIn('reply to "resume the work"', text)
        boot = _run_fixture(fixture)["pendingWork"]
        self.assertEqual(["job_reply_m9", "job_reply_m1"], [job["id"] for job in boot["jobs"]], "at boot (no exclusion) both responder jobs are interrupted")

    def test_fixture_facts_carry_the_journal(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        fixture = _journal_fixture()
        fixture["messages"] = []
        script = """
import { buildFacts } from "file:///PROJECT/scripts/assistant.mjs";
const fixture = JSON.parse(process.argv[2]); // argv[1] is the "-" stdin script
console.log(JSON.stringify(buildFacts({ work: fixture.state.work, resumed: fixture.state.resumed, now: fixture.now })));
""".replace("PROJECT", STUDIO.as_posix())
        result = subprocess.run([NODE, "--input-type=module", "-", json.dumps(fixture)], input=script, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, result.returncode, result.stderr)
        facts = json.loads(result.stdout)
        self.assertEqual(["job_improve", "job_ref"], [entry["id"] for entry in facts["work"]])
        self.assertEqual(180, facts["work"][0]["startedMinutesAgo"])
        self.assertNotIn("payload", facts["work"][0], "payloads stay out of the AI facts")
        self.assertEqual({"at": NOW - DAY, "jobs": ["improve"], "closedForMs": 5 * MINUTE}, facts["resumed"])

    def test_agent_intel_reports_home_to_the_assistant(self):
        """Every role job ends by handing its finding to the one main agent."""
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        script = """
import { emptyState, applyIntel, intelLines, normalizeState, localReply } from "file:///PROJECT/scripts/assistant.mjs";
const NOW = 1_800_000_000_000, MINUTE = 60_000;
let state = emptyState(NOW);
state = applyIntel(state, { role: "watcher", at: NOW - 2 * MINUTE, text: "5 sessions · 1 collision", facts: { sessions: 5, collisions: 1 } });
state = applyIntel(state, { role: "auditor", at: NOW - 1 * MINUTE, text: "2 error(s)", facts: { errors: 2 } });
// latest wins per role, newest first
state = applyIntel(state, { role: "watcher", at: NOW - 30_000, text: "6 sessions", facts: { sessions: 6 } });
console.log(JSON.stringify({
  roles: state.intel.map((row) => row.role),
  watcherText: state.intel.find((row) => row.role === "watcher").text,
  lines: intelLines(state, NOW),
  roundTrips: normalizeState(JSON.parse(JSON.stringify(state)), NOW).intel.length,
}));
// garbage stays out: unknown roles and empty findings
const guarded = applyIntel(state, { role: "nobody", text: "x" });
const silent = applyIntel(state, { role: "keeper", text: "  " });
console.log(JSON.stringify({ guarded: guarded.intel.length, silent: silent.intel.length }));
// a stale row drops out of the digest the planner reads
const stale = applyIntel(state, { role: "grower", at: NOW - 2 * 60 * MINUTE, text: "old scan" });
console.log(JSON.stringify({ freshOnly: intelLines(stale, NOW).some((line) => line.startsWith("grower")) }));
""".replace("PROJECT", STUDIO.as_posix())
        result = subprocess.run([NODE, "--input-type=module", "-"], input=script, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, result.returncode, result.stderr)
        first, guarded, stale = (json.loads(line) for line in result.stdout.splitlines())
        self.assertEqual(["watcher", "auditor"], first["roles"], "newest report first")
        self.assertEqual("6 sessions", first["watcherText"], "the latest report wins for a role")
        self.assertEqual(["watcher · 6 sessions (just now)", "auditor · 2 error(s) (1m ago)"], first["lines"])
        self.assertEqual(2, first["roundTrips"], "intel survives a save/load round trip")
        self.assertEqual((2, 2), (guarded["guarded"], guarded["silent"]))
        self.assertFalse(stale["freshOnly"], "a two-hour-old scan is not part of the digest")
        # the wiring: settle reports intel, the foreman plans from it, the
        # renderer draws the packet home and keeps the Reported list
        self.assertIn("assistantReportIntel", self.main)
        self.assertIn("kind: \"intel\"", self.main)
        self.assertIn('kind === "intel"', self.idle)
        self.assertIn("assistant-intel", self.idle)
        self.assertIn("assistant-intel", Path(STUDIO / "renderer" / "styles.css").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
