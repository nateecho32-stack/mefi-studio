// Mefi's Studio AI+ — optional local speed probe.
// Sends one small fixed prompt to a model and reports real tokens/second.
// Usage: node scripts/measure-speed.mjs --model deepseek-v4.1-flash      (OpenCode Go)
//        ZAI_API_KEY=... node scripts/measure-speed.mjs --model glm-5.3-flash (z.ai coding plan)

const modelIndex = process.argv.indexOf("--model");
const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : "deepseek-v4.1-flash";
const zai = model.startsWith("glm-");
const apiKey = zai ? process.env.ZAI_API_KEY : process.env.OPENCODE_GO_API_KEY || process.env.OPENCODE_API_KEY;
const sessionId = process.env.OPENCODE_GO_SESSION || `ses_mefi_${Math.random().toString(36).slice(2, 14)}`;
const ENDPOINT = zai ? "https://api.z.ai/api/coding/paas/v4/chat/completions" : "https://opencode.ai/zen/go/v1/chat/completions";
const PROMPT = "Write a single Lua function that returns the sum of two numbers. Code only.";

if (!apiKey) {
  console.error(zai ? "Set ZAI_API_KEY first." : "Set OPENCODE_GO_API_KEY (or OPENCODE_API_KEY) first.");
  process.exit(2);
}

const body = {
  model,
  messages: [{ role: "user", content: PROMPT }],
  max_tokens: 160,
  stream: false,
};
// glm-5.3 reasons on every request; cap the effort so the probe measures
// delivery instead of thinking time. The flash route uses its defaults.
if (model === "glm-5.3") {
  body.reasoning_effort = "low";
  body.thinking = { type: "enabled" };
}

const started = Date.now();
const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${apiKey}`,
  "user-agent": "mefi-studio/0.1 (A-Eyes speed probe)",
};
if (!zai) headers["x-opencode-session"] = sessionId;
const response = await fetch(ENDPOINT, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(120000),
});

if (!response.ok) {
  console.error(`HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  process.exit(1);
}

const payload = await response.json();
const elapsedMs = Date.now() - started;
const usage = payload.usage ?? {};
const completion = usage.completion_tokens ?? null;
const tokensPerSecond = completion > 0 ? completion / (elapsedMs / 1000) : null;

console.log(
  JSON.stringify(
    {
      model,
      elapsedMs,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: completion,
      totalTokens: usage.total_tokens ?? null,
      costUsd: typeof usage.cost_usd === "number" && Number.isFinite(usage.cost_usd) && usage.cost_usd >= 0 ? usage.cost_usd : null,
      tokensPerSecond: tokensPerSecond == null ? null : Number(tokensPerSecond.toFixed(1)),
      sample: (payload.choices?.[0]?.message?.content ?? "").slice(0, 120),
      measuredAt: new Date().toISOString(),
    },
    null,
    2
  )
);
