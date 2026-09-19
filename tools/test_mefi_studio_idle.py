"""Dream mode contracts for Mefi's Studio AI+ (standalone repository).

Static contracts for the idle view: the five-minute quiet clock, the audio
profiles, the task-vs-external activity split (pulses vs blue-white
particles), per-path touch brightness with collision boosts, the tree
snapshot API it renders from, and the wiring (bundle, template, autoplay).
No network, no key, no Electron.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
IDLE = STUDIO / "renderer" / "idle.js"


class MefiStudioIdleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.idle = IDLE.read_text(encoding="utf-8")
        cls.tree = (STUDIO / "renderer" / "tree3d.js").read_text(encoding="utf-8")
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.build = (STUDIO / "scripts" / "build-booklet.mjs").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_quiet_clock_is_five_minutes(self):
        self.assertIn("const IDLE_MS = 5 * 60 * 1000;", self.idle)
        self.assertIn("armIdleTimer", self.idle)
        self.assertIn("state.lastInput = Date.now();", self.idle)

    def test_audio_profiles_and_tempo_mapping(self):
        for profile in ("zen", "temple", "crystal", "club"):
            with self.subTest(profile=profile):
                self.assertIn(profile + ":", self.idle)
        self.assertIn("TASK_TOOLS", self.idle)
        for marker in ("bell({ long:", "bell({ quick:", "spawnParticles("):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)

    def test_work_paths_glow_and_external_work_vaporizes(self):
        for marker in (
            "state.pulses.push(",
            "blue: Math.random() > 0.45",
            "collisionSessions",
            "liveColliding",
            "touches.set(",
            "Math.min(1, (touch?.count ?? 0) / 4)",
            "state.touches.get(node.sessionId)",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)

    def test_wiring_snapshot_bundle_template_autoplay(self):
        self.assertIn("snapshot: () => ({", self.tree)
        self.assertIn('readFile(path.join(RENDERER, "idle.js")', self.build)
        for element_id in ("idle-layer", "idle-hud", "idle-profile", "idle-zen", "idle-reactive", "idle-exit", "idle-open"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        self.assertIn('idle-open', self.template)
        self.assertIn('autoplayPolicy: "no-user-gesture-required"', self.main)
        self.assertIn("window.MefiIdle = {", self.idle)
        self.assertIn("selectFirst", self.idle)
        self.assertIn("debugNodes", self.idle)

    def test_command_view_is_interactive(self):
        for element_id in ("idle-task-input", "idle-task-add", "idle-info", "idle-telemetry", "idle-home"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        for marker in (
            "appendTaskNodes",
            "bubbleAt(",
            "nodeAt(",
            "state.panning",
            "state.zoom",
            "MefiTasks?.addTask",
            "commandHome",
            "renderInfo",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)
        self.assertIn("prefsSet?.({ commandHome: el.home.checked })", self.idle)

    def test_command_hub_wiring(self):
        for element_id in ("cmd-dock", "cmd-hint", "cmd-legend", "cmd-empty", "cmd-tip",
                           "idle-search", "idle-fit", "idle-orbit", "idle-labels",
                           "idle-ambience-pop", "nav-command", "nav-tools", "help-grid", "footer-keys"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        self.assertIn('readFile(path.join(RENDERER, "nav.js")', self.build)
        self.assertIn("window.MefiNav = {", (STUDIO / "renderer" / "nav.js").read_text(encoding="utf-8"))
        for marker in ("drawLabels(", "handleKey", "clearSearch", "anchorSessionId"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)
        self.assertIn("togglePin", self.tree)

    def test_reactive_glow_listens_to_desktop_audio(self):
        # Reactive glow defaults to system loopback ("desktop"); the
        # microphone is an opt-in select, and the main process answers
        # getDisplayMedia with a screen source + "loopback" so no picker opens.
        for marker in (
            'readStore("mefiStudio.zenSource") === "mic" ? "mic" : "desktop"',
            "getDisplayMedia?.({ video: true, audio: true })",
            "getUserMedia?.({ audio: true })",
            "useReactiveInput",
            "releaseReactiveInput",
            "setAudioSource",
            "state.bands.bass",
            "state.bands.mid",
            "state.bands.treble",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)
        self.assertIn("setDisplayMediaRequestHandler", self.main)
        self.assertIn('"loopback"', self.main)
        self.assertIn("desktopCapturer", self.main)
        self.assertIn('id="idle-source"', self.template)
        self.assertIn('value="mic"', self.template)

    def test_chat_log_panel_does_not_fail_work_on_it(self):
        # The right-side #cmd-chat panel is the always-on thread. A live-update
        # race used to reload a torn idle.js that called renderChatLog before
        # the function existed; Work on it then toasted "renderChatLog is not
        # defined" even though the executor had already queued the job.
        for element_id in ("cmd-chat", "cmd-chat-thread", "cmd-chat-input", "cmd-chat-send", "cmd-chat-toggle", "cmd-chat-state"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        self.assertIn("function renderChatLog()", self.idle)
        self.assertIn("function paintChatLog()", self.idle)
        work = self.idle[self.idle.index("async function workOnNode") : self.idle.index("async function assistantControl")]
        self.assertIn("paintChatLog()", work)
        self.assertNotIn("renderChatLog();", work, "Work on it must not let a missing chat log fail the dispatch")
        self.assertIn("it is next", work)
        self.assertLess(work.find("it is next"), work.find("paintChatLog()"), "the success toast fires even if the log painter throws")

    def test_chat_log_is_opaque_and_shows_running_count(self):
        # The thread used to be glass over the constellation, so graph labels
        # printed through every bubble. The collapsed header also hid the
        # running count behind "+", so you could not see how many agents were
        # in flight without expanding the log.
        styles = (STUDIO / "renderer" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("background: var(--panel-solid);", styles)
        self.assertIn(".assistant-msg.user {", styles)
        self.assertIn("background: #231e16;", styles)
        self.assertIn("background: #14151a;", styles)
        self.assertIn(".cmd-chat.collapsed .chat-log-body { display: none; }", styles)
        self.assertNotIn(".cmd-chat.collapsed .feed-state { display: none; }", styles)
        self.assertIn(".cmd-chat.collapsed .feed-state {", styles)
        chat = self.idle[self.idle.index("function renderChatLog()") : self.idle.index("function paintChatLog()")]
        self.assertIn("autopilotJobs(state.assistant)", chat)
        self.assertIn("`${running} running`", chat)
        self.assertIn("el.chatLog.dataset.running", chat)

    def test_assistant_console_lives_in_the_feed_rail(self):
        # The assistant menu docked into the A-Eyes side rail: while its node
        # is selected the feed swaps the activity stream for a full-height
        # chat console, and the floating card only serves the narrow layout.
        for element_id in ("idle-feed-activity", "idle-feed-chat", "idle-chat-status",
                           "idle-chat-thread", "idle-chat-input", "idle-chat-send",
                           "idle-chat-work", "idle-chat-pause", "idle-chat-chips"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        self.assertIn('<textarea id="idle-chat-input"', self.template)
        self.assertIn("data-msg", self.template)
        for marker in ("renderChat", "chatMode()", "composerInput", "feedVisible()",
                       "growArea", "thinkingBubble", "event.shiftKey", "thinking?.text"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.idle)
        styles = (STUDIO / "renderer" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".feed-chat-thread", styles)

    def test_empty_overlay_hides_when_the_board_has_work(self):
        # Zero OpenCode sessions used to drop "No recent sessions" over a live
        # constellation of tasks, plans and builders.
        empty = self.idle[self.idle.index("function constellationHasWork()") : self.idle.index("function renderHint()")]
        self.assertIn('node.kind === "task"', empty)
        self.assertIn("node.builder", empty)
        self.assertIn("autopilotJobs", empty)
        self.assertIn("el.empty.hidden = true", empty)
        self.assertIn("function renderEmpty()", empty)

    def test_chat_log_is_opaque_and_labels_step_around_it(self):
        styles = (STUDIO / "renderer" / "styles.css").read_text(encoding="utf-8")
        glass = styles[styles.index(".glass-hard") : styles.index(".glass-soft")]
        self.assertIn(".cmd-chat", glass)
        hud = self.idle[self.idle.index("function hudRects()") : self.idle.index("function drawLabels")]
        self.assertIn("push(el.chatLog)", hud)
        self.assertIn("push(el.feed)", hud)

    def test_thread_collapses_repeated_work_on_pairs(self):
        self.assertIn("function threadMessages(", self.idle)
        fill = self.idle[self.idle.index("function fillThread") : self.idle.index("function renderChatLog")]
        self.assertIn("threadMessages(full)", fill)
        work = self.idle[self.idle.index("async function workOnNode") : self.idle.index("async function assistantControl")]
        self.assertIn("state.workOnBusy", work)

    def test_agent_status_colors_and_work_left_meters(self):
        # Agents read their status in colour on both surfaces — the rail and
        # the Command view: done green, queued dim slate, error amber; a
        # running or idle satellite keeps the role colour.
        for source, done, queued in (
            (self.idle, "if (node.status === \"done\") return NODE_RGB.done;", "if (node.status === \"queued\") return NODE_RGB.pending;"),
            (self.tree, "if (node.status === \"done\") return COLORS.done;", "if (node.status === \"queued\") return COLORS.pending;"),
        ):
            with self.subTest(surface="idle" if source is self.idle else "tree3d"):
                self.assertIn(done, source)
                self.assertIn(queued, source)
                self.assertIn('if (node.status === "error")', source)
        # The work-left meter: a slim bar under any node with a known
        # fraction, and the assistant hub carries the whole board's todo
        # progress so "what is left" reads from the main agent itself.
        for source in (self.idle, self.tree):
            with self.subTest(surface="idle" if source is self.idle else "tree3d"):
                self.assertIn("Work-left meter", source)
                self.assertIn("roundRect(", source)
        self.assertIn("hubNode.progress", self.idle)
        self.assertIn("hubNode.progress", self.tree)
        # The meter tracks a running agent between rebuilds, and a done
        # agent's hover says it went back to the assistant.
        self.assertIn("node.progress = typeof agent.progress === \"number\" ? agent.progress : null;", self.idle)
        self.assertIn("back at the assistant", self.idle)
        # The legend documents both: the meter row and the agent status hues.
        self.assertIn('{ key: "meter"', self.idle)

    def test_builder_jobs_carry_their_own_progress(self):
        # Main side: a running job's fraction is its spawned session's own
        # todo list — polled slowly, pushed only on change — and
        # autopilotStatus carries it to the renderer.
        self.assertIn("function watchJobProgress(", self.main)
        self.assertIn("EXECUTOR_PROGRESS_POLL_MS", self.main)
        self.assertIn("eyes.listTodos({ sessionId: entry.sessionId })", self.main)
        self.assertIn("watchJobProgress(eyes, entry);", self.main)
        self.assertIn('typeof entry.progress === "number"', self.main)
        self.assertIn("progress: null, // the run's own todo fraction", self.main)
        # Renderer side: builder nodes wear the fraction so the work-left
        # meter shows under a building agent, and a push carrying the same
        # job set with newer numbers refreshes the meters in place — a full
        # rebuild is for jobs joining or leaving.
        self.assertIn("progress: typeof job.progress === \"number\" ? job.progress : null,", self.idle)
        self.assertIn("node.progress = typeof job.progress === \"number\" ? job.progress : null;", self.idle)
        self.assertIn("Same jobs, newer numbers", self.idle)

    def test_boot_menu_does_not_hold_the_launch(self):
        boot = (STUDIO / "renderer" / "boot.js").read_text(encoding="utf-8")
        match = re.search(r"const MIN_SHOW_MS = (\d+)", boot)
        self.assertIsNotNone(match, "boot.js must keep a MIN_SHOW_MS floor")
        self.assertLessEqual(int(match.group(1)), 1200)
        self.assertIn("boot.idleDone && boot.dataDone", boot)
        booklet = (STUDIO / "renderer" / "booklet.js").read_text(encoding="utf-8")
        self.assertIn("paintCatalog", booklet)
        self.assertIn('refresh("open")', booklet)
        self.assertIn("requestIdleCallback", booklet)

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_idle.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
