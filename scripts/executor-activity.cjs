// Bounded worker activity for the live UI. Output is evidence of what the
// worker reported, never completion evidence or an estimated percentage.
const { safeExcerpt } = require("./redaction.cjs");

function cleanActivity(value, max = 240) {
  if (typeof value !== "string") return "";
  const plain = value.slice(0, 8192)
    .replace(/\u001b\][^\u0007]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, "[redacted credential]")
    .replace(/\s+/g, " ").trim();
  return safeExcerpt(plain, Math.max(1, Math.min(240, Number(max) || 240)));
}

const SUCCESS_BOILERPLATE = /^(?:exit(?:[_ ]code)?\s*[:=]\s*0|(?:process|command)\s+(?:exited|finished|completed)\s+(?:(?:with\s+)?(?:exit\s+)?code\s*[:=]?\s*0|successfully)|success|done)[.!]?$/i;

function recordOutput(entry, line, now) {
  const text = cleanActivity(line);
  if (!text) return false;
  entry.lastOutputAt = now;
  // Key material can span several writes. Do not surface its body after the
  // BEGIN line was masked; the transcript remains owned by the executor.
  const beginsKey = /-----BEGIN .*PRIVATE KEY-----/.test(String(line));
  const endsKey = /-----END .*PRIVATE KEY-----/.test(String(line));
  if (beginsKey || entry.activityPrivateKey) {
    entry.activityPrivateKey = !endsKey;
    return false;
  }
  if (/^MEFI_(?:JOB_DONE|RESULT|NEXT|CALL|ASK)\b/.test(text)) return false;
  // A shell's successful exit is stream activity, but it should not replace
  // the useful step that preceded it. Keep failures and substantive results
  // (including test counts) visible, and retain output when it is all we have.
  const previous = cleanActivity(entry.activity?.text);
  if (previous && !SUCCESS_BOILERPLATE.test(previous) && SUCCESS_BOILERPLATE.test(text)) return false;
  entry.activity = { text, at: now };
  return true;
}

const stamp = (value) => Number.isFinite(value) && value > 0 ? value : null;
function workerActivity(entry, now = Date.now()) {
  const step = (Array.isArray(entry.todos) ? entry.todos : []).find((todo) => todo?.status === "in_progress");
  const tool = entry.activeTool;
  let currentTool = "";
  const settled = tool?.status === "timed_out";
  if (tool && (["running", "pending"].includes(tool.status) || settled)) {
    const name = cleanActivity(tool.tool, 40) || "Tool";
    const seconds = stamp(tool.startedAt) ? Math.max(0, Math.floor((now - tool.startedAt) / 1000)) : null;
    const elapsed = seconds === null ? "" : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
    const description = cleanActivity(tool.description) || (/\bStart-Process\b/i.test(String(tool.command || "")) ? "Starting a background process" : cleanActivity(tool.command, 160));
    const label = settled
      ? `${name[0].toUpperCase()}${name.slice(1)} stopped${elapsed ? ` after ${elapsed}` : ""}`
      : `${name[0].toUpperCase()}${name.slice(1)} ${tool.status === "pending" ? "queued" : "running"}`;
    currentTool = cleanActivity([label, settled ? "" : elapsed, description].filter(Boolean).join(" · "));
  }
  return {
    route: cleanActivity(entry.routeLabel, 80) || null,
    activity: cleanActivity(entry.activity?.text) || null,
    activityAt: stamp(entry.activity?.at),
    lastOutputAt: stamp(entry.lastOutputAt),
    currentStep: currentTool || cleanActivity(step?.content ?? step?.label ?? step?.title ?? step?.text) || null,
    stepUpdatedAt: currentTool ? stamp(tool.updatedAt) || stamp(tool.startedAt) : stamp(entry.todosUpdatedAt),
  };
}

module.exports = { cleanActivity, recordOutput, workerActivity };
