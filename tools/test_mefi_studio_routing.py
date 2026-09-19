"""Provider routing and coding-CLI contracts for Mefi's Studio AI+ (standalone repository).

Pins the z.ai GLM Coding Plan integration: the z.ai key lives in its own
encrypted settings field, the assistant's provider router prefers z.ai under
"auto" and never silently spends OpenCode credit, GLM 5.3 Flash is the routine
route and glm-5.3 the heavy one, the autopilot executor's `opencode run` jobs
ride the Studio-managed `mefi-zai` provider through OPENCODE_CONFIG_CONTENT
(key passed per-process, never written to disk or logged), the CLI panel
detects and launches the owner's installed opencode/codex/claude, the speed
probe splits on glm-* model ids, and no saved key ever crosses IPC back to the
renderer. When `opencode` is on PATH a live half verifies the injected config
actually resolves the mefi-zai models; that half skips cleanly without it.
No paid API call is ever made.
"""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT


def _function_body(source, name):
    """The braces-balanced body of `function name(` (or `async function name(`)."""
    match = re.search(r"(?:async\s+)?function\s+" + re.escape(name) + r"\s*\(", source)
    if not match:
        return ""
    # Skip the parameter list first: destructured defaults like
    # `{ role = "routine" }` carry braces before the body opens.
    depth = 1
    index = match.end()
    while index < len(source) and depth:
        if source[index] == "(":
            depth += 1
        elif source[index] == ")":
            depth -= 1
        index += 1
    start = source.index("{", index)
    depth = 0
    for index in range(start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    return source[start:]


class MefiStudioRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.booklet_js = (STUDIO / "renderer" / "booklet.js").read_text(encoding="utf-8")
        cls.speed = (STUDIO / "scripts" / "measure-speed.mjs").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    # ---- credentials ---------------------------------------------------

    def test_zai_key_has_its_own_encrypted_field(self):
        self.assertIn('"zaiApiKeyEncrypted"', self.main)
        self.assertIn('"apiKeyEncrypted"', self.main)
        self.assertIn('which === "zai" ? "zaiApiKeyEncrypted" : which === "gateway" ? "gatewayApiKeyEncrypted" : "apiKeyEncrypted"', self.main, "three key fields: OpenCode Go, z.ai, and the Jev-only AI Gateway")
        body = _function_body(self.main, "decryptKey")
        self.assertTrue(body, "decryptKey must exist")
        self.assertIn("safeStorage.decryptString", body)
        # Both headless setters exist and write their own field.
        self.assertIn("--set-zai-key", self.main)
        self.assertIn("MEFI_STUDIO_ZAI_KEY", self.main)
        self.assertIn("settings.zaiApiKeyEncrypted = safeStorage.encryptString", self.main)
        self.assertIn("settings.apiKeyEncrypted = safeStorage.encryptString", self.main)

    def test_keys_never_cross_ipc_to_the_renderer(self):
        body = _function_body(self.main, "registerIpc")
        get_key = re.search(r'ipcMain\.handle\("settings:get-key"(.*?)\}\);', body, re.S)
        self.assertIsNotNone(get_key, "settings:get-key handler missing")
        self.assertIn("{ saved: Boolean(decryptKey(", get_key.group(1), "only a saved/encrypted status crosses IPC")
        self.assertNotIn("return decrypted", get_key.group(1), "the raw key must not be returned to the renderer")
        set_key = re.search(r'ipcMain\.handle\("settings:set-key"(.*?)\}\);', body, re.S)
        self.assertIsNotNone(set_key)
        self.assertIn("delete settings[field]", set_key.group(1), "an empty value clears the key")
        self.assertIn('error: "OS encryption unavailable"', set_key.group(1), "no plaintext fallback")
        # The key value is never interpolated into a log line or a prompt.
        self.assertNotRegex(self.main, r"logLine\([^)]*\$\{(key|apiKey|zaiKey|goKey)\b")

    def test_provider_router_prefers_zai_and_never_silent_bills_opencode(self):
        body = _function_body(self.main, "resolveAiRoute")
        self.assertTrue(body, "resolveAiRoute must exist")
        self.assertIn('AI_PROVIDERS.includes(settings.aiProvider)', body)
        self.assertIn('decryptKey(settings, "zaiApiKeyEncrypted")', body)
        self.assertIn('decryptKey(settings, "apiKeyEncrypted")', body)
        # Explicit "opencode" (or auto with no z.ai key) is the only way the
        # OpenCode key is touched; explicit "zai" without a key is an error,
        # not a fallback to the other account.
        self.assertIn('provider === "opencode" || (provider === "auto" && !zaiKey)', body)
        self.assertIn('"no z.ai key saved', body)
        # The opt-in fallback requires all three: auto + toggle + a Go key.
        self.assertIn('provider === "auto" && settings.aiFallbackOpenCode === true && goKey', body)
        # The OpenCode session header only rides the OpenCode route — z.ai
        # never receives an x-opencode-session header. assistantFetch splits
        # its HTTP half into httpAssistantCall (the grok-CLI fallback lands
        # there), so the wire shape is pinned on the function that owns it.
        fetch = _function_body(self.main, "assistantFetch")
        http = _function_body(self.main, "httpAssistantCall")
        self.assertTrue(http, "httpAssistantCall must exist — the grok fallback lands on it")
        self.assertIn('route.provider === "opencode" ? await assistantSessionId() : null', http)
        self.assertIn('resolveAiRoute(role, { allowGrok: false })', fetch, "a failed grok call falls back to the keyed HTTP routes")

    def test_zai_route_uses_the_coding_plan_endpoint_and_glm_models(self):
        self.assertIn('ZAI_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions"', self.main)
        self.assertIn('ZAI_MODEL_ROUTINE = "glm-5.3-flash"', self.main)
        self.assertIn('ZAI_MODEL_HEAVY = "glm-5.3"', self.main)
        body = _function_body(self.main, "resolveAiRoute")
        self.assertIn('role === "heavy" ? ZAI_MODEL_HEAVY : ZAI_MODEL_ROUTINE', body)
        fetch = _function_body(self.main, "assistantFetch")
        http = _function_body(self.main, "httpAssistantCall")
        # glm-5.3 always reasons; its effort knob differs from the flash shape.
        self.assertIn('route.model === ZAI_MODEL_HEAVY', http)
        self.assertIn('body.thinking = { type: "enabled" }', http)
        # The heavy route goes to the passes that earn it, not every call.
        self.assertIn('mode === "improve" ? "heavy" : "routine"', self.main)
        self.assertIn('role: "heavy"', self.main)

    def test_executor_jobs_ride_mefi_zai_not_opencode_balance(self):
        route = _function_body(self.main, "executorRunEnv")
        self.assertTrue(route, "executorRunEnv must exist")
        self.assertIn('provider === "opencode"', route, "an explicit opencode pick never injects mefi-zai")
        self.assertIn('"AI routing is z.ai-only but no z.ai key is saved"', route)
        self.assertIn("mefi-zai/${ZAI_MODEL_ROUTINE}", route)
        self.assertIn("glm-5.3-flash", route, "queue-draining builders ride flash, not the heavy glm-5.3 route")
        self.assertNotIn("ZAI_MODEL_HEAVY", route, "the heavy model is overseer/improve, not a 24/7 worker")
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn("executorRunEnv()", spawn)
        self.assertIn("opencode run --auto${route.modelArgs}", spawn)
        self.assertIn("env: { ...process.env, ...route.env }", spawn)
        self.assertIn("fallbackToOpencode", spawn, "a grok attempt that dies silently retries on the opencode route")
        self.assertIn("via ${runRoute.via}", spawn, "the log line names which account pays")
        # The route is resolved BEFORE the claim. A missing assignment used to
        # throw `runRoute is not defined` after the task flipped to active,
        # which stranded the board with no child process.
        claim = spawn.find("autopilot.jobs.push(entry)")
        route_call = spawn.find("executorRunEnv()")
        self.assertGreaterEqual(route_call, 0)
        self.assertGreater(claim, route_call, "claiming work before the route is known strands the board on a throw")

    def test_grok_executor_is_an_agentic_session_not_a_single_turn(self):
        # `--prompt-file` is a single-turn completion (no tools). Build jobs
        # have to be a headless grok session that can actually edit the repo.
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn('runRoute.cli === "grok"', spawn)
        self.assertIn("--always-approve", spawn)
        self.assertIn("--output-format", spawn)
        self.assertIn("--max-turns", spawn)
        self.assertNotIn('"--prompt-file"', spawn, "prompt-file is the chat completion path; builders need tools")
        complete = _function_body(self.main, "grokCompletion")
        self.assertIn("--prompt-file", complete, "assistant replies stay single-turn")
        self.assertIn('settings.executorCli === "grok"', _function_body(self.main, "executorRunEnv"))
        self.assertIn('id="executor-cli"', self.template)
        self.assertIn('id="executor-model"', self.template)

    def test_mefi_zai_provider_config_shape(self):
        body = _function_body(self.main, "zaiProviderConfig")
        self.assertTrue(body, "zaiProviderConfig must exist")
        self.assertIn('"mefi-zai"', body)
        self.assertIn('"@ai-sdk/openai-compatible"', body)
        self.assertIn('"https://api.z.ai/api/coding/paas/v4"', body)
        # The key is an env placeholder inside the injected config — the real
        # secret only travels as the MEFI_ZAI_API_KEY process env, never in JSON.
        self.assertIn('apiKey: "{env:MEFI_ZAI_API_KEY}"', body)
        self.assertIn('"glm-5.3-flash"', body)
        self.assertIn('"glm-5.3"', body)
        env = _function_body(self.main, "zaiOpencodeEnv")
        self.assertIn("OPENCODE_CONFIG_CONTENT", env)
        self.assertIn("MEFI_ZAI_API_KEY: key", env)
        self.assertIn('decryptKey(await readSettings(), "zaiApiKeyEncrypted")', env)

    # ---- coding CLIs -----------------------------------------------------

    def test_coding_cli_registry_and_detection(self):
        for cli in ('id: "opencode"', 'id: "grok"', 'id: "codex"', 'id: "claude"'):
            with self.subTest(cli=cli):
                self.assertIn(cli, self.main)
        status = re.search(r'ipcMain\.handle\("studio:cli-status"(.*?)\)\s*\n\s*\);', self.main, re.S)
        self.assertIsNotNone(status)
        self.assertIn('"where.exe"', status.group(1), "detection resolves the installed path")
        self.assertIn("installed: false", status.group(1), "a missing CLI reports cleanly")
        launch = re.search(r'ipcMain\.handle\("studio:launch-cli"(.*?)\}\);', self.main, re.S)
        self.assertIsNotNone(launch)
        self.assertIn("detached: true", launch.group(1), "interactive CLIs outlive the launcher")
        self.assertIn("zaiOpencodeEnv()", launch.group(1), "OpenCode carries mefi-zai when a key is saved")
        self.assertIn("unknown cli", launch.group(1), "unregistered ids are rejected")

    def test_zai_link_probe_uses_the_injected_env(self):
        probe = re.search(r'ipcMain\.handle\("studio:test-zai"(.*?)\}\);', self.main, re.S)
        self.assertIsNotNone(probe)
        body = probe.group(1)
        self.assertIn("opencode models mefi-zai", body)
        self.assertIn("{ ...process.env, ...zaiEnv }", body)
        self.assertIn('"no z.ai key saved"', body)

    # ---- renderer + probe ------------------------------------------------

    def test_renderer_surface(self):
        for name in ("getAiRouting", "setAiRouting", "cliStatus", "launchCli", "testZai"):
            with self.subTest(bridge=name):
                self.assertIn(name, self.preload)
        for element_id in ("zai-key", "save-zai-key", "zai-key-status", "ai-provider", "ai-fallback", "cli-status", "cli-test-zai"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        for cli in ('data-cli="opencode"', 'data-cli="grok"', 'data-cli="codex"', 'data-cli="claude"'):
            with self.subTest(cli=cli):
                self.assertIn(cli, self.template)
        self.assertIn('id="executor-cli"', self.template)
        self.assertIn("executorCli", self.booklet_js)
        self.assertIn('getApiKey("zai")', self.booklet_js)
        self.assertIn('setApiKey(value, "zai")', self.booklet_js)
        self.assertIn('getApiKey("opencode")', self.booklet_js)
        self.assertIn("key?.saved", self.booklet_js, "the status reads the saved flag, never a raw key")
        self.assertIn("glm-5.3-flash", self.booklet_js, "the speed probe offers the z.ai models")

    def test_speed_probe_splits_on_glm(self):
        self.assertIn('model.startsWith("glm-")', self.speed)
        self.assertIn("process.env.ZAI_API_KEY", self.speed)
        self.assertIn("https://api.z.ai/api/coding/paas/v4/chat/completions", self.speed)
        self.assertIn('if (!zai) headers["x-opencode-session"]', self.speed, "the OpenCode session header stays off z.ai")
        self.assertIn('"glm-5.3"', self.speed)
        probe = _function_body(self.main, "runSpeedProbe")
        self.assertIn('decryptKey(settings, "zaiApiKeyEncrypted")', probe)
        self.assertIn("env.ZAI_API_KEY = zaiKey", probe)
        self.assertIn('decryptKey(settings, "apiKeyEncrypted")', probe)
        self.assertIn("env.OPENCODE_GO_API_KEY = goKey", probe)

    def test_guide_registration(self):
        self.assertIn("`tools/test_mefi_studio_routing.py`", self.guide)

    # ---- live half: the injected config actually resolves ----------------

    def test_mefi_zai_config_resolves_in_real_opencode(self):
        node = shutil.which("node")
        opencode = shutil.which("opencode")
        if not node or not opencode:
            self.skipTest("node/opencode not on PATH; static contracts still ran")
        # Run the real zaiProviderConfig() and feed its JSON to the real CLI —
        # the same env a Studio launch or executor job would carry.
        source = self.main[self.main.index("function zaiProviderConfig") : self.main.index("async function zaiOpencodeEnv")]
        result = subprocess.run(
            [node, "-e", f"{source}\nconsole.log(JSON.stringify(zaiProviderConfig()))"],
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        parsed = json.loads(result.stdout.strip())
        provider = parsed["provider"]["mefi-zai"]
        self.assertEqual("https://api.z.ai/api/coding/paas/v4", provider["options"]["baseURL"])
        self.assertEqual("{env:MEFI_ZAI_API_KEY}", provider["options"]["apiKey"])
        env = {**os.environ, "OPENCODE_CONFIG_CONTENT": result.stdout.strip(), "MEFI_ZAI_API_KEY": "fixture-not-a-key"}
        result = subprocess.run(
            ["cmd", "/c", "opencode", "models", "mefi-zai", "--pure"],
            env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(0, result.returncode, result.stderr + result.stdout)
        self.assertIn("mefi-zai/glm-5.3-flash", result.stdout)
        self.assertIn("mefi-zai/glm-5.3", result.stdout)


if __name__ == "__main__":
    unittest.main()
