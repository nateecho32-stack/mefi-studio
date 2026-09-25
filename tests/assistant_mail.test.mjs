// The agents talk to each other: mail between roster seats, pure in the
// module and delivered by the host. No Electron, timers, network or paid
// calls — the host helpers run from the real main.cjs source in a vm.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";

const NOW = 1_700_000_000_000;
const MINUTE = 60000;
// main.cjs is CRLF on disk; the section anchors below are written with \n.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

test("sendMail delivers one note between two seats and normalizes it", () => {
  const state = assistant.emptyState(NOW);
  const next = assistant.sendMail(state, { from: "watcher", to: "keeper", text: "  2 stale   sessions ", facts: { stale: 2, junk: { deep: true } } }, NOW);
  assert.equal(next.mail.length, 1);
  assert.match(next.mail[0].id, new RegExp(`^mail_${NOW}_watcher_keeper_`));
  assert.deepEqual(next.mail[0], { id: next.mail[0].id, at: NOW, from: "watcher", to: "keeper", text: "2 stale sessions", facts: { stale: 2 }, readAt: 0 });
  assert.equal(state.mail.length, 0, "pure: the input state is untouched");
});

test("undeliverable notes leave the state alone", () => {
  const state = assistant.emptyState(NOW);
  assert.equal(assistant.sendMail(state, { from: "ghost", to: "keeper", text: "hi" }, NOW), state, "unknown sender");
  assert.equal(assistant.sendMail(state, { from: "watcher", to: "builder", text: "hi" }, NOW), state, "a builder is not a roster seat");
  assert.equal(assistant.sendMail(state, { from: "watcher", to: "watcher", text: "hi" }, NOW), state, "a seat never writes to itself");
  assert.equal(assistant.sendMail(state, { from: "watcher", to: "keeper", text: "   " }, NOW), state, "empty text");
  assert.equal(assistant.sendMail(state, null, NOW), state);
});

test("builders and the assistant can write; a repeated unread note refreshes rather than duplicates", () => {
  let state = assistant.sendMail(assistant.emptyState(NOW), { from: "builder", to: "auditor", text: "finished the login fix — follow it up" }, NOW);
  state = assistant.sendMail(state, { from: "assistant", to: "foreman", text: "start the pinned task" }, NOW + 1);
  state = assistant.sendMail(state, { from: "builder", to: "auditor", text: "finished the login fix — follow it up" }, NOW + 5 * MINUTE);
  assert.equal(state.mail.length, 2);
  const note = state.mail.find((row) => row.to === "auditor");
  assert.equal(note.at, NOW + 5 * MINUTE, "the repeat moved the clock, not the count");
});

test("an inbox is bounded per recipient and the box overall", () => {
  let state = assistant.emptyState(NOW);
  for (let i = 0; i < assistant.MAIL_UNREAD_PER_ROLE + 3; i += 1) state = assistant.sendMail(state, { from: "watcher", to: "keeper", text: `note ${i}` }, NOW + i);
  const unread = assistant.inbox(state, "keeper");
  assert.equal(unread.length, assistant.MAIL_UNREAD_PER_ROLE);
  assert.equal(unread[0].text, "note 3", "the oldest unread notes were dropped first");
  for (let i = 0; i < assistant.MAIL_CAP + 10; i += 1) state = assistant.sendMail(state, { from: "machine", to: i % 2 ? "foreman" : "thinker", text: `cap ${i}` }, NOW + 100 + i);
  assert.ok(state.mail.length <= assistant.MAIL_CAP, `capped at ${assistant.MAIL_CAP}: ${state.mail.length}`);
});

