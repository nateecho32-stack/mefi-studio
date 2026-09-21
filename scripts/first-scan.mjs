// Mefi's Studio AI+ — the first-run scan of the OpenCode side of this machine.
//
// One bounded, read-only pass that answers "what can this machine already do?"
// before the walkthrough asks for a folder: is the OpenCode CLI installed and
// which version, which providers it has linked (names only — the scan never
// opens auth.json), which models it can reach and which of those are free,
// and which built-in agents exist. Pure parsers over the CLI's own output plus
// a policy (planFirstRun) that turns the facts into a first-run plan: the
// explorer that maps a folder, the builder that does work, and the judge that
// stands in for Jev when no Jev key is saved. Nothing here writes settings,
// sends a prompt, or touches OpenCode's config or credential store.
//
// Every command is spawned asynchronously with a deadline (never spawnSync —
// the scan may run on the Electron main process) and sequentially by default:
// each opencode process costs 1.3–2.7 s of cold start and a few hundred MB,
// which a memory-starved host cannot pay four times at once.
//
// Verified against opencode 1.18.31 on 2026-09-21. The free-tier facts below
// were measured, not assumed:
//   - free Zen models answer `opencode run` with the built-in agents (build,
//     plan, explore, general) and a `--model` or an agent *model* override;
//   - a custom agent name, or a permission override on a built-in agent, is
//     refused by the provider with HTTP 403 "OpenCode's free tier can only be
//     used from within OpenCode" — so free explorers ride the stock `plan`
//     agent and free builders ride the stock `build` agent;
//   - concurrent free-tier requests on one model queue behind each other
//     (a second call sat for 120 s), so free work must be serialized.

import { spawn } from "node:child_process";

export const SCAN_VERSION = 1;
export const DEFAULT_STEP_TIMEOUT_MS = 20000;
export const STDOUT_CAP = 2 * 1024 * 1024;
export const TESTED_OPENCODE_VERSION = "1.18.31";
// `opencode run --format json`, `--agent`, `--dir` and `opencode agent list`
// are the 1.x surface; a 0.x binary has a different CLI and is not supported.
export const MINIMUM_OPENCODE_MAJOR = 1;
export const ZEN_PROVIDER = "opencode";
export const GO_PROVIDER = "opencode-go";
export const FREE_MODEL_PARALLEL = 1;

export const FREE_TIER_NOTES = Object.freeze({
  training: "Free OpenCode Zen models may use prompts and completions to improve the model during their free period; \"contributor\" models grant explicit permission to train on them. Do not send confidential material through a free model.",
  limitedTime: "Free models are offered for a limited time and can be withdrawn without notice; the scan reads the live roster so a withdrawn model never stays recommended.",
  serialized: "The free tier queues concurrent requests on one model, so free explorers and builders run one at a time.",
  stockAgentsOnly: "The free tier answers only OpenCode's built-in agents; custom agents or permission overrides are refused (HTTP 403).",
});

// ---- text helpers ----------------------------------------------------------------

const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;
export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI, "");
}

const lines = (text) => stripAnsi(text).split(/\r?\n/);
const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// provider/model, where the model half may itself carry slashes and
// OpenRouter's "~" alias prefix (openrouter/openai/gpt-5.4-mini,
// openrouter/~openai/gpt-mini-latest).
export const MODEL_ID = /^([a-z0-9][a-z0-9._-]*)\/([A-Za-z0-9~][A-Za-z0-9._:/~-]*)$/;

