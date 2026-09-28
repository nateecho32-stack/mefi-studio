// One answer to "are my agents working, and if not, why?" Pure: main.cjs
// passes the switches and counts it already holds (autopilotStatus), and every
// surface — Home, Vibe, Command, Agents, the tray, the chat facts — paints this
// instead of re-deriving the paused and held states on its own. Those copies
// used to disagree: "Allow new work" read only the assistant's pause and
// showed on while the executor was off, and the launch hold never reached the
// Command header.
//
// The first gate that applies wins, in the order a person would fix them.
// `on` is the Agents switch: false only for the launch hold and the owner's
// pause or stop. A breaker cooldown, an update drain or a full machine keep
// the switch on and say what they are waiting for. `action` names the one
// control that clears the state; the renderer maps the id to its handler.
"use strict";

const LEVEL_WAIT = Object.freeze({
  ask: "Always ask is on, so every new task — yours too — waits for your OK.",
  accept: "Accept per task is on, so each new task waits for your OK before it builds.",
  elevated: "Elevated is on, so tasks agents propose wait for your OK.",
  auto: "These tasks wait for your OK.",
});

const clip = (value, max = 240) => {
  const text = value == null ? "" : String(typeof value === "object" ? value.text ?? value.reason ?? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const count = (value) => Math.max(0, Math.floor(Number(value) || 0));
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const clock = (ms) => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

function loopStatus(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const running = count(input.running);
  const counts = input.counts && typeof input.counts === "object" ? input.counts : {};
  const ready = count(counts.ready), approval = count(counts.approval), blocked = count(counts.blocked);
  const level = Object.hasOwn(LEVEL_WAIT, input.level) ? input.level : "auto";
  const waiting = clip(input.waiting);
  const parked = input.execute === false && Number(input.parkedUntil) > now;
  const result = (state, tone, headline, reason, action = null, on = true) => ({ state, tone, on, headline, reason, action, running, ready, approval, blocked });

  if (input.project === false) {
    return result("no-project", "warn", "No project open", "Open a project folder so agents have somewhere to work.", { id: "open-project", label: "Open a project" });
  }
  // With no AI connected, starting the agents only starts workers that fail,
  // so a held launch names the missing connection first. It is still the
  // launch hold: the switch reads off, and launchHold says so for the views
  // that label Start agents.
  if (input.held === true && !running && input.aiConnected === false) {
    return { ...result("setup", "warn", "No AI connected", `Connect an AI so agents can plan, chat and build.${ready || approval ? ` ${plural(ready + approval, "task")} will wait until then.` : ""} Agents stay off until you start them.`, { id: "connect-ai", label: "Connect an AI" }, false), launchHold: true };
  }
  if (input.held === true && !running) {
    return result("held", "warn", "Agents are off", `Studio opened with agents off.${ready || approval ? ` ${plural(ready + approval, "task")} will wait until you start them.` : " Nothing starts until you turn them on."}`, { id: "start", label: "Start agents" }, false);
  }
  if (input.assistantPaused === true || (input.execute === false && !parked)) {
    return result("paused", "held", "Agents paused", running ? `${plural(running, "worker")} can finish; nothing new starts until you resume.` : "Nothing new starts until you resume.", { id: "start", label: "Resume agents" }, false);
  }
  if (parked) {
    const why = clip(input.lastError, 160);
    return result("parked", "warn", "Agents are cooling down", `Workers failed to start several times in a row, so new starts wait until ${clock(Number(input.parkedUntil))}.${why ? ` Last error: ${why}` : ""}`, { id: "start", label: "Try now" });
  }
  if (input.updateHold) {
    return result("draining", "quiet", "Finishing work before an update", clip(input.updateHold));
  }
  if (input.foremanStuck === true) {
    return result("stuck", "warn", "The work scheduler is stuck", "Its last pass ran past its time limit and still holds its place, so no new work is handed out until it ends. Restarting Studio clears it.", { id: "restart", label: "Restart Studio" });
  }
  if (running) {
    const more = ready ? (waiting ? ` ${plural(ready, "more task")} waiting: ${waiting}` : ` ${ready} more ready.`) : "";
    return result("running", "busy", `${plural(running, "agent")} working`, more.trim());
  }
  if (ready && waiting) {
    return result("waiting", "quiet", `${plural(ready, "task")} waiting to start`, waiting);
  }
  if (ready) {
    return result("starting", "busy", "Starting work", `${plural(ready, "task")} ready; handing them to workers.`);
  }
  if (approval) {
    return result("approval", "warn", `${plural(approval, "task")} need${approval === 1 ? "s" : ""} your OK`, LEVEL_WAIT[level], { id: "review", label: "Review tasks" });
  }
  if (blocked) {
    return result("attention", "warn", `${plural(blocked, "task")} need${blocked === 1 ? "s" : ""} your review`, "They stopped after failed runs or holds. Open one to see why and what to do.", { id: "review", label: "Review tasks" });
  }
  if (input.aiConnected === false) {
    return result("setup", "warn", "No AI connected", "Connect an AI so agents can plan, chat and build.", { id: "connect-ai", label: "Connect an AI" });
  }
  return result("idle", "ok", "Agents are on", ["ask", "accept"].includes(level)
    ? "Nothing is queued. New tasks will wait for your OK before they build."
    : "Nothing is queued. New tasks start on their own.");
}

module.exports = { loopStatus, LEVEL_WAIT };