test("readMail hands the unread notes over once, oldest first, and marks them read", () => {
  let state = assistant.sendMail(assistant.emptyState(NOW), { from: "watcher", to: "keeper", text: "second" }, NOW + 2);
  state = assistant.sendMail(state, { from: "machine", to: "keeper", text: "first" }, NOW + 1);
  state = assistant.sendMail(state, { from: "machine", to: "foreman", text: "not yours" }, NOW + 3);
  const first = assistant.readMail(state, "keeper", NOW + 10);
  assert.deepEqual(first.mail.map((row) => row.text), ["first", "second"]);
  assert.ok(first.mail.every((row) => row.readAt === 0), "the job sees the notes as they were");
  assert.ok(first.state.mail.filter((row) => row.to === "keeper").every((row) => row.readAt === NOW + 10));
  assert.equal(assistant.inbox(first.state, "foreman").length, 1, "another seat's mail is untouched");
  const again = assistant.readMail(first.state, "keeper", NOW + 20);
  assert.equal(again.mail.length, 0, "a second run gets nothing");
  assert.equal(again.state, first.state, "nothing to change, same state");
  assert.equal(assistant.inbox(first.state, "keeper", { unreadOnly: false }).length, 2);
});

// Mail used to pull every recipient due, and most of them never read it: the
// watcher's stale-session note ran the keeper every 2 minutes instead of every
// 10. Only a seat whose job consumes its inbox (readsMail) is pulled now; the
// rest take their notes when their own cadence starts them.
test("unread mail pulls due only a seat that reads it; a running seat waits; the rest keep their cadence", () => {
  const ranNow = (state) => ({ ...state, agents: state.agents.map((row) => ({ ...row, lastRunAt: NOW, runs: 1 })) });
  const quiet = ranNow(assistant.emptyState(NOW));
  // Twenty seconds on: inside every cadence, so only mail can make a seat due.
  const SOON = NOW + 20000;
  assert.deepEqual(assistant.dueRoles(quiet, SOON), [], "nothing is due twenty seconds after every seat ran");
  assert.deepEqual(assistant.AGENT_ROLES.filter((row) => row.readsMail).map((row) => row.role), ["foreman"], "the foreman is the one seat that acts on its notes");
  const mailed = assistant.sendMail(quiet, { from: "machine", to: "foreman", text: "holding new starts" }, SOON);
  assert.deepEqual(assistant.rolesWithMail(mailed), ["foreman"]);
  assert.deepEqual(assistant.dueRoles(mailed, SOON), ["foreman"], "the foreman runs now, not at its next minute");
  const running = assistant.applyAgentEvent(mailed, { role: "foreman", status: "running", at: SOON });
  assert.deepEqual(assistant.rolesWithMail(running), [], "a running seat takes its mail when it starts");
  assert.ok(!assistant.dueRoles(running, SOON).includes("foreman"));
  const read = assistant.readMail(mailed, "foreman", SOON).state;
  assert.deepEqual(assistant.dueRoles(read, SOON), [], "read mail no longer pulls");
  const toKeeper = assistant.sendMail(quiet, { from: "watcher", to: "keeper", text: "2 stale sessions" }, SOON);
  assert.deepEqual(assistant.rolesWithMail(toKeeper), ["keeper"], "the note waits in the keeper's inbox");
  assert.deepEqual(assistant.dueRoles(toKeeper, SOON), [], "the keeper ignores its inbox, so the note does not jump its ten-minute cadence");
  assert.ok(assistant.dueRoles(toKeeper, NOW + 10 * MINUTE).includes("keeper"), "on its own cadence the keeper runs and takes the note");
  const toBriefer = assistant.sendMail(quiet, { from: "auditor", to: "briefer", text: "3 errors" }, SOON);
  assert.ok(!assistant.dueRoles({ ...toBriefer, ai: { ...toBriefer.ai, keyPresent: true } }, SOON).includes("briefer"), "a note to a seat that ignores it pulls nothing, key or not");
});

