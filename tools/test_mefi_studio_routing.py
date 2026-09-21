"""Provider routing and coding-CLI contracts for Mefi's Studio AI+ (standalone repository).

Pins the z.ai GLM Coding Plan integration: the z.ai key lives in its own
encrypted settings field, the assistant's provider router walks the owner's
ordered auto provider list (first usable answers) and never silently spends
another account's credit, GLM 5.3 Flash is the routine
route and glm-5.3 the heavy one, the autopilot executor's `opencode run` jobs
ride the Studio-managed `mefi-zai` provider through OPENCODE_CONFIG_CONTENT
(key passed per-process, never written to disk or logged), the CLI panel
detects and launches the owner's installed opencode/codex/claude, auto setup
plans a configuration from saved-key flags and detected CLIs, the speed
probe splits on glm-* model ids, and no saved key ever crosses IPC back to the
renderer. Claude Code and Grok ride their CLI's own login (headless print mode,
prompt on stdin, no Anthropic API key); LM Studio answers keyless from the
local server; the custom route pairs any OpenAI-compatible endpoint with its
own encrypted key. When `opencode` is on PATH a live half verifies the injected
config actually resolves the mefi-zai models; that half skips cleanly without
it. No paid API call is ever made.
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
        cls.client = (STUDIO / "scripts" / "decision-client.mjs").read_text(encoding="utf-8")
        cls.preload = (STUDIO / "preload.cjs").read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.booklet_js = (STUDIO / "renderer" / "booklet.js").read_text(encoding="utf-8")
        cls.speed = (STUDIO / "scripts" / "measure-speed.mjs").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    # ---- credentials ---------------------------------------------------

    def test_zai_key_has_its_own_encrypted_field(self):
        self.assertIn('"zaiApiKeyEncrypted"', self.main)
        self.assertIn('"apiKeyEncrypted"', self.main)
        # One encrypted field per credential owner; unknown ids fall back to
        # the OpenCode Go field rather than sharing another route's key.
        self.assertIn('const keyFieldFor = (which) => KEY_FIELDS[which] ?? "apiKeyEncrypted"', self.main)
        for field in ('zai: "zaiApiKeyEncrypted"', 'gateway: "gatewayApiKeyEncrypted"', 'jev: "jevApiKeyEncrypted"', 'zen: "zenApiKeyEncrypted"', 'openrouter: "openrouterApiKeyEncrypted"'):
            with self.subTest(field=field):
                self.assertIn(field, self.main)
        body = _function_body(self.main, "decryptKey")
        self.assertTrue(body, "decryptKey must exist")
        self.assertIn("safeStorage.decryptString", body)
        # Both headless setters exist and write their own field.
        self.assertIn("--set-zai-key", self.main)
        self.assertIn("MEFI_STUDIO_ZAI_KEY", self.main)
        self.assertIn("settings.zaiApiKeyEncrypted = safeStorage.encryptString", self.main)
        self.assertIn("settings.apiKeyEncrypted = safeStorage.encryptString", self.main)

    def test_jev_routes_keep_their_own_keys_and_endpoints(self):
        # Four routes: the Vercel AI Gateway, TypeSafe's Jev API, OpenCode Zen
        # and OpenRouter. The route decides the endpoint, the model id and
        # which credential is read.
        for route_id in ('id: "vercel"', 'id: "typesafe"', 'id: "zen"', 'id: "openrouter"'):
            with self.subTest(route=route_id):
                self.assertIn(route_id, self.client)
        self.assertIn('baseUrl: "https://ai-gateway.vercel.sh/v1"', self.client)
        self.assertIn('baseUrl: "https://api.typesafe.ai/v1"', self.client)
        self.assertIn('baseUrl: "https://opencode.ai/zen/v1"', self.client)
        self.assertIn('baseUrl: "https://openrouter.ai/api/alpha"', self.client)
        self.assertIn('"typesafe-ai/jev"', self.client)
        self.assertIn("JEV_DOC_MODEL", self.client)
        self.assertIn('"jev-1.13"', self.client)
        self.assertIn('"typesafe/jev-1.13"', self.client)
        self.assertIn('"TYPESAFE_API_KEY"', self.client)
        self.assertIn('"MEFI_STUDIO_JEV_KEY"', self.client)
        self.assertIn('"OPENCODE_ZEN_API_KEY"', self.client)
        self.assertIn('"MEFI_STUDIO_ZEN_KEY"', self.client)
        self.assertIn('"OPENROUTER_API_KEY"', self.client)
        self.assertIn('"MEFI_STUDIO_OPENROUTER_KEY"', self.client)
        self.assertIn("MEFI_JEV_ROUTE", self.client)
        self.assertIn("/systemone", self.client)
        self.assertIn("/decisions", self.client)
        self.assertIn("https://openrouter.ai/api/v1/models", self.client)
        self.assertIn("client.resolveJevRoute(settings)", self.main)
        self.assertIn("client.gatewayConfig({ route })", self.main)
        self.assertIn('settings.jevRoute = client.normalizeJevRoute(value)', self.main)
        self.assertIn("client.isJevRoute(value)", self.main)
        # Headless setters for each route's key.
        self.assertIn("--set-jev-key", self.main)
        self.assertIn("settings.jevApiKeyEncrypted = safeStorage.encryptString", self.main)
        self.assertIn("--set-zen-key", self.main)
        self.assertIn("settings.zenApiKeyEncrypted = safeStorage.encryptString", self.main)
        self.assertIn("--set-openrouter-key", self.main)
        self.assertIn("settings.openrouterApiKeyEncrypted = safeStorage.encryptString", self.main)
        # The renderer route selector and its bridge.
        self.assertIn('id="jev-route"', self.template)
        self.assertIn('<option value="vercel">Vercel AI Gateway</option>', self.template)
        self.assertIn('<option value="typesafe">Jev API', self.template)
        self.assertIn('<option value="zen">OpenCode Zen</option>', self.template)
        self.assertIn('<option value="openrouter">OpenRouter</option>', self.template)
        self.assertIn("jevSetRoute", self.preload)
        for field in ('typesafe: { key: "jev"', 'zen: { key: "zen"', 'openrouter: { key: "openrouter"'):
            with self.subTest(field=field):
                self.assertIn(field, self.booklet_js)

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
        # Explicit picks are absolute: explicit "opencode" is the only way the
        # OpenCode key is touched without the order, and explicit "zai" without
        # a key is an error, not a fallback to the other account.
        self.assertIn('if (provider === "opencode")', body)
        self.assertIn('"no z.ai key saved', body)
        # Auto is the owner's ordered list: each entry resolves to a candidate,
        # the first usable one answers, and the failure walk is opt-in.
        auto = _function_body(self.main, "resolveAutoRoute")
        self.assertTrue(auto, "resolveAutoRoute must exist")
        self.assertIn("normalizeAutoProviders(settings.aiAutoProviders)", auto)
        self.assertIn("autoFallbackEnabled(settings)", auto)
        self.assertIn("AUTO_PROVIDER_NAMES[id]", auto, "an unusable order names itself in the error")
        candidate = _function_body(self.main, "resolveAiCandidate")
        self.assertTrue(candidate, "resolveAiCandidate must exist")
        self.assertIn('assistantModelOverride(settings, role, "zai")', candidate)
        self.assertIn("grokCliAvailable()", candidate, "an auto CLI entry is skipped when its binary is missing")
        # The OpenCode session header only rides the OpenCode route — z.ai
        # never receives an x-opencode-session header. assistantFetch splits
        # its HTTP half into httpAssistantCall (the grok-CLI fallback lands
        # there), so the wire shape is pinned on the function that owns it.
        fetch = _function_body(self.main, "assistantFetch")
        http = _function_body(self.main, "httpAssistantCall")
        self.assertTrue(http, "httpAssistantCall must exist — the grok fallback lands on it")
        self.assertIn('candidate.provider === "opencode" ? await assistantSessionId() : null', http)
        self.assertIn("route.fallbacks", http, "the fallback walk follows the saved order")
        self.assertIn('resolveAiRoute(role, { allowCli: false })', fetch, "a failed CLI call falls back to the keyed HTTP routes")

    def test_auto_provider_order_is_normalized_validated_and_saved(self):
        # The saved order is the user's preference list: ordered, deduped,
        # restricted to the pool, and never empty (auto needs somewhere to go).
        normalize = _function_body(self.main, "normalizeAutoProviders")
        self.assertTrue(normalize, "normalizeAutoProviders must exist")
        self.assertIn("AI_AUTO_PROVIDERS.includes(id)", normalize)
        self.assertIn("!order.includes(id)", normalize)
        self.assertIn('["zai", "opencode"]', normalize)
        self.assertIn('AI_AUTO_PROVIDERS = ["zai", "opencode", "grok", "claude", "antigravity", "lmstudio", "custom"]', self.main)
        # The opt-in fallback switch generalized: aiAutoFallback first, the
        # older aiFallbackOpenCode field honored for settings already written.
        fallback = _function_body(self.main, "autoFallbackEnabled")
        self.assertTrue(fallback, "autoFallbackEnabled must exist")
        self.assertIn("settings.aiAutoFallback !== undefined", fallback)
        self.assertIn("settings.aiFallbackOpenCode === true", fallback)
        # The routing IPC exposes the order and saves it whole.
        routing = _function_body(self.main, "registerIpc")
        self.assertIn("autoProviders: normalizeAutoProviders(settings.aiAutoProviders)", routing)
        self.assertIn("autoFallback: autoFallbackEnabled(settings)", routing)
        self.assertIn("settings.aiAutoProviders = order", routing)
        self.assertIn("auto provider order needs at least one provider", routing)
        self.assertIn("unknown auto provider:", routing)

    def test_zai_route_uses_the_coding_plan_endpoint_and_glm_models(self):
        self.assertIn('ZAI_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions"', self.main)
        self.assertIn('ZAI_MODEL_ROUTINE = "glm-5.3-flash"', self.main)
        self.assertIn('ZAI_MODEL_HEAVY = "glm-5.3"', self.main)
        body = _function_body(self.main, "resolveAiRoute")
        self.assertIn('role === "heavy" ? ZAI_MODEL_HEAVY : ZAI_MODEL_ROUTINE', body)
        fetch = _function_body(self.main, "assistantFetch")
        http = _function_body(self.main, "httpAssistantCall")
        # glm-5.3 always reasons; its effort knob differs from the flash shape.
        self.assertIn('candidate.model === ZAI_MODEL_HEAVY', http)
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
        self.assertIn("normalizeAutoProviders(settings.aiAutoProviders)", route, "the builder route follows the saved auto order")
        self.assertIn('order.indexOf("zai")', route)
        self.assertIn('order.indexOf("opencode")', route)
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

    def test_claude_code_route_rides_the_subscription_login(self):
        # The CLI, not an Anthropic API key: headless print mode, the prompt on
        # stdin (never cmd's command line), no tools for reply requests.
        complete = _function_body(self.main, "claudeCompletion")
        self.assertTrue(complete, "claudeCompletion must exist")
        self.assertIn('"cmd.exe"', complete, "the npm shim is reached through cmd.exe like opencode run")
        self.assertIn("claude -p --output-format json", complete, "the JSON reply carries the tokens the usage tracker records")
        self.assertIn("--tools=", complete, "a reply request cannot touch the repo")
        self.assertIn("--no-session-persistence", complete)
        self.assertIn("child.stdin?.write", complete, "the prompt rides stdin, never the command line")
        body = _function_body(self.main, "resolveAiRoute")
        self.assertIn('provider === "claude"', body, "the router returns the CLI route without a key")
        self.assertRegex(self.main, r'AI_PROVIDERS = \["auto", "zai", "opencode", "grok", "claude", "antigravity",.*"lmstudio", "custom"\]')
        fetch = _function_body(self.main, "assistantFetch")
        self.assertIn('route.provider === "grok" || route.provider === "claude"', fetch)
        self.assertIn("claudeCompletion(system, user, route.model)", fetch)
        # Builders: same subscription login, agentic print mode, prompt on stdin.
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn('cli === "claude"', spawn)
        self.assertIn("--dangerously-skip-permissions", spawn, "nobody is at the keyboard to approve an edit")
        self.assertIn('settings.executorCli === "claude"', _function_body(self.main, "executorRunEnv"))
        self.assertIn("claudeCliAvailable", _function_body(self.main, "executorRunEnv"))
        self.assertIn("claude: true", _function_body(self.main, "executorRunEnv"))
        self.assertIn('<option value="claude">', self.template)
        self.assertIn('<option value="claude">Claude Code — claude builds', self.template)

    def test_antigravity_route_rides_the_agy_login(self):
        # Antigravity CLI (`agy`) as a keyless route: a direct spawn (a Go
        # binary, not a cmd shim), the prompt on stdin, and every flag before
        # `-p` because `-p` first makes agy silently ignore --model.
        complete = _function_body(self.main, "antigravityCompletion")
        self.assertTrue(complete, "antigravityCompletion must exist")
        self.assertIn('spawn("agy", args', complete)
        self.assertIn('args.push("--output-format", "json", "-p")', complete, "all flags precede -p; JSON carries the tokens the usage tracker records")
        self.assertNotIn("--dangerously-skip-permissions", complete, "a reply request cannot auto-approve tools")
        self.assertIn("child.stdin?.write", complete, "the prompt rides stdin, never the command line")
        body = _function_body(self.main, "resolveAiRoute")
        self.assertIn('provider === "antigravity"', body)
        fetch = _function_body(self.main, "assistantFetch")
        self.assertIn("antigravityCompletion(system, user, route.model)", fetch)
        # Builders: agentic print mode, permissions skipped, model before -p.
        spawn = _function_body(self.main, "spawnNextJob")
        self.assertIn('cli === "antigravity"', spawn)
        self.assertIn('spawn("agy", args', spawn)
        self.assertIn("--dangerously-skip-permissions", spawn, "nobody is at the keyboard to approve an edit")
        self.assertIn('"--print-timeout", "60m"', spawn, "the CLI never ends a live build early")
        self.assertIn('settings.executorCli === "antigravity"', _function_body(self.main, "executorRunEnv"))
        self.assertIn("antigravityCliAvailable", _function_body(self.main, "executorRunEnv"))
        self.assertIn("antigravity: true", _function_body(self.main, "executorRunEnv"))
        self.assertIn('{ id: "antigravity", name: "Antigravity", cmd: "agy" }', self.main)
        self.assertIn('<option value="antigravity">', self.template)
        self.assertIn('data-cli="antigravity"', self.template)

    def test_models_are_scoped_per_provider_and_builder(self):
        override = _function_body(self.main, "assistantModelOverride")
        self.assertTrue(override, "assistantModelOverride must exist")
        self.assertIn("settings.aiModelsByProvider", override)
        self.assertIn("SINGLE_MODEL_PROVIDERS.has(providerKey)", override)
        self.assertIn('const SINGLE_MODEL_PROVIDERS = new Set(["grok", "claude", "antigravity", "lmstudio", "custom"])', self.main)
        builder = _function_body(self.main, "executorModelOverride")
        self.assertTrue(builder, "executorModelOverride must exist")
        self.assertIn("settings.executorModels", builder)
        routing = _function_body(self.main, "registerIpc")
        self.assertIn("providerModels", routing)
        self.assertIn("executorModels", routing)
        self.assertIn('id="provider-readiness"', self.template)
        self.assertIn('id="model-scope-note"', self.template)
        self.assertIn("providerModels: { [provider]: { [which]: value } }", self.booklet_js)

    def test_lmstudio_and_custom_routes_are_local_or_keyed_http(self):
        # LM Studio is keyless on the loopback server; the custom route is any
        # OpenAI-compatible endpoint with its own encrypted key.
        self.assertIn('LMSTUDIO_ENDPOINT = "http://127.0.0.1:1234/v1/chat/completions"', self.main)
        body = _function_body(self.main, "resolveAiRoute")
        self.assertIn('provider === "lmstudio"', body)
        self.assertIn("normalizeLmStudioEndpoint(settings.lmStudioEndpoint)", body)
        self.assertIn('apiKey: "lm-studio"', body, "the local server ignores the bearer")
        self.assertIn('provider === "custom"', body)
        self.assertIn('decryptKey(settings, "customApiKeyEncrypted")', body)
        self.assertIn("no custom API key saved", body)
        self.assertIn("no custom endpoint saved", body)
        # Bare base URLs normalize onto the chat-completions path; non-http
        # values fall back instead of reaching fetch.
        helper = _function_body(self.main, "normalizeCompatEndpoint")
        self.assertTrue(helper, "normalizeCompatEndpoint must exist")
        self.assertIn("/chat/completions", helper)
        self.assertIn("^https?:", helper)
        # The key has its own encrypted field and headless setter; the endpoint
        # is a plain validated preference, saved through the routing IPC.
        self.assertIn('custom: "customApiKeyEncrypted"', self.main)
        self.assertIn("--set-custom-key", self.main)
        self.assertIn("MEFI_STUDIO_CUSTOM_KEY", self.main)
        self.assertIn("settings.customApiKeyEncrypted = safeStorage.encryptString", self.main)
        self.assertIn('for (const key of ["customEndpoint", "lmStudioEndpoint"])', self.main)
        self.assertIn('id="custom-endpoint"', self.template)
        self.assertIn('id="custom-key"', self.template)
        self.assertIn('id="save-custom-key"', self.template)
        self.assertIn('id="lmstudio-endpoint"', self.template)
        self.assertIn('setApiKey(value, "custom")', self.booklet_js)
        self.assertIn('getApiKey("custom")', self.booklet_js)

    def test_keyless_cli_and_local_routes_skip_the_encrypted_key_gate(self):
        assistant = _function_body(self.main, "runAssistant")
        self.assertRegex(assistant, r'keyless = provider === "grok".*provider === "claude".*provider === "lmstudio"')
        self.assertIn("settings.customApiKeyEncrypted", assistant, "a custom key counts as a saved key")
        self.assertIn("normalizeAutoProviders(settings.aiAutoProviders)", assistant, "an auto order with a keyless route also skips the key gate")

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
        status = _function_body(self.main, "codingCliStatus")
        self.assertTrue(status, "codingCliStatus must exist — auto setup and the CLI panel share it")
        self.assertIn('"where.exe"', status, "detection resolves the installed path")
        self.assertIn("installed: false", status, "a missing CLI reports cleanly")
        self.assertIn('ipcMain.handle("studio:cli-status", () => codingCliStatus())', self.main)
        launch = re.search(r'ipcMain\.handle\("studio:launch-cli"(.*?)\}\);', self.main, re.S)
        self.assertIsNotNone(launch)
        self.assertIn("detached: true", launch.group(1), "interactive CLIs outlive the launcher")
        self.assertIn("zaiOpencodeEnv()", launch.group(1), "OpenCode carries mefi-zai when a key is saved")
        self.assertIn("unknown cli", launch.group(1), "unregistered ids are rejected")

    def test_auto_setup_plans_from_saved_keys_and_installed_clis(self):
        planner = _function_body(self.main, "planAutoSetup")
        self.assertTrue(planner, "planAutoSetup must exist")
        self.assertRegex(planner, r'keys\.zai \? "zai"\s*: keys\.opencode \? "opencode"', "a saved key outranks an installed CLI")
        self.assertRegex(planner, r'modelSelection = (?:jevReady|keys\.gateway) \? "jev" : "fixed"', "a saved Jev key enables task-aware selection")
        self.assertRegex(planner, r'installed\("opencode"\) \? "opencode" : installed\("grok"\) \? "grok"', "an installed builder CLI decides the executor")
        self.assertIn("autoFallbackEnabled(settings)", planner, "the fallback switch is read through its generalized name")
        self.assertIn("changes.autoFallback = false", planner, "a fallback with no second usable provider is turned off")
        self.assertIn("changes, active", planner, "the planner reports both the delta and the effective configuration")
        handler = re.search(r'ipcMain\.handle\("settings:auto-setup"(.*?)\n  \}\);', self.main, re.S)
        self.assertIsNotNone(handler, "settings:auto-setup handler missing")
        self.assertRegex(handler.group(1), r'planAutoSetup\(\{ settings, keys, clis(?:, local)? \}\)')
        self.assertIn("await writeSettings(next)", handler.group(1), "only detected, planned changes are written")
        self.assertIn("applied: false", handler.group(1), "an already-configured machine reports a no-op")

    def test_zai_link_probe_uses_the_injected_env(self):
        probe = re.search(r'ipcMain\.handle\("studio:test-zai"(.*?)\}\);', self.main, re.S)
        self.assertIsNotNone(probe)
        body = probe.group(1)
        self.assertIn("opencode models mefi-zai", body)
        self.assertIn("{ ...process.env, ...zaiEnv }", body)
        self.assertIn('"no z.ai key saved"', body)

    # ---- renderer + probe ------------------------------------------------

    def test_renderer_surface(self):
        for name in ("getAiRouting", "setAiRouting", "autoSetup", "cliStatus", "launchCli", "testZai"):
            with self.subTest(bridge=name):
                self.assertIn(name, self.preload)
        for element_id in ("zai-key", "save-zai-key", "zai-key-status", "ai-provider", "ai-fallback", "auto-order-list", "auto-order-add", "auto-order-add-button", "cli-status", "cli-test-zai", "auto-setup", "auto-setup-status", "setup-assistant", "setup-selection", "setup-builders", "custom-endpoint", "custom-key", "save-custom-key", "custom-key-status", "lmstudio-endpoint"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)
        for cli in ('data-cli="opencode"', 'data-cli="grok"', 'data-cli="codex"', 'data-cli="claude"'):
            with self.subTest(cli=cli):
                self.assertIn(cli, self.template)
        self.assertIn('id="executor-cli"', self.template)
        self.assertIn("executorCli", self.booklet_js)
        self.assertIn("autoProviders", self.booklet_js, "the renderer saves the ordered auto list")
        self.assertIn("auto-order-list", self.booklet_js, "the renderer fills the order editor")
        self.assertIn("autoFallback", self.booklet_js, "the renderer reads the generalized fallback switch")
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