export function parseVersion(stdout) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(stripAnsi(stdout));
  if (!match) return null;
  return { version: match[0], major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// ---- `opencode auth list` ----------------------------------------------------------
// Two boxed sections: "Credentials <path>" (the credential store) and
// "Environment" (providers keyed by an exported variable). An entry line is
// "●  <Provider display name> <detail>" where the detail is the credential
// kind (api, oauth, …) or the variable name. Only names are read; the store
// itself is never opened.

const PROVIDER_IDS = Object.freeze({
  "opencode zen": ZEN_PROVIDER,
  "opencode go": GO_PROVIDER,
  "openrouter": "openrouter",
  "anthropic": "anthropic",
  "openai": "openai",
  "google": "google",
  "google vertex ai": "google-vertex",
  "github copilot": "github-copilot",
  "amazon bedrock": "amazon-bedrock",
  "azure": "azure",
  "azure openai": "azure",
  "xai": "xai",
  "groq": "groq",
  "mistral": "mistral",
  "deepseek": "deepseek",
  "vercel ai gateway": "vercel",
  "cerebras": "cerebras",
  "huggingface": "huggingface",
  "hugging face": "huggingface",
  "zhipu": "zhipuai",
  "z.ai": "zai",
});

export function providerIdOf(name) {
  const key = clip(name, 80).toLowerCase();
  if (!key) return null;
  return PROVIDER_IDS[key] ?? key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const HEADER = /^[┌╭+]\s+(.*)$/;
const FOOTER = /^[└╰]\s+(.*)$/;
const ENTRY = /^[●○•*]\s+(.*)$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

export function parseAuthList(stdout) {
  const out = { credentialsPath: null, credentials: [], environment: [], providers: [], counts: { credentials: null, environment: null } };
  let section = null;
  for (const raw of lines(stdout)) {
    const line = raw.trim();
    if (!line) continue;
    const header = HEADER.exec(line);
    if (header) {
      const text = header[1].trim();
      if (/^credentials\b/i.test(text)) {
        section = "credentials";
        out.credentialsPath = text.replace(/^credentials\s*/i, "").trim() || null;
      } else if (/^environment\b/i.test(text)) section = "environment";
      else section = null;
      continue;
    }
    const footer = FOOTER.exec(line);
    if (footer) {
      const count = /^(\d+)\s+(credentials?|environment variables?)/i.exec(footer[1].trim());
      if (count && section) out.counts[section] = Number(count[1]);
      continue;
    }
    const entry = ENTRY.exec(line);
    if (!entry || !section) continue;
    const words = entry[1].trim().split(/\s+/);
    const detail = words.length > 1 ? words[words.length - 1] : null;
    const name = (words.length > 1 ? words.slice(0, -1) : words).join(" ");
    if (!name) continue;
    const id = providerIdOf(name);
    if (section === "credentials") out.credentials.push({ provider: id, name, kind: detail ? detail.toLowerCase() : null, source: "credentials" });
    else out.environment.push({ provider: id, name, variable: detail && ENV_NAME.test(detail) ? detail : null, source: "environment" });
  }
  const seen = new Set();
  for (const item of [...out.credentials, ...out.environment]) {
    if (item.provider && !seen.has(item.provider)) { seen.add(item.provider); out.providers.push(item.provider); }
  }
  return out;
}

// ---- `opencode models [provider]` ---------------------------------------------------

export function parseModelList(stdout) {
  const out = [];
  const seen = new Set();
  for (const raw of lines(stdout)) {
    const line = raw.trim();
    const match = MODEL_ID.exec(line);
    if (!match || seen.has(line)) continue;
    seen.add(line);
    out.push({ id: line, provider: match[1], model: match[2] });
  }
  return out;
}

// `opencode models --verbose <provider>` prints "provider/model" then a pretty
// JSON record: { id, providerID, name, status, cost{input,output}, limit
// {context,output}, capabilities{toolcall,reasoning,input{text,image,…}},
// release_date }. Unknown fields are kept null rather than guessed.
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const boolean = (value) => typeof value === "boolean" ? value : null;

export function normalizeModelRecord(id, record = {}) {
  const match = MODEL_ID.exec(id) ?? [];
  const capabilities = record?.capabilities && typeof record.capabilities === "object" ? record.capabilities : {};
  const input = capabilities.input && typeof capabilities.input === "object"
    ? Object.entries(capabilities.input).filter(([, on]) => on === true).map(([mode]) => mode) : null;
  return {
    id,
    provider: match[1] ?? record?.providerID ?? null,
    model: match[2] ?? record?.id ?? null,
    name: clip(record?.name, 120) || null,
    status: clip(record?.status, 40).toLowerCase() || null,
    cost: { input: number(record?.cost?.input), output: number(record?.cost?.output) },
    limit: { context: number(record?.limit?.context), output: number(record?.limit?.output) },
    tools: boolean(capabilities.toolcall ?? capabilities.tool_call ?? record?.tool_call),
    reasoning: boolean(capabilities.reasoning ?? record?.reasoning),
    inputModalities: input,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(String(record?.release_date ?? "")) ? record.release_date : null,
  };
}

export function parseVerboseModels(stdout) {
  const out = [];
  let current = null;
  let buffer = [];
  const flush = () => {
    if (!current) return;
    let record = {};
    let parsed = false;
    const text = buffer.join("\n").trim();
    if (text) {
      try { record = JSON.parse(text); parsed = true; } catch { record = {}; }
    }
    out.push({ ...normalizeModelRecord(current, record), parsed });
    current = null;
    buffer = [];
  };
  for (const raw of lines(stdout)) {
    if (!/^\s/.test(raw) && MODEL_ID.test(raw.trim())) {
      flush();
      current = raw.trim();
      continue;
    }
    if (current) buffer.push(raw);
  }
  flush();
  return out;
}

// ---- `opencode agent list` -----------------------------------------------------------
// "name (primary|subagent|all)" header lines; each is followed by its
// permission JSON, which is skipped (it is the user's own configuration).

export function parseAgentList(stdout) {
  const out = [];
  for (const raw of lines(stdout)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s+\((primary|subagent|all)\)\s*$/.exec(raw);
    if (match && !out.some((agent) => agent.name === match[1])) out.push({ name: match[1], mode: match[2] });
  }
  return out;
}

// ---- classification --------------------------------------------------------------------

export function classifyModel(record) {
  const model = String(record?.model ?? record?.id ?? "");
  const zeroCost = record?.cost?.input === 0 && record?.cost?.output === 0;
  const freeByName = /(^|[-_.])free$/i.test(model);
  const free = zeroCost || freeByName;
  const status = record?.status ?? null;
  const deprecated = Boolean(status && status !== "active");
  const kind = !free ? null : /contributor/i.test(model) ? "contributor" : zeroCost && !freeByName ? "stealth" : "free";
  return {
    free,
    kind,
    deprecated,
    // Every free Zen model is a data-collection model during its free period.
    trainsOnData: free ? true : null,
    usable: free && !deprecated && record?.tools !== false,
  };
}

export function rankFreeModels(records = []) {
  const ranked = [];
  for (const record of Array.isArray(records) ? records : []) {
    const classification = classifyModel(record);
    if (!classification.free) continue;
    ranked.push({ ...record, ...classification });
  }
  ranked.sort((a, b) => Number(b.usable) - Number(a.usable)
    || Number(b.tools === true) - Number(a.tools === true)
    || String(b.releaseDate ?? "").localeCompare(String(a.releaseDate ?? ""))
    || (b.limit?.context ?? 0) - (a.limit?.context ?? 0)
    || String(a.id).localeCompare(String(b.id)));
  return ranked.map((item, index) => ({
    ...item,
    rank: index + 1,
    why: [
      item.usable ? "free and active" : item.deprecated ? "deprecated by the roster" : "tool calls unsupported",
      item.tools === true ? "tool calls" : item.tools === false ? "no tool calls" : "tool support unknown",
      item.releaseDate ? `released ${item.releaseDate}` : "release date unknown",
      item.limit?.context ? `${Math.round(item.limit.context / 1024)}k context` : "context unknown",
    ].join(" · "),
  }));
}

// ---- the plan ------------------------------------------------------------------------------
// keys: the Studio's own saved-key booleans (the same shape settings:auto-setup
// computes). prefs.allowFreeTraining === false removes free models from every
// recommendation. prefs.assistantRoute marks a usable Studio assistant HTTP
// route (z.ai, OpenCode Go, LM Studio, custom) that can act as the judge.

const PAID_PROVIDER_LABELS = Object.freeze({
  [GO_PROVIDER]: "OpenCode Go", anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter",
  "github-copilot": "GitHub Copilot", "amazon-bedrock": "Amazon Bedrock", xai: "xAI", groq: "Groq", mistral: "Mistral",
  deepseek: "DeepSeek", azure: "Azure", vercel: "Vercel AI Gateway", zai: "z.ai",
});

export function planFirstRun({ scan = {}, keys = {}, prefs = {} } = {}) {
  const cli = scan.cli ?? {};
  const auth = scan.auth ?? { providers: [], credentials: [], environment: [] };
  const ranked = rankFreeModels(scan.models ?? []);
  const allowFree = prefs.allowFreeTraining !== false;
  const usableFree = ranked.filter((item) => item.usable);
  const bestFree = allowFree ? usableFree[0] ?? null : null;
  const linked = Array.isArray(auth.providers) ? auth.providers : [];
  // Zen is a key holder for free *and* paid models; a Zen key alone is not a
  // paid plan, and OpenCode Go is the plan most owners actually hold.
  const paid = linked.filter((id) => id !== ZEN_PROVIDER);
  const envOnly = (auth.environment ?? []).filter((item) => !(auth.credentials ?? []).some((cred) => cred.provider === item.provider));
  const warnings = [];
  const disclosures = [];
  const nextSteps = [];
  const version = cli.version ?? null;
  const supported = Boolean(cli.installed) && Number.isInteger(cli.major) && cli.major >= MINIMUM_OPENCODE_MAJOR;

  if (!cli.installed) {
    nextSteps.push("Install the OpenCode CLI (npm i -g opencode-ai, or the installer at opencode.ai) and run the scan again.");
  } else if (!version) {
    warnings.push("OpenCode is installed but did not report a version; the CLI may be broken or blocked by a security tool. Run `opencode --version` in a terminal.");
  } else if (!supported) {
    warnings.push(`OpenCode ${version} is older than the 1.x CLI this flow was verified on (${TESTED_OPENCODE_VERSION}); run \`opencode upgrade\`.`);
  }
  for (const item of envOnly) {
    if (item.variable) warnings.push(`${item.name} is linked only through the ${item.variable} environment variable; a Studio launched from the Start menu or Explorer does not inherit a shell-only variable. Run \`opencode auth login\` to save it, or set the variable for your user account.`);
  }
  if (cli.installed && ranked.length === 0) warnings.push("No free models were listed. Run `opencode models --refresh` to update the roster, or link a provider.");
  if (ranked.some((item) => item.deprecated)) warnings.push("Some free models are marked deprecated by the roster and were skipped.");
  if (!allowFree && usableFree.length) warnings.push("Free models were excluded because free-tier data collection was declined.");

  const explorer = !cli.installed || !supported ? { model: null, agent: "plan", transport: "opencode-run", reason: "OpenCode is not usable yet." }
    : bestFree ? { model: bestFree.id, agent: "plan", transport: "opencode-run", parallel: FREE_MODEL_PARALLEL, free: true, reason: `${bestFree.name ?? bestFree.id} is free, current and reads files with tools; exploring costs nothing.` }
      : paid.length ? { model: null, agent: "plan", transport: "opencode-run", free: false, reason: `No free model is available; the explorer uses OpenCode's default model on your linked ${PAID_PROVIDER_LABELS[paid[0]] ?? paid[0]} account.` }
        : { model: null, agent: "plan", transport: "opencode-run", reason: "No free model and no linked provider: exploring a folder needs one of them." };

  const builder = !cli.installed || !supported ? { model: null, agent: "build", reason: "OpenCode is not usable yet.", parallel: 0 }
    : paid.length && prefs.preferFree !== true ? {
      model: null, agent: "build", free: false, parallel: null,
      reason: `Builders run on OpenCode's default model from your linked ${PAID_PROVIDER_LABELS[paid[0]] ?? paid[0]} account (paid plans keep zero-retention terms).`,
      alternative: bestFree ? { model: bestFree.id, parallel: FREE_MODEL_PARALLEL, reason: "Switch to the free builder to spend nothing; expect slower, serialized runs." } : null,
    }
      : bestFree ? {
        model: bestFree.id, agent: "build", free: true, parallel: FREE_MODEL_PARALLEL,
        reason: `${bestFree.name ?? bestFree.id} builds for free; runs are serialized and may be slower than a paid model.`,
        alternative: paid.length ? { model: null, parallel: null, reason: `Use your linked ${PAID_PROVIDER_LABELS[paid[0]] ?? paid[0]} account for heavier work.` } : null,
      }
        : { model: null, agent: "build", parallel: 0, reason: "No free model and no linked provider: builders cannot start until one is linked." };

  const jevReady = Boolean(keys.gateway || keys.jev || keys.zen || keys.openrouter);
  const assistantRoute = prefs.assistantRoute === true || Boolean(keys.zai || keys.opencode || keys.custom);
  const judge = jevReady ? { kind: "jev", model: null, suitableFor: ["routing", "intake", "triage"], reason: "A Jev key is saved: constrained decisions ride Jev." }
    : assistantRoute ? { kind: "assistant", model: null, suitableFor: ["routing", "intake", "triage"], reason: "No Jev key: the assistant's own chat model answers the same constrained questions through the judge adapter." }
      : bestFree && supported ? { kind: "opencode-free", model: bestFree.id, suitableFor: ["intake", "triage"], reason: `No Jev key and no assistant route: ${bestFree.name ?? bestFree.id} judges through \`opencode run\`. It is too slow for per-call model routing, so routing keeps fixed defaults.` }
        : { kind: "fixed", model: null, suitableFor: [], reason: "No judge available: fixed model defaults and keyword heuristics apply." };

  if (explorer.free || builder.free || judge.kind === "opencode-free") {
    disclosures.push(FREE_TIER_NOTES.training, FREE_TIER_NOTES.limitedTime, FREE_TIER_NOTES.serialized, FREE_TIER_NOTES.stockAgentsOnly);
    if (bestFree?.kind === "contributor") disclosures.push(`${bestFree.name ?? bestFree.id} is a contributor model: its terms grant permission to train on your prompts and completions.`);
  }
  if (cli.installed && supported && !paid.length) nextSteps.push("Optional: link a paid provider with `opencode auth login` (or save an OpenCode Go key) for zero-retention builders and faster routing.");
  // A saved Zen key is already a Jev route (decision-client's `zen`), pinned
  // to the paid jev-1.13; the roster also carries a limited-time free Jev.
  if (keys.zen) nextSteps.push("A Zen key is saved: Jev may be reachable free as `jev-1.13-free` on the zen route (set MEFI_JEV_MODEL) — test it in Settings before relying on the paid pin.");
  if (!jevReady && !assistantRoute) nextSteps.push("Save a Jev key, or an assistant key (z.ai, OpenCode Go, custom), to enable task-aware model routing.");
  if (!bestFree && !paid.length && cli.installed) nextSteps.push("Sign in to OpenCode Zen (free tier) or link any provider before choosing a folder to explore.");

  return {
    version: SCAN_VERSION,
    ok: Boolean(cli.installed && supported),
    opencode: { installed: Boolean(cli.installed), path: cli.path ?? null, version, supported, testedVersion: TESTED_OPENCODE_VERSION },
    providers: {
      linked,
      paid,
      credentialsPath: auth.credentialsPath ?? null,
      free: { available: usableFree.length > 0, count: usableFree.length, models: ranked },
    },
    agents: Array.isArray(scan.agents) ? scan.agents : [],
    explorer,
    builder,
    judge,
    disclosures,
    warnings,
    nextSteps,
    errors: Array.isArray(scan.errors) ? scan.errors : [],
  };
}

// ---- running the scan -------------------------------------------------------------------

export function killTree(child, platform = process.platform) {
  try {
    if (platform === "win32" && child.pid) {
      const killer = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => {});
    } else child.kill("SIGKILL");
  } catch {}
}

// `opencode` installs as a .cmd shim on Windows, which Node will not spawn
// directly, so the command rides `cmd.exe /d /s /c` exactly as the Studio's
// executor does (main.cjs spawnAttempt). Arguments are fixed tokens or
// validated ids; anything cmd.exe could reinterpret is refused, never escaped.
export function commandLine(command, args = []) {
  const quote = (value) => {
    const text = String(value);
    if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
    if (/["\r\n ]/.test(text) || (text.match(/%/g) ?? []).length > 1) throw new Error(`unsafe argument for cmd.exe: ${text.slice(0, 60)}`);
    return `"${text}"`;
  };
  return [command, ...args].map(quote).join(" ");
}

// Async, deadline-bounded, output-capped process runner. Resolves, never
// rejects: a missing binary or a timeout is a scan fact, not an exception.
// `onData` sees stdout as it streams (the first map reads progress from it)
// and `onSpawn` receives the child so a caller can cancel it through
// killTree; both are optional and never change the result.
export function spawnExec(command, args = [], { timeoutMs = DEFAULT_STEP_TIMEOUT_MS, env = process.env, cwd, input = null, platform = process.platform, onData = null, onSpawn = null } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    let child;
    try {
      child = platform === "win32"
        // `/s` strips the first and last quote of the line after `/c`; the line
        // is wrapped in its own pair so quoted arguments (a title with spaces,
        // a project path) survive. Verbatim arguments stop Node re-quoting it.
        ? spawn("cmd.exe", ["/d", "/s", "/c", `"${commandLine(command, args)}"`], { env, cwd, windowsHide: true, windowsVerbatimArguments: true, stdio: ["pipe", "pipe", "pipe"] })
        : spawn(command, args, { env, cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      finish({ code: null, stdout, stderr, timedOut, error: String(error?.message ?? error) });
      return;
    }
    const timer = setTimeout(() => { timedOut = true; killTree(child, platform); }, Math.max(1, timeoutMs));
    timer.unref?.();
    try { onSpawn?.(child); } catch {}
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < STDOUT_CAP) stdout += String(chunk);
      try { onData?.(String(chunk)); } catch {}
    });
    child.stderr?.on("data", (chunk) => { if (stderr.length < STDOUT_CAP) stderr += String(chunk); });
    child.on("error", (error) => finish({ code: null, stdout, stderr, timedOut, error: String(error?.message ?? error) }));
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut, error: timedOut ? `timed out after ${timeoutMs} ms` : null }));
    try {
      if (input != null) child.stdin.write(String(input));
      child.stdin.end();
    } catch {}
  });
}