test("mail survives a save/load round trip; junk is dropped; read notes age out", () => {
  const state = assistant.sendMail(assistant.emptyState(NOW), { from: "watcher", to: "keeper", text: "keep me" }, NOW);
  const loaded = assistant.normalizeState(JSON.parse(JSON.stringify(state)), NOW);
  assert.deepEqual(loaded.mail, state.mail);
  assert.deepEqual(assistant.normalizeState({ ...loaded, mail: [{ from: "nope", to: "keeper", text: "x" }, "junk", null] }, NOW).mail, []);
  assert.deepEqual(assistant.normalizeState({ version: 1 }, NOW).mail, [], "an old save without mail loads with an empty box");
  const read = assistant.readMail(state, "keeper", NOW).state;
  const later = assistant.sendMail(read, { from: "machine", to: "foreman", text: "fresh" }, NOW + 2 * 60 * MINUTE);
  assert.deepEqual(later.mail.map((row) => row.text), ["fresh"], "an hour-old read note is gone");
});

test("the conversation reads as lines: chat, digest and facts", () => {
  let state = assistant.sendMail(assistant.emptyState(NOW), { from: "watcher", to: "keeper", text: "2 stale sessions" }, NOW - 3 * MINUTE);
  state = assistant.sendMail(state, { from: "machine", to: "foreman", text: "holding new starts" }, NOW - MINUTE);
  state = assistant.readMail(state, "keeper", NOW - 2 * MINUTE).state;
  const lines = assistant.mailLines(state, NOW);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^machine → foreman: holding new starts \(unread\)/);
  assert.match(lines[1], /^watcher → keeper: 2 stale sessions \(/);
  assert.ok(!lines[1].includes("unread"));
  assert.equal(assistant.mailLines(state, NOW, { role: "foreman" }).length, 1);
  assert.equal(assistant.mailLines(state, NOW + 2 * 60 * MINUTE).length, 0, "old lines drop out");
  const digest = assistant.overseerDigest(state, NOW);
  assert.equal(digest.chatter.unread, 1);
  assert.equal(digest.chatter.lines.length, 2);
  assert.equal(assistant.buildFacts({ mail: state.mail, now: NOW }).chatter.length, 2);
  assert.equal(assistant.buildFacts({ now: NOW }).chatter, null);
  const reply = assistant.localReply({ text: "how are the agents", intent: "agents", state, now: NOW });
  assert.match(JSON.stringify(reply), /Said to each other: machine → foreman: holding new starts/);
});

// ---- the host half: send, deliver and take, from the real main.cjs ----
// The mail rows are the record and the push draws the packet; the activity
// log is the chat's window on outcomes, so mail no longer writes to it (it
// crowded the chat's facts.log window out).
function mailHost() {
  const log = [], pushed = [];
  const env = vm.createContext({
    console, SMOKE: false,
    assistantModule: assistant,
    assistantState: assistant.emptyState(NOW),
    Date: class extends Date { static now() { return NOW; } },
    logLine: (text) => log.push({ kind: "line", text }),
    assistantLog(kind, text, extra = null, role = null) { log.push({ kind, text, extra, role }); },
    assistantEmit(event) { pushed.push(JSON.parse(JSON.stringify(event))); },
  });
  vm.runInContext(section("function assistantSendMail(", "// An executor run reports home while it is still on the board"), env);
  return { env, log, pushed };
}

test("host: assistantSendMail records the note, pushes the packet with sender and recipient, keeps it out of the log, and refuses junk", () => {
  const { env, log, pushed } = mailHost();
  assert.equal(vm.runInContext('assistantSendMail("watcher", "keeper", "  2 stale  sessions ", { stale: 2 })', env), true);
  assert.equal(env.assistantState.mail.length, 1);
  assert.equal(env.assistantState.mail[0].text, "2 stale sessions");
  assert.deepEqual(pushed[0], { at: NOW, kind: "mail", text: "watcher → keeper: 2 stale sessions", role: "watcher", from: "watcher", to: "keeper", note: "2 stale sessions" });
  assert.deepEqual(log, [], "a sent note is not an activity-log row");
  assert.deepEqual(env.assistantState.log, [], "nor a row in the state's log the chat reads");
  assert.equal(vm.runInContext('assistantSendMail("watcher", "ghost", "nobody home")', env), false);
  assert.equal(vm.runInContext('assistantSendMail("watcher", "keeper", "")', env), false);
  assert.equal(env.assistantState.mail.length, 1);
  assert.equal(pushed.length, 1, "nothing pushed for a note that did not go");
});

test("host: assistantDeliverMail sends at most three of a job's notes under its own role", () => {
  const { env } = mailHost();
  const sent = vm.runInContext('assistantDeliverMail("auditor", [{ to: "foreman", text: "2 fixes queued" }, null, { to: "nowhere", text: "x" }, { to: "machine", text: "a" }, { to: "keeper", text: "b" }, { to: "thinker", text: "never reached" }])', env);
  assert.equal(sent, 3, "three go out; the junk ones do not count against it");
  assert.deepEqual(env.assistantState.mail.map((row) => `${row.from}→${row.to}`), ["auditor→foreman", "auditor→machine", "auditor→keeper"]);
  assert.equal(vm.runInContext('assistantDeliverMail("auditor", "not a list")', env), 0);
});

test("host: assistantTakeMail hands a starting job its unread notes once and pushes the read, not a log row", () => {
  const { env, log, pushed } = mailHost();
  vm.runInContext('assistantSendMail("watcher", "keeper", "2 stale sessions"); assistantSendMail("machine", "keeper", "3 killed")', env);
  const taken = vm.runInContext('assistantTakeMail("keeper")', env);
  assert.deepEqual(taken.map((row) => row.text), ["2 stale sessions", "3 killed"]);
  assert.ok(env.assistantState.mail.every((row) => row.readAt === NOW));
  const read = pushed.at(-1);
  assert.equal(read.kind, "mail");
  assert.equal(read.role, "keeper");
  assert.equal(read.from, undefined, "a read carries no sender, so the trees draw no second packet");
  assert.equal(read.to, "keeper");
  assert.equal(read.read, 2);
  assert.match(read.text, /^keeper read 2 note\(s\): watcher: 2 stale sessions · machine: 3 killed/);
  assert.deepEqual(vm.runInContext('assistantTakeMail("keeper")', env), [], "a second start finds nothing");
  assert.equal(pushed.length, 3, "an empty read is not pushed");
  assert.deepEqual(log, [], "neither sends nor reads write the activity log");
});

test("host wiring: jobs take mail as they start, notes go out as they settle, the roster writes to itself, and the trees draw it", async () => {
  const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
  const tree = await readFile(new URL("../renderer/tree3d.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../renderer/styles.css", import.meta.url), "utf8");
  assert.match(section("function assistantStart(entry)", "function assistantTimeout"), /entry\.inbox = assistantTakeMail\(entry\.role\)/);
  assert.match(section("function assistantSettle(entry", "function assistantDrain"), /assistantDeliverMail\(entry\.role, result\?\.messages\)/);
  assert.match(source, /mail: 3/, "a note ranks with a report home when pushes coalesce");
  for (const [job, to] of [["assistantWatcherJob", "keeper"], ["assistantWatcherJob", "auditor"], ["assistantMachineJob", "foreman"], ["assistantAuditorJob", "foreman"], ["assistantKeeperJob", "compactor"], ["assistantCompactorJob", "foreman"], ["assistantForemanJob", "thinker"]]) {
    assert.ok(section(`async function ${job}(`, "\n}\n").includes(`to: "${to}"`), `${job} writes to the ${to}`);
  }
  assert.match(source, /assistantSendMail\("overseer", role, talk\.say/, "the overseer says why it woke a seat");
  assert.match(source, /assistantSendMail\("builder", role, /, "a builder's call says what it wants");
  assert.match(source, /chatter: assistantModule\.mailLines\(assistantState/, "the AI passes see the exchange");
  assert.ok(source.includes('"messages":[{"to":"watcher|machine'), "the prompts describe the reply key");
  assert.ok(idle.includes('kind === "mail"') && idle.includes("Said to each other"), "the Command view draws and lists it");
  assert.ok(tree.includes('event.kind === "mail"'), "the 3D tree draws it");
  assert.ok(styles.includes(".assistant-mail"), "the list is styled");
});