export const SCAN_COMMANDS = Object.freeze({
  locate: (platform) => platform === "win32" ? ["where", ["opencode"]] : ["which", ["opencode"]],
  version: ["opencode", ["--version"]],
  auth: ["opencode", ["auth", "list"]],
  models: ["opencode", ["models"]],
  verbose: ["opencode", ["models", "--verbose", ZEN_PROVIDER]],
  agents: ["opencode", ["agent", "list"]],
});

export async function runFirstScan({ exec = spawnExec, env = process.env, platform = process.platform, timeoutMs = DEFAULT_STEP_TIMEOUT_MS, verbose = true, onStep = null } = {}) {
  // Colour off and plugins untouched: the parsers strip escapes anyway, and a
  // plugin-provided provider must still show up in the model list.
  const scanEnv = { ...env, NO_COLOR: "1", FORCE_COLOR: "0" };
  const steps = [];
  const errors = [];
  const scan = { version: SCAN_VERSION, at: Date.now(), platform, cli: { installed: false, path: null, version: null, major: null, ok: false }, auth: parseAuthList(""), models: [], modelIds: [], agents: [], steps, errors };
  const run = async (id, [command, args]) => {
    const started = Date.now();
    const result = await exec(command, args, { timeoutMs, env: scanEnv, platform });
    const ok = !result.error && !result.timedOut && result.code === 0;
    const step = { id, command: `${command} ${args.join(" ")}`, ms: Date.now() - started, ok, code: result.code ?? null, timedOut: Boolean(result.timedOut), error: result.error ?? null };
    steps.push(step);
    if (!ok) errors.push({ step: id, error: result.error ?? `exit ${result.code}`, stderr: clip(result.stderr, 300) || null });
    try { onStep?.(step); } catch {}
    return { ...result, ok };
  };
  const locate = await run("locate", SCAN_COMMANDS.locate(platform));
  const first = stripAnsi(locate.stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
  if (!locate.ok || !first) return { ...scan, ms: steps.reduce((sum, step) => sum + step.ms, 0) };
  scan.cli.installed = true;
  scan.cli.path = first;
  const version = await run("version", SCAN_COMMANDS.version);
  const parsed = version.ok ? parseVersion(version.stdout) : null;
  scan.cli.version = parsed?.version ?? null;
  scan.cli.major = parsed?.major ?? null;
  scan.cli.ok = Boolean(parsed);
  const auth = await run("auth", SCAN_COMMANDS.auth);
  if (auth.ok) scan.auth = parseAuthList(auth.stdout);
  const models = await run("models", SCAN_COMMANDS.models);
  if (models.ok) scan.modelIds = parseModelList(models.stdout);
  if (verbose) {
    const detail = await run("verbose", SCAN_COMMANDS.verbose);
    if (detail.ok) scan.models = parseVerboseModels(detail.stdout);
  }
  // A verbose roster that failed still leaves the plain ids: free models are
  // recognizable by name, with costs and capabilities left unknown.
  if (!scan.models.length && scan.modelIds.length) scan.models = scan.modelIds.filter((item) => item.provider === ZEN_PROVIDER).map((item) => normalizeModelRecord(item.id, {}));
  const agents = await run("agents", SCAN_COMMANDS.agents);
  if (agents.ok) scan.agents = parseAgentList(agents.stdout);
  scan.ms = steps.reduce((sum, step) => sum + step.ms, 0);
  return scan;
}

// CLI: `node scripts/first-scan.mjs` prints the scan and the plan (no keys —
// pass the Studio's saved-key facts from the app when it runs there).
export async function cli(argv = process.argv.slice(2)) {
  const scan = await runFirstScan({ onStep: (step) => console.error(`[first-scan] ${step.id}: ${step.ok ? "ok" : step.error ?? `exit ${step.code}`} (${step.ms} ms)`) });
  const plan = planFirstRun({ scan, prefs: { allowFreeTraining: !argv.includes("--no-free") } });
  console.log(JSON.stringify(argv.includes("--raw") ? { scan, plan } : plan, null, 2));
  return plan.ok ? 0 : 1;
}

if (process.argv[1] && /first-scan\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  cli().then((code) => process.exit(code), (error) => { console.error(error); process.exit(2); });
}
