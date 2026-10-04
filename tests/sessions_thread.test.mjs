// The thread of Build's desktop inside the 0.5 frame (renderer/sessions.js, the main area): the selected task's title and chips, what
// it was asked to do, every run and what it said, the live line, the question that waits on you, what Mefi decided, the banners, the
// pictures and before / after shots a thread carries and the lightbox they open in, and the box at the foot that takes a Note, an Ask
// or a Change. The real renderer/builder.js runs underneath; the host, the shell and the pictures' and picker's modules are stand-ins
// that record what they are asked (tests/fixtures/sessions-env.mjs). Geometry and real focus are tests/sessions_render.test.mjs's.
import test from "node:test";
import assert from "node:assert/strict";

import { sessionsApp, task, bridge, at, mins, clean, NOW, PICTURE, DATA_URL } from "./fixtures/sessions-env.mjs";

const attempt = (extra = {}) => ({ runId: "run_1", startedAt: mins(40), via: "Claude Code", fallbacks: [], finishedAt: mins(14), ok: true, stopped: false, stoppedAtLimit: false, limitMinutes: 25, seconds: 1560, result: "Added the button.", tail: ["$ npm test", "ok"], release: null, outcome: "finished-ok", ...extra });
const picture = (n, extra = {}) => ({ ok: true, id: PICTURE(n), name: `pic${n}.png`, mime: "image/png", bytes: 100, width: 640, height: 400, dataUrl: DATA_URL(`pic${n}`), ...extra });
const open = async (id, options = {}) => {
  const a = await sessionsApp(options);
  await a.settle();
  a.S.select(id, { route: false });
  await a.settle(4);
  return a;
};
const texts = (nodes) => nodes.map((node) => node.textContent.trim());
const feed = (a) => a.all("main", ".sx-feed .sx-item");
const asks = (a) => a.all("main", "#sessions-dock .sx-ask");
const fullCard = (a) => asks(a).find((node) => !node.classList.contains("mini")) ?? null;
const miniCard = (a) => asks(a).find((node) => node.classList.contains("mini")) ?? null;

// ---- the head ------------------------------------------------------------------------------------------------------------------------

test("the head has the title, where the task stands, who is on it, where it runs, its checks and when it began", async () => {
  const worktrees = { state: () => ({ list: { repo: true, rows: [{ kind: "run", branch: "mefi/tags", task: { taskId: "t1" } }] } }), summary: () => ({ repo: true, tasks: ["t1"] }), peek: () => Promise.resolve() };
  const row = task("t1", { title: "Search notes by tag", status: "active", runId: "r1", createdAt: mins(35), priority: "high", verificationRun: { results: [{ ok: true }, { ok: false }, { ok: null }] } });
  const a = await open("t1", { tasks: [row], running: [{ taskId: "t1", runId: "r1", route: "Claude Code", currentStep: "Writing" }], worktrees });
  assert.equal(a.text("main", "#sessions-head .sx-title"), "Search notes by tag");
  const chips = a.all("main", "#sessions-head .sx-chip");
  assert.deepEqual(texts(chips), ["Working", "Claude Code", "mefi/tags", "Checks 1 of 3", "Started 35m ago", "high priority"]);
  assert.equal(chips[0].dataset.tone, "run", "the first chip is the status, in the tone its dot is drawn in");
  assert.ok(chips[2].querySelector(".glyph"), "the branch chip has its mark");
  assert.equal(chips[2].title, "Runs in its own worktree");
});

test("the head offers what builder.js offers for the task, a pin, the task board and Drop, all as the list and the other layout do", async () => {
  const a = await open("ready", { tasks: [task("ready", { title: "Ready one" }), task("ask"), task("done", { status: "done", doneAt: at(1) }), task("work", { status: "active", runId: "r" })], running: [{ taskId: "work", runId: "r" }], preview: { phase: "ready" } });
  const labels = () => texts(a.all("main", "#sessions-head .sx-actions button"));
  assert.deepEqual(labels(), ["Start", "", "", "Drop"], "a task that is ready: Start, the pin, the board, Drop");
  assert.equal(a.all("main", "#sessions-head .sx-actions button")[1].getAttribute("aria-label"), "Pin this session");
  assert.equal(a.all("main", "#sessions-head .sx-actions button")[2].getAttribute("aria-label"), "Open on the task board");
  a.S.select("done", { route: false }); await a.settle(4);
  assert.deepEqual(labels(), ["Open app", "Request a change", "", ""], "a finished one: open the app, ask for a change; no Drop");
  a.S.select("work", { route: false }); await a.settle(4);
  assert.deepEqual(labels(), ["Stop", "Watch live", "", ""], "a running one: Stop and Watch live; no Drop while a worker holds it");
  assert.equal(a.one("main", '#sessions-head [data-spec="stop"]').disabled, false);
  // The pin is builder.js's.
  const pin = a.all("main", "#sessions-head .sx-actions button")[2];
  await pin.click(); await a.settle();
  assert.ok(a.B.pins().has("work")); assert.equal(a.all("main", "#sessions-head .sx-actions button")[2].getAttribute("aria-pressed"), "true");
  assert.equal(a.all("main", "#sessions-head .sx-actions button")[2].getAttribute("aria-label"), "Unpin this session");
  // The task board is one press away.
  await a.all("main", "#sessions-head .sx-actions button")[3].click();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["tasks", { taskId: "work", projectId: "p1", filter: "all", board: true }], "with board: true so it is not sent back here");
});

test("Start and Stop and Try again are the host calls the other layout makes, behind the same two presses; a second action waits for the first", async () => {
  const a = await open("work", { tasks: [task("work", { status: "active", runId: "r" }), task("bad", { verification: { state: "failed", reason: "no" } })], running: [{ taskId: "work", runId: "r" }], stages: { bad: "blocked" } });
  const stop = a.one("main", '[data-spec="stop"]');
  await stop.click();
  assert.equal(stop.textContent, "Stop it?", "the first press asks");
  assert.equal(a.api.of("tasksAction").length, 0);
  await stop.click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksAction")), [["tasksAction", { taskId: "work", projectId: "p1", action: "stop" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Stopped/);
  assert.equal(a.calls.refresh >= 1, true, "and the board is read again");
  a.S.select("bad", { route: false }); await a.settle(4);
  await a.one("main", '[data-spec="retry"]').click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksAction").at(-1)), ["tasksAction", { taskId: "bad", projectId: "p1", action: "retry" }]);
});

// ---- the feed ------------------------------------------------------------------------------------------------------------------------

test("the brief is the first thing in the feed: its words, the pictures it names (not their paths) and what it is done when", async () => {
  const pic = PICTURE(1), other = PICTURE(2);
  const prompt = `Show an empty state.\n\nThe owner attached empty.png at /proj/.mefi/attachments/${pic}.png\nThe owner attached bar.png at C:\\proj\\.mefi\\attachments\\${other}.png\n\nKeep the toolbar.`;
  const a = await open("t1", { tasks: [task("t1", { prompt, acceptance: ["The list says No notes yet", "Tests pass"] })], api: bridge({ pictures: { [pic]: picture(1, { name: "empty.png", id: pic }), [other]: picture(2, { name: "bar.png", id: other }) } }) });
  const first = feed(a)[0];
  assert.ok(first.classList.contains("is-brief"));
  const words = first.querySelector(".sx-text").textContent;
  assert.match(words, /Show an empty state\./); assert.match(words, /Keep the toolbar\./);
  assert.doesNotMatch(words, /attached|\.mefi|attachments|img_/, "no path and no id is shown as text");
  assert.deepEqual(clean(a.api.of("assistantImageRead")), [["assistantImageRead", { id: pic }], ["assistantImageRead", { id: other }]], "each picture is read back by its opaque id, and nothing else is asked");
  const thumbs = first.querySelectorAll(".sx-thumb");
  assert.equal(thumbs.length, 2); assert.equal(thumbs[0].querySelector("img").getAttribute("src"), DATA_URL("pic1"));
  assert.equal(thumbs[0].querySelector("img").getAttribute("alt"), "empty.png"); assert.match(thumbs[0].querySelector(".sx-thumb-cap").textContent, /empty\.png · 640 × 400/);
  assert.equal(thumbs[0].getAttribute("aria-label"), "Open empty.png larger");
  assert.deepEqual(texts(first.querySelectorAll(".sx-list-plain li")), ["The list says No notes yet", "Tests pass"], "what it is done when, from the task's own acceptance lines");
  // The brief's own "Done when" is not said twice.
  const again = await open("t2", { tasks: [task("t2", { prompt: "Do it.\n\nDone when:\n- it works", acceptance: ["it works"] })] });
  assert.equal(feed(again)[0].querySelectorAll(".sx-list-plain").length, 0);
});

test("a picture that cannot be read says why, in words, instead of leaving a hole; a host without the call says it is the desktop app's", async () => {
  const pic = PICTURE(3);
  const a = await open("t1", { tasks: [task("t1", { prompt: `Look at this.\nThe owner attached x.png at /p/${pic}.png` })], api: bridge({ pictures: {} }) });
  assert.match(feed(a)[0].querySelector(".sx-thumb").textContent, /x\.png · That picture is no longer saved\./);
  assert.equal(feed(a)[0].querySelector(".sx-thumb").tagName, "span", "it is a line, not a button that opens nothing");
  const off = await open("t1", { tasks: [task("t1", { prompt: `Look.\nThe owner attached x.png at /p/${pic}.png` })], api: bridge({ pictures: { [pic]: { ok: false, off: true, error: "PICTURES_OFF (the host's own wording)" } } }) });
  assert.match(feed(off)[0].querySelector(".sx-thumb").textContent, /x\.png · Pictures are switched off on this PC\./, "the switch is named in the thread's words, whatever the host adds");
  assert.doesNotMatch(feed(off)[0].querySelector(".sx-thumb").textContent, /PICTURES_OFF/);
  const bare = await sessionsApp({ tasks: [task("t1", { prompt: `Look.\nThe owner attached x.png at /p/${pic}.png` })] });
  delete bare.api.assistantImageRead;
  await bare.settle(); bare.S.select("t1", { route: false }); await bare.settle(4);
  assert.match(feed(bare)[0].querySelector(".sx-thumb").textContent, /part of the desktop app/);
});

test("pictures are read three at a time, the rest wait their turn, and the oldest ones are let go when a thread holds too many bytes", async () => {
  const ids = [1, 2, 3, 4].map(PICTURE);
  const pictures = Object.fromEntries(ids.map((id, index) => [id, picture(index + 1, { id })]));
  const prompt = ids.map((id, index) => `The owner attached p${index}.png at /p/${id}.png`).join("\n");
  const a = await sessionsApp({ tasks: [task("t1", { prompt })], api: bridge({ pictures, holdPictures: true }) });
  await a.settle(); a.S.select("t1", { route: false }); await a.settle(4);
  assert.equal(a.api.of("assistantImageRead").length, 3, "three reads at once");
  a.api.state.held.splice(0).forEach((release) => release()); await a.settle(6);
  assert.equal(a.api.of("assistantImageRead").length, 4, "the fourth starts when a slot frees");
  a.api.state.held.splice(0).forEach((release) => release()); await a.settle(6);
  assert.equal(feed(a)[0].querySelectorAll("button.sx-thumb").length, 4, "all four show (four is what a brief shows)");
  // The budget: a thread never holds more than about forty million characters of pictures.
  const huge = "data:image/png;base64," + "A".repeat(30e6);
  const big = Object.fromEntries([5, 6, 7].map((n) => [PICTURE(n), picture(n, { id: PICTURE(n), dataUrl: huge })]));
  const b = await sessionsApp({ tasks: [task("a", { prompt: `The owner attached a.png at /p/${PICTURE(5)}.png` }), task("b", { prompt: `The owner attached b.png at /p/${PICTURE(6)}.png` }), task("c", { prompt: `The owner attached c.png at /p/${PICTURE(7)}.png` })], api: bridge({ pictures: big }) });
  await b.settle();
  for (const id of ["a", "b", "c"]) { b.S.select(id, { route: false }); await b.settle(5); }
  b.S.select("a", { route: false }); await b.settle(5);
  assert.ok(b.api.of("assistantImageRead").length >= 4, "a picture that was let go is read again when its thread comes back");
});

test("a note, an ask and its answer are in the feed in the order they happened; an ask that carried a picture shows it; one that is still out says so", async () => {
  const pic = PICTURE(4);
  const messages = [
    { id: "m1", role: "user", text: 'About the task "Task t1" (t1): Does this match?', at: mins(30), projectId: "p1", images: [{ id: pic, name: "toolbar.png" }] },
    { id: "m2", role: "assistant", text: "Yes, it does.", at: mins(29), projectId: "p1" },
    { id: "m3", role: "user", text: 'About the task "Task t2" (t2): Something else', at: mins(28), projectId: "p1" },
    { id: "m3b", role: "user", text: 'About the task "Task t1" (t1): Asked in another project', at: mins(27), projectId: "p9" },
    { id: "m3c", role: "user", text: 'About the task "Task t1" (t1): Asked before messages kept their project', at: mins(20) },
    { id: "m4", role: "user", text: 'About the task "Task t1" (t1): And now?', at: mins(10), projectId: "p1" },
    { id: "m5", role: "assistant", text: "Not yet.", at: mins(9), projectId: "p1", kind: "notice-not" },
    { id: "m6", role: "assistant", text: "A notice", at: mins(8), projectId: "p1", kind: "notice", taskId: "t1" },
  ];
  const row = task("t1", { createdAt: mins(60), logs: [{ at: mins(45), kind: "note", text: "Prefer rounded corners" }, { at: mins(44), kind: "result", text: "Checked it" }, { at: mins(43), kind: "log", text: "Picked up by a worker" }, { at: mins(42), text: "task created" }] });
  const a = await open("t1", { tasks: [row, task("t2")], messages, api: bridge({ pictures: { [pic]: picture(4, { id: pic, name: "toolbar.png" }) } }) });
  assert.deepEqual(feed(a).map((node) => node.className.replace("sx-item ", "")), ["is-brief", "is-note", "is-result", "is-log", "is-ask", "is-ask", "is-ask", "is-notice"], "in the order they happened, and nothing about the other task or another project's words");
  const asks = feed(a).filter((node) => node.classList.contains("is-ask"));
  assert.match(asks[0].textContent, /Does this match\?/); assert.match(asks[0].textContent, /Yes, it does\./);
  assert.ok(asks[0].querySelector(".sx-thumb img"), "the picture the question carried shows under it");
  assert.match(asks[1].textContent, /before messages kept their project/, "a message with no project on it is this project's");
  assert.match(asks[2].textContent, /And now\?/); assert.match(asks[2].textContent, /Not yet\./);
  assert.doesNotMatch(feed(a).map((node) => node.textContent).join("|"), /another project/);
  assert.match(feed(a)[1].textContent, /Prefer rounded corners/); assert.match(feed(a)[1].textContent, /Note/);
  assert.doesNotMatch(feed(a).map((node) => node.textContent).join("|"), /task created/i, "the bookkeeping line is left out");
  // A question that has been sent and not answered, and one that failed.
  const local = await open("t1", { tasks: [task("t1")] });
  await local.one("main", "#sessions-input").trigger("input");
  local.one("main", "#sessions-input").value = "Is it done?";
  local.api.state.reply = new Promise(() => {});
  local.api.assistantMessage = () => new Promise(() => {});
  await local.one("main", "#sessions-intent-ask").click();
  local.one("main", "#sessions-input").value = "Is it done?";
  await local.one("main", "#sessions-input").trigger("input");
  await local.one("main", "#sessions-compose").trigger("submit"); await local.settle(4);
  assert.match(feed(local).at(-1).textContent, /Is it done\?/); assert.match(feed(local).at(-1).textContent, /Mefi is thinking…/);
});

test("each run is a card: how it began, what it fell back to, how it ended and what it said; a live run is marked working now", async () => {
  const attempts = [
    attempt({ runId: "a1", startedAt: mins(120), finishedAt: mins(100), ok: false, outcome: "failed", error: "The worker crashed.", result: "", tail: [], seconds: 1200 }),
    attempt({ runId: "a2", startedAt: mins(90), finishedAt: mins(70), stopped: true, stoppedAtLimit: true, limitMinutes: 25, ok: false, outcome: "stopped", result: "", seconds: 1500 }),
    attempt({ runId: "a3", startedAt: mins(60), finishedAt: null, outcome: "unrecorded", ok: null, result: "", tail: [], fallbacks: [{ at: mins(59), reason: "the first worker was busy" }] }),
    attempt({ runId: "a4", startedAt: mins(20), release: { at: mins(19), reason: "the claim was dropped" }, finishedAt: null, outcome: "released", result: "", tail: [] }),
  ];
  const a = await open("t1", { tasks: [task("t1", { status: "active", runId: "a3", createdAt: mins(200) })], running: [{ taskId: "t1", runId: "a3", currentStep: "Writing", route: "Claude Code" }], api: bridge({ attempts: { t1: attempts } }) });
  const runs = a.all("main", ".sx-feed .sx-run");
  assert.equal(runs.length, 4);
  assert.deepEqual(runs.map((node) => node.dataset.outcome), ["failed", "stopped", "running", "released"]);
  const steps = (node) => texts(node.querySelectorAll(".sx-step-label"));
  assert.deepEqual(steps(runs[0]), ["Started on Claude Code", "Failed · took 20m"]);
  assert.deepEqual(steps(runs[1]), ["Started on Claude Code", "Stopped at the 25 minute limit · took 25m"]);
  assert.deepEqual(steps(runs[2]), ["Started on Claude Code", "Fell back to the next worker · the first worker was busy", "Working now"]);
  assert.deepEqual(steps(runs[3]), ["Started on Claude Code", "Released: the claim was dropped"]);
  assert.equal(runs[0].querySelector(".sx-why").textContent, "The worker crashed.");
  assert.equal(runs[2].querySelector(".sx-chip").textContent, "Working now");
  assert.deepEqual(runs.map((node) => node.querySelector(".sx-step.ok, .sx-step.bad, .sx-step.warn, .sx-step.go, .sx-step.no")?.className), runs.map((node) => node.querySelector(".sx-step").className), "each step carries its state");
  const done = await open("t1", { tasks: [task("t1", { status: "done", doneAt: at(1) })], api: bridge({ attempts: { t1: [attempt()] } }) });
  const card = done.one("main", ".sx-feed .sx-run");
  assert.match(card.querySelector(".sx-result").textContent, /Added the button\./, "what it reported");
  assert.equal(card.querySelector(".sx-said summary").textContent, "What it said");
  assert.match(card.querySelector(".sx-said pre").textContent, /\$ npm test\nok/, "and what it printed");
  assert.equal(card.querySelector(".sx-chip").textContent, "Reported done");
});

test("a run that is working shows the live line: what it is doing, since when and how far, with its latest output under it", async () => {
  const row = task("t1", { status: "active", runId: "r1", runProgress: { outputTail: ["a", "b", "c"] } });
  const a = await open("t1", { tasks: [row], running: [{ taskId: "t1", runId: "r1", currentStep: "Writing parseTags()", route: "Claude Code", startedAt: mins(31), progress: 0.6 }] });
  const now = a.one("main", ".sx-now");
  assert.equal(now.getAttribute("role"), "status");
  assert.match(now.querySelector(".sx-now-words").textContent, /^Working now · Writing parseTags\(\)$/);
  assert.match(now.querySelector(".sx-now-r").textContent, /^since .* · 31m$/);
  assert.equal(now.querySelector("progress").value, 0.6); assert.match(now.querySelector("progress").getAttribute("aria-label"), /60 percent/);
  assert.equal(a.one("main", ".sx-live pre").textContent, "a\nb\nc");
  assert.equal(a.one("main", ".sx-live").open, true, "the live output is open while it works");
  // Phases and a stop in progress change the word.
  a.data.status.running = [{ taskId: "t1", runId: "r1", phase: "preparing", activity: "Setting up", startedAt: mins(1) }]; a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.match(a.one("main", ".sx-now-words").textContent, /^Preparing · Setting up$/);
  a.data.status.running = [{ taskId: "t1", runId: "r1", stopping: true, startedAt: mins(1) }]; a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.match(a.one("main", ".sx-now-words").textContent, /^Stopping safely · Waiting for the worker's first line$/);
  a.data.status.running = []; a.data.tasks = [task("t1", { status: "open" })]; a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.equal(a.one("main", ".sx-now"), null, "nothing is live when nothing runs");
});

// ---- the question that waits on you ------------------------------------------------------------------------------------------------------

const asking = (extra = {}) => ({ id: "q1", status: "open", title: "Should it also handle search?", detail: "There are two ways.", at: mins(4), context: { taskId: "t1", suggestion: { optionId: "yes", reason: "it is the same component" }, evidence: ["NotesList renders it", "search reuses it"] }, options: [{ id: "only", label: "Only when there are no notes", description: "Keep it small" }, { id: "yes", label: "Yes, reuse it", recommended: true }], ...extra });
const withQuestion = (options = {}) => open("t1", { tasks: [task("t1", { status: "active", runId: "r" })], running: [{ taskId: "t1", runId: "r" }], questions: [asking()], ...options });

test("a question is docked above the box: its words, what Mefi suggests and why, the recommended option first, a free answer and Decide later", async () => {
  const a = await withQuestion();
  const card = fullCard(a);
  assert.ok(card, "it is docked where it is never hunted for");
  assert.equal(card.querySelector(".sx-ask-k").textContent, "Needs your answer · waiting 4m");
  assert.equal(card.querySelector(".sx-ask-q").textContent, "Should it also handle search?");
  assert.equal(card.querySelector(".sx-ask-detail").textContent, "There are two ways.");
  assert.equal(card.querySelector(".sx-ask-suggest").textContent, "Mefi suggests “Yes, reuse it”: it is the same component", "a suggestion is named, never acted on");
  assert.deepEqual(texts(card.querySelectorAll(".sx-ask-evidence li")), ["NotesList renders it", "search reuses it"]);
  const buttons = card.querySelectorAll(".sx-ask-opts button");
  assert.deepEqual(texts(buttons), ["Yes, reuse it", "Only when there are no notes", "Decide later"], "the option it recommends first");
  assert.ok(buttons[0].classList.contains("primary") && buttons[0].classList.contains("suggested") && buttons[1].classList.contains("ghost"));
  assert.equal(buttons[1].title, "Keep it small", "an option's own words are its tooltip");
  assert.ok(card.querySelector(".sx-ask-own input"), "and a box for your own words");
  assert.doesNotMatch(card.textContent, /auto-?decid|counts down|in \d+ min|Mefi picks/i, "there is no countdown: this app has no auto-decide to count down to");
  assert.equal(a.one("main", "#sessions-dock").hidden, false);
});

test("the options answer through the host with their own id; a free answer sends its words; an empty one sends nothing", async () => {
  const a = await withQuestion();
  await a.all("main", "#sessions-dock .sx-ask-opts button")[0].click(); await a.settle();
  assert.deepEqual(clean(a.api.of("assistantAnswer")), [["assistantAnswer", { id: "q1", optionId: "yes" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Answered: Yes, reuse it\. Mefi carries on\./);
  const b = await withQuestion();
  await b.all("main", "#sessions-dock .sx-ask-opts button")[1].click(); await b.settle();
  assert.deepEqual(clean(b.api.of("assistantAnswer")), [["assistantAnswer", { id: "q1", optionId: "only" }]]);
  const c = await withQuestion();
  const input = c.one("main", "#sessions-dock .sx-ask-own input");
  await c.one("main", "#sessions-dock .sx-ask-own").trigger("submit"); await c.settle();
  assert.equal(c.api.of("assistantAnswer").length, 0, "an empty answer is not sent");
  input.value = "  Only for notes with tags  ";
  await c.one("main", "#sessions-dock .sx-ask-own").trigger("submit"); await c.settle();
  assert.deepEqual(clean(c.api.of("assistantAnswer")), [["assistantAnswer", { id: "q1", text: "Only for notes with tags" }]]);
  const d = await withQuestion();
  d.api.state.fail.assistantAnswer = "The question was already answered.";
  await d.all("main", "#sessions-dock .sx-ask-opts button")[0].click(); await d.settle();
  assert.equal(d.calls.toasts.at(-1).kind, "bad"); assert.match(d.calls.toasts.at(-1).message, /already answered/);
});

test("Decide later puts the card away for now, keeps it in Needs you, and Answer now brings it back", async () => {
  const a = await withQuestion();
  await a.all("main", "#sessions-dock .sx-ask-opts button")[2].click(); await a.settle();
  assert.equal(fullCard(a), null, "the card is away");
  const folded = asks(a).find((node) => node.classList.contains("later"));
  assert.ok(folded); assert.match(folded.textContent, /Decide later.*Should it also handle search\?.*Answer now/);
  assert.equal(a.api.of("assistantAnswer").length, 0, "nothing was answered, and nothing was sent anywhere");
  assert.deepEqual(a.all("list", ".sx-gh").map((node) => node.dataset.key)[0], "group:needs", "the task is still in Needs you");
  assert.equal(a.row("t1").dataset.tone, "ask");
  await folded.querySelector("button").click(); await a.settle();
  assert.ok(fullCard(a), "Answer now brings it back");
});

test("in a short window the question is one line until it is opened, and can be folded again to give the thread its room", async () => {
  const a = await withQuestion({ innerHeight: 400 });
  const mini = miniCard(a);
  assert.ok(mini, "one line in a short window"); assert.equal(fullCard(a), null);
  assert.match(mini.textContent, /Needs your answer.*Should it also handle search\?.*Answer/);
  await mini.querySelector("button").click(); await a.settle();
  assert.ok(fullCard(a), "Answer opens it");
  await fullCard(a).querySelector(".sx-icon").click(); await a.settle();
  assert.ok(miniCard(a), "the fold button puts it back to one line");
  assert.equal(fullCard(a), null);
  assert.equal(a.thread().dataset.short, "true", "the thread knows the window is short");
  a.window.innerHeight = 900; a.env.emit("resize"); await a.settle(3);
  assert.equal(a.thread().dataset.short, "false");
  // A tall window folds it by choice, too.
  const tall = await withQuestion();
  await fullCard(tall).querySelector(".sx-icon").click(); await tall.settle();
  assert.ok(miniCard(tall));
});

test("the options wait while an action is running, and the dock is away when no question is open", async () => {
  const a = await withQuestion();
  a.api.tasksAction = () => new Promise(() => {});
  await a.one("main", '[data-spec="stop"]').click(); await a.one("main", '[data-spec="stop"]').click();
  await a.settle();
  assert.ok(a.all("main", "#sessions-dock .sx-ask-opts button").filter((node) => !node.classList.contains("quiet")).every((node) => node.disabled), "no second answer while one thing is under way");
  const none = await open("t1", { tasks: [task("t1")] });
  assert.equal(none.one("main", "#sessions-dock").hidden, true);
  assert.equal(none.all("main", "#sessions-dock .sx-ask").length, 0);
});

// ---- what Mefi decided --------------------------------------------------------------------------------------------------------------------

test("what Mefi decided is a record in the thread, with an Undo that asks the host to open the question again", async () => {
  const decisions = [{ id: "d1", taskId: "t1", at: mins(20), label: "Keep the old name as an alias", reason: "existing links keep working", choice: "alias" }, { id: "d2", taskId: "t2", at: mins(20), label: "Other task" }, { id: "d3", taskId: "t1", at: mins(10), pending: true, label: "Not yet" }];
  const a = await open("t1", { tasks: [task("t1", { status: "done", doneAt: at(1) }), task("t2")], decisions });
  const cards = a.all("main", ".sx-feed .sx-decided");
  assert.equal(cards.length, 1, "this task's record only, and not one that is still pending");
  assert.match(cards[0].textContent, /Mefi decided · Keep the old name as an alias/); assert.match(cards[0].textContent, /existing links keep working/);
  await cards[0].querySelector("button").click(); await a.settle();
  assert.deepEqual(clean(a.api.of("autonomyUndo")), [["autonomyUndo", { id: "d1", projectId: "p1" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Undone\. The question is open again\./);
  const undone = await open("t1", { tasks: [task("t1")], decisions: [{ id: "d1", taskId: "t1", at: mins(20), label: "X", undone: true }] });
  assert.match(undone.one("main", ".sx-decided").textContent, /Undone/); assert.equal(undone.one("main", ".sx-decided button"), null, "nothing left to undo");
  const waiting = await open("t1", { tasks: [task("t1")], decisions: [{ id: "d1", taskId: "t1", at: mins(20), label: "X", undoPending: true }] });
  assert.match(waiting.one("main", ".sx-decided").textContent, /Undo waits for the worker to finish/);
  const failing = await open("t1", { tasks: [task("t1")], decisions: [{ id: "d1", taskId: "t1", at: mins(20), label: "X" }], api: bridge({ fail: { autonomyUndo: "Too late." } }) });
  await failing.one("main", ".sx-decided button").click(); await failing.settle();
  assert.equal(failing.calls.toasts.at(-1).kind, "bad"); assert.match(failing.calls.toasts.at(-1).message, /Too late\./);
});

// ---- banners -------------------------------------------------------------------------------------------------------------------------------

test("a finished task says how it finished and can be reopened; a dropped one says it was closed without finishing", async () => {
  const a = await open("t1", { tasks: [task("t1", { status: "done", doneAt: at(1), verification: { state: "verified", reason: "The test that looks for it passes." } })] });
  const banner = a.one("main", ".sx-banner");
  assert.equal(banner.dataset.tone, "good"); assert.equal(banner.querySelector("h3").textContent, "Verified"); assert.match(banner.textContent, /The test that looks for it passes\./);
  await banner.querySelector("button").click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksAction")), [["tasksAction", { taskId: "t1", projectId: "p1", action: "status", status: "open" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Reopened/);
  const manual = await open("t1", { tasks: [task("t1", { status: "done", doneAt: at(1), verification: { state: "manual" } })] });
  assert.equal(manual.one("main", ".sx-banner h3").textContent, "Done, confirmed by you");
  const dropped = await open("t1", { tasks: [task("t1", { status: "done", doneAt: at(1), dropped: { at: at(1) } })] });
  assert.equal(dropped.one("main", ".sx-banner").dataset.tone, "dim"); assert.equal(dropped.one("main", ".sx-banner h3").textContent, "Dropped");
});

test("a task whose result is being checked offers the changes, a change and approval (two presses) and is not marked done by looking at it", async () => {
  const a = await open("t1", { tasks: [task("t1", { status: "awaiting_verification" })], stages: { t1: "review" } });
  const banner = a.one("main", ".sx-banner");
  assert.equal(banner.dataset.tone, "info"); assert.equal(banner.querySelector("h3").textContent, "Checking the result");
  const buttons = banner.querySelectorAll("button");
  assert.deepEqual(texts(buttons), ["See the changes", "Request changes", "Approve and finish"]);
  await buttons[0].click(); await a.settle();
  assert.equal(a.S.tab(), "changes", "See the changes opens the Changes tab");
  await buttons[1].click(); await a.settle();
  assert.equal(a.one("main", "#sessions-compose").dataset.intent, "change", "Request changes opens the Change box");
  const approve = banner.querySelectorAll("button")[2];
  await approve.click();
  assert.equal(approve.textContent, "Really finish?", "the first press asks");
  assert.equal(a.api.of("tasksAction").length, 0);
  await approve.click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksAction")), [["tasksAction", { taskId: "t1", projectId: "p1", action: "status", status: "done" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Marked done\. You confirmed the result\./);
});

test("a task that failed its checks, or is blocked, says why and offers the checks and a change; a task waiting for approval says so", async () => {
  const a = await open("t1", { tasks: [task("t1", { verification: { state: "failed", reason: "The budget test failed: 2.4 s against 1.5 s." } })], stages: { t1: "blocked" } });
  const banner = a.one("main", ".sx-banner");
  assert.equal(banner.dataset.tone, "bad"); assert.equal(banner.getAttribute("role"), "alert");
  assert.equal(banner.querySelector("h3").textContent, "Its checks did not pass"); assert.match(banner.textContent, /2\.4 s against 1\.5 s\./);
  assert.deepEqual(texts(banner.querySelectorAll("button")), ["See the checks", "Request a change"]);
  await banner.querySelectorAll("button")[0].click(); await a.settle();
  assert.equal(a.S.tab(), "checks");
  const blocked = await open("t1", { tasks: [task("t1")], stages: { t1: "blocked" }, backlog: { taskStates: [{ id: "t1", stage: "blocked", reason: "Waiting on the owner." }] } });
  assert.equal(blocked.one("main", ".sx-banner h3").textContent, "It is blocked");
  const approval = await open("t1", { tasks: [task("t1")], stages: { t1: "approval" } });
  assert.equal(approval.one("main", ".sx-banner").dataset.tone, "warn"); assert.match(approval.one("main", ".sx-banner h3").textContent, /Waiting for your approval/);
  const fine = await open("t1", { tasks: [task("t1")] });
  assert.equal(fine.all("main", ".sx-banner").length, 0, "a task with nothing to say says nothing");
});

test("after the last run the thread says what changed and links to the Changes tab", async () => {
  const a = await open("t1", { tasks: [task("t1", { status: "awaiting_verification" })], stages: { t1: "review" }, api: bridge({ attempts: { t1: [attempt()] } }) });
  assert.equal(a.one("main", ".sx-evidence"), null, "nothing until the review panel has counted the files");
  a.reviews.setCounts("t1", { files: 4, additions: 212, deletions: 18, running: false, accepted: false }); await a.settle(3);
  const line = a.one("main", ".sx-evidence");
  assert.match(line.textContent, /4 files changed/); assert.match(line.textContent, /\+212 −18/);
  const runs = a.all("main", ".sx-feed .sx-item").map((node) => node.className);
  assert.ok(runs.indexOf("sx-item is-evidence") === runs.indexOf("sx-item is-run") + 1, "right after the run it is about");
  await line.querySelector("button").click(); await a.settle();
  assert.equal(a.S.tab(), "changes");
  a.reviews.setCounts("t1", { files: 1, additions: 1, deletions: 0, running: false, accepted: true }); await a.settle(3);
  assert.match(a.one("main", ".sx-evidence").textContent, /1 file changed/); assert.match(a.one("main", ".sx-evidence").textContent, /Accepted/);
});

// ---- pictures and shots --------------------------------------------------------------------------------------------------------------------------

const shot = (phase, n) => ({ phase, dataUrl: `data:image/png;base64,${Buffer.from(`${phase}${n}`).toString("base64")}`, width: 1280, height: 800 });
const withShots = (shots, extra = {}) => open("t1", { tasks: [task("t1", { status: "awaiting_verification" })], stages: { t1: "review" }, api: bridge({ attempts: { t1: [attempt()] }, evidence: { t1: { ok: true, shots } } }), ...extra });

test("before and after shots of an attempt show in the thread on one frame, read once, and only PNGs the host sent as data URLs", async () => {
  const a = await withShots([shot("before", 1), shot("after", 1), { phase: "after", dataUrl: "https://example.com/x.png", width: 1, height: 1 }, { phase: "before", dataUrl: "file:///etc/passwd" }]);
  const media = a.one("main", ".sx-media");
  assert.ok(media, "the card is in the thread");
  assert.deepEqual(media.querySelectorAll(".sx-compare img").map((img) => img.getAttribute("src")), [shot("before", 1).dataUrl, shot("after", 1).dataUrl], "a link or a file path is never loaded as a shot");
  assert.equal(media.querySelector(".sx-card-head b").textContent, "Before and after");
  assert.equal(a.api.of("tasksEvidence").length, 1, "read once");
  a.S.refresh(); await a.settle(3); a.S.refresh(); await a.settle(3);
  assert.equal(a.api.of("tasksEvidence").length, 1, "and not again while the attempt is the same, even when the thread is drawn from scratch");
  assert.ok(media.querySelector(".sx-compare").style["--ratio"].includes("1280 / 800"), "the frame has the shot's own shape");
  // Only one shot: shown alone, named for what it is.
  const one = await withShots([shot("after", 2)]);
  assert.equal(one.one("main", ".sx-media .sx-card-head b").textContent, "After"); assert.equal(one.all("main", ".sx-media .sx-compare").length, 0);
  assert.ok(one.one("main", ".sx-media img.sx-shot"));
  // None: no card.
  const none = await withShots([]);
  assert.equal(none.one("main", ".sx-media"), null);
  const refused = await withShots([{ phase: "before", dataUrl: "javascript:alert(1)" }]);
  assert.equal(refused.one("main", ".sx-media"), null, "nothing that is not a PNG data URL");
});

test("the comparison's position is the person's, kept for the task, and reachable by keyboard (it is a range)", async () => {
  const a = await withShots([shot("before", 1), shot("after", 1)]);
  const range = a.one("main", ".sx-cmp-range");
  assert.equal(range.type, "range"); assert.equal(range.value, "50"); assert.equal(range.getAttribute("aria-label"), "Compare before and after");
  range.value = "20"; await range.trigger("input");
  assert.equal(a.one("main", ".sx-compare").style["--pos"], "20%"); assert.match(range.getAttribute("aria-valuetext"), /20% of the width shows before/);
  a.S.refresh(); a.S.select("t1", { route: false }); await a.settle(4);
  assert.equal(a.one("main", ".sx-cmp-range").value, "20", "it is where it was left when the thread is drawn again");
});

test("the lightbox keeps the page's single-key shortcuts from firing behind it, leaves chords alone, and goes when the page moves on", async () => {
  const a = await withShots([shot("before", 1), shot("after", 1)]);
  await a.one("main", ".sx-media .sx-link").click();
  const log = [];
  const send = async (event) => { for (const listener of [...a.document.body.listeners.keydown]) await listener({ preventDefault() { log.push(["prevented", event.key]); }, stopPropagation() { log.push(["stopped", event.key]); }, ...event }); };
  await send({ key: "h" });
  assert.deepEqual(log, [["prevented", "h"], ["stopped", "h"]], "a letter is swallowed: nav.js's H would otherwise go Home behind it");
  log.length = 0;
  await send({ key: "r", ctrlKey: true });
  assert.deepEqual(log, [], "Ctrl R is the app's");
  a.navigate("tasks", {}); await a.settle();
  assert.equal(a.document.body.querySelector("#sessions-lightbox"), null, "a navigation closes it");
  assert.equal(a.document.body.listeners.keydown?.length ?? 0, 0);
});

test("Open larger opens the lightbox on the shots: Before and After, arrows between them, Escape and a press outside close it, focus goes back", async () => {
  const a = await withShots([shot("before", 1), shot("after", 1)]);
  const opener = a.one("main", ".sx-media .sx-link");
  a.document.activeElement = opener;
  await opener.click();
  const box = a.document.body.querySelector("#sessions-lightbox");
  assert.ok(box, "it is on the page, not inside the thread");
  assert.equal(box.getAttribute("role"), "dialog"); assert.equal(box.getAttribute("aria-modal"), "true"); assert.equal(box.getAttribute("aria-label"), "Before and after");
  assert.equal(box.querySelector("img").getAttribute("src"), shot("before", 1).dataUrl);
  assert.deepEqual(texts(box.querySelectorAll(".sx-lb-tabs button")), ["Before", "After"]);
  assert.equal(box.querySelector(".sx-lb-cap").textContent, "Before");
  const keys = a.document.body.listeners.keydown;
  assert.ok(keys?.length >= 1, "it listens for keys while it is open");
  const press = async (name, extra = {}) => { for (const listener of [...a.document.body.listeners.keydown]) await listener({ key: name, preventDefault() {}, stopPropagation() {}, ...extra }); };
  await press("ArrowRight");
  assert.equal(box.querySelector("img").getAttribute("src"), shot("after", 1).dataUrl, "an arrow key moves to After"); assert.equal(box.querySelector(".sx-lb-cap").textContent, "After");
  await press("ArrowRight"); assert.equal(box.querySelector(".sx-lb-cap").textContent, "After", "and stops at the end");
  await box.querySelectorAll(".sx-lb-tabs button")[0].click();
  assert.equal(box.querySelector("img").getAttribute("src"), shot("before", 1).dataUrl, "the tabs switch too");
  await press("Escape");
  assert.equal(a.document.body.querySelector("#sessions-lightbox"), null, "Escape closes it");
  assert.equal(a.document.body.listeners.keydown?.length ?? 0, 0, "and it stops listening");
  assert.equal(opener.focused, true, "focus goes back to what opened it");
  await opener.click();
  await a.document.body.querySelector("#sessions-lightbox .sx-lb-scrim").click();
  assert.equal(a.document.body.querySelector("#sessions-lightbox"), null, "a press outside closes it");
  await opener.click();
  a.S.detach();
  assert.equal(a.document.body.querySelector("#sessions-lightbox"), null, "putting the panels away closes it too");
});

test("a picture in the thread opens alone, with no Before and After switch; nothing opens for a picture that is not there", async () => {
  const pic = PICTURE(9);
  const a = await open("t1", { tasks: [task("t1", { prompt: `Look.\nThe owner attached wide.png at /p/${pic}.png` })], api: bridge({ pictures: { [pic]: picture(9, { id: pic, name: "wide.png", width: 960, height: 300 }) } }) });
  await a.one("main", ".sx-feed button.sx-thumb").click();
  const box = a.document.body.querySelector("#sessions-lightbox");
  assert.equal(box.getAttribute("aria-label"), "wide.png"); assert.equal(box.querySelector("img").getAttribute("src"), DATA_URL("pic9"));
  assert.equal(box.querySelector(".sx-lb-tabs"), null); assert.equal(box.querySelector(".sx-lb-cap").textContent, "wide.png · 960 × 300");
  a.S.closePicture();
  assert.equal(a.S.openPicture("img_ffffffffffffffffffffffff", "x"), false, "a picture that was never read opens nothing");
  assert.equal(a.document.body.querySelector("#sessions-lightbox"), null);
});

// ---- the box at the foot -----------------------------------------------------------------------------------------------------------------------

const box = (a) => ({ input: a.one("main", "#sessions-input"), form: a.one("main", "#sessions-compose"), send: a.one("main", "#sessions-send"), intent: a.one("main", "#sessions-compose").dataset.intent });
const type = async (a, words) => { const { input } = box(a); input.value = words; await input.trigger("input"); };
const submit = async (a) => { await box(a).form.trigger("submit"); await a.settle(4); };

test("the box starts as a Note, an Ask while a worker is on the task and a Change once it is done; the first choice sticks", async () => {
  const a = await open("idle", { tasks: [task("idle"), task("busy", { status: "active", runId: "r" }), task("fin", { status: "done", doneAt: at(1) })], running: [{ taskId: "busy", runId: "r" }] });
  assert.equal(box(a).intent, "note"); assert.equal(box(a).send.textContent, "Save note"); assert.equal(box(a).input.placeholder, "Tell it something for its next run…");
  a.S.select("busy", { route: false }); await a.settle(4);
  assert.equal(box(a).intent, "ask"); assert.equal(box(a).send.textContent, "Ask"); assert.equal(box(a).input.placeholder, "Ask Mefi about this task…");
  assert.equal(a.one("main", "#sessions-hint").textContent, "Mefi answers here and in the chat");
  a.S.select("fin", { route: false }); await a.settle(4);
  assert.equal(box(a).intent, "change"); assert.equal(box(a).send.textContent, "Create follow-up");
  assert.equal(a.one("main", "#sessions-hint").textContent, "Makes a new task linked to this one");
  a.S.select("busy", { route: false }); await a.settle(4);
  await a.one("main", "#sessions-intent-note").click();
  assert.equal(box(a).intent, "note"); assert.equal(a.one("main", "#sessions-intent-note").getAttribute("aria-pressed"), "true"); assert.equal(a.one("main", "#sessions-intent-ask").getAttribute("aria-pressed"), "false");
  assert.equal(a.one("main", "#sessions-hint").textContent, "Saved now, read by its next run", "a worker is on it: the note is read by the run after this one");
  a.data.status.running = []; a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.equal(box(a).intent, "note", "a task that stops working does not change a choice that was made");
  assert.equal(a.one("main", "#sessions-hint").textContent, "Its next run reads this");
  assert.equal(a.one("main", "#sessions-compose").hidden, false);
});

test("a draft belongs to its task and its purpose, and is not lost by looking at something else", async () => {
  const a = await open("a", { tasks: [task("a"), task("b")] });
  await type(a, "half a thought");
  await a.one("main", "#sessions-intent-ask").click();
  assert.equal(box(a).input.value, "", "the Ask box starts empty");
  await type(a, "a question");
  await a.one("main", "#sessions-intent-note").click();
  assert.equal(box(a).input.value, "half a thought", "the Note is where it was left");
  a.S.select("b", { route: false }); await a.settle(4);
  assert.equal(box(a).input.value, "", "another task has its own box");
  a.S.select("a", { route: false }); await a.settle(4);
  assert.equal(box(a).input.value, "half a thought");
  await a.one("main", "#sessions-intent-ask").click();
  assert.equal(box(a).input.value, "a question");
});

test("words a reload put back into the box (renderer/nav.js keeps fields by id) are this session's draft and are not wiped by drawing it", async () => {
  const a = await sessionsApp({ tasks: [task("a"), task("b")] });
  await a.settle();
  a.one("main", "#sessions-input").value = "words from before the reload";
  await a.one("main", "#sessions-input").trigger("input");
  a.S.select("a", { route: false }); await a.settle(4);
  assert.equal(box(a).input.value, "words from before the reload", "they stay in the box they were put in");
  a.S.select("b", { route: false }); await a.settle(4);
  assert.equal(box(a).input.value, "", "and belong to the session that was open, not the next one");
  a.S.select("a", { route: false }); await a.settle(4);
  assert.equal(box(a).input.value, "words from before the reload");
});

test("Enter sends and Shift+Enter is a new line; a Note is saved into the task with a log line, and the box is emptied once it went", async () => {
  const a = await open("t1", { tasks: [task("t1", { notes: "- earlier" })] });
  await type(a, "Prefer rounded corners");
  const { input } = box(a);
  let prevented = false;
  await input.trigger("keydown", { key: "Enter", shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, "Shift+Enter is left to the box");
  assert.equal(a.api.of("tasksSave").length, 0);
  await input.trigger("keydown", { key: "Enter", preventDefault() { prevented = true; } }); await a.settle(4);
  assert.equal(prevented, true);
  const saved = a.api.of("tasksSave")[0][1][0];
  assert.equal(saved.notes, "- earlier\n- Prefer rounded corners"); assert.equal(saved.logs.at(-1).kind, "note"); assert.equal(saved.logs.at(-1).text, "Prefer rounded corners");
  assert.equal(input.value, "", "emptied once it went");
  assert.match(a.calls.toasts.at(-1).message, /Saved\. Its next run reads it\./);
  assert.equal(a.calls.refresh, 1, "and the board is read again");
  // Nothing to say, nothing sent; a failed save keeps the words.
  await submit(a);
  assert.equal(a.api.of("tasksSave").length, 1, "an empty box sends nothing");
  a.api.state.fail.tasksSave = "The task store is full.";
  await type(a, "Keep these words"); await submit(a);
  assert.equal(input.value, "Keep these words", "a note that could not be saved is still in the box");
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.match(a.calls.toasts.at(-1).message, /task store is full/);
});

test("an Ask goes to Mefi about this task with its context and shows the question and the answer in the thread", async () => {
  const a = await open("t1", { tasks: [task("t1", { title: "Export as Markdown" })] });
  a.api.state.reply = { ok: true, state: { messages: [{ role: "assistant", text: "It is half done.", at: NOW + 1 }] } };
  await a.one("main", "#sessions-intent-ask").click();
  await type(a, "How far along is it?"); await submit(a);
  const call = a.api.of("assistantMessage")[0];
  assert.equal(call[1], 'About the task "Export as Markdown" (t1): How far along is it?'); assert.equal(call[2], "p1");
  assert.deepEqual(clean(call[3]), { view: "Build · task", companion: "Mefi", taskId: "t1" });
  assert.equal(call.length, 4, "no pictures: no fifth argument");
  const item = a.all("main", ".sx-feed .is-ask").at(-1);
  assert.match(item.textContent, /How far along is it\?/); assert.match(item.textContent, /It is half done\./);
  assert.equal(box(a).input.value, "");
});

test("a Change creates a follow-up task linked to this one; a follow-up that could not be created keeps the words", async () => {
  const a = await open("t1", { tasks: [task("t1", { title: "Export as Markdown", status: "done", doneAt: at(1) })] });
  assert.equal(box(a).intent, "change");
  await type(a, "Also write the tags\nas front matter"); await submit(a);
  const made = a.api.of("tasksCreate")[0][1];
  assert.equal(made.title, "Change: Also write the tags"); assert.equal(made.projectId, "p1");
  assert.equal(made.prompt, 'Follow-up to task "Export as Markdown" (t1).\n\nRequested change:\nAlso write the tags\nas front matter');
  assert.equal(made.images, undefined, "no pictures: no images key");
  assert.match(a.calls.toasts.at(-1).message, /Follow-up task created/);
  a.api.state.fail.tasksCreate = "The project is read-only.";
  await type(a, "Another"); await submit(a);
  assert.equal(box(a).input.value, "Another"); assert.equal(a.calls.toasts.at(-1).kind, "bad");
});

test("the picture button and the @ # / picker are bound to this box, once, with the project for scope and the purpose for mode", async () => {
  const a = await open("t1", { tasks: [task("t1", { status: "active", runId: "r" }), task("t2", { title: "Second task" })], running: [{ taskId: "t1", runId: "r" }] });
  const { input } = box(a);
  assert.equal(a.calls.picked.length, 1, "bound once, however often the thread is drawn");
  const pictures = a.window.MefiComposerPictures.box, picker = a.window.MefiComposerPicker.box;
  assert.equal(pictures.input, input); assert.equal(picker.input, input);
  assert.equal(pictures.row.parentNode.id, "sessions-tools", "the picture button's row sits with the other controls, not on a line of its own");
  assert.equal(pictures.options.scope(), "p1", "the pictures a box holds belong to the project");
  assert.equal(pictures.options.blocked(), false);
  assert.equal(pictures.options.mode(), "chat", "an Ask is a message: what the picture note says follows");
  assert.equal(picker.options.mode(), "chat");
  await a.one("main", "#sessions-intent-note").click();
  assert.equal(picker.options.mode(), "task", "a Note is written into the task as typed");
  await a.one("main", "#sessions-intent-change").click();
  assert.equal(pictures.options.mode(), "task"); assert.equal(picker.options.mode(), "task");
  assert.deepEqual(clean(picker.options.tasks()).map((row) => row.title), ["Task t1", "Second task"], "# offers this project's tasks");
  assert.equal(a.api.of("prefsGet").length, 1, "the setting for the popup is read once");
  a.api.state.prefs = { ok: true, prefs: { composerPicker: false } };
  const off = await open("t1", { tasks: [task("t1")], api: bridge({ prefs: { ok: true, prefs: { composerPicker: false } } }) });
  assert.equal(off.window.MefiComposerPicker.box.on, false, "switched off in Settings, the popup stays off here too");
});

test("pictures go with an Ask and a Change and are cleared once they went; a Note cannot carry one and leaves them be; a picture still being added holds the send", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  const held = a.window.MefiComposerPictures.box;
  held.images = [{ id: PICTURE(1) }, { id: PICTURE(2) }];
  await a.one("main", "#sessions-intent-ask").click();
  await type(a, "What do you make of these?"); await submit(a);
  assert.deepEqual(clean(a.api.of("assistantMessage")[0][4]), [PICTURE(1), PICTURE(2)], "an Ask carries the ids, as a fifth argument");
  assert.equal(held.cleared, 1, "and the box lets go of them");
  held.images = [{ id: PICTURE(3) }];
  await a.one("main", "#sessions-intent-note").click();
  await type(a, "a note"); await submit(a);
  assert.equal(a.api.of("tasksSave").length, 1); assert.equal(held.cleared, 1, "a note does not use a picture, so the box keeps it");
  assert.equal(a.one("main", "#sessions-compose").dataset.intent, "note", "the stylesheet hides the picture row for a Note");
  await a.one("main", "#sessions-intent-change").click();
  await type(a, "change it"); await submit(a);
  assert.deepEqual(clean(a.api.of("tasksCreate")[0][1].images), [PICTURE(3)], "a Change names them in the follow-up");
  assert.equal(held.cleared, 2);
  held.busy = true; held.images = [{ id: PICTURE(4) }];
  await type(a, "too soon"); await submit(a);
  assert.equal(a.api.of("tasksCreate").length, 1, "a picture still being added holds the send");
  assert.match(a.calls.toasts.at(-1).message, /picture is still being added/);
  assert.equal(box(a).input.value, "too soon");
});

test("the chips: the folder's branch and what is uncommitted, the Worktree switch, and the coding worker, each through builder.js's own calls", async () => {
  const a = await open("t1", { tasks: [task("t1")], api: bridge({ routing: { ok: true, executorCli: "opencode", executorTier: "auto", executorModels: { opencode: "zai/glm-5.3" } } }) });
  await a.settle(4);
  const chips = a.all("main", "#sessions-chips button");
  assert.equal(chips.length, 2);
  assert.match(chips[0].textContent, /main/); assert.equal(chips[0].querySelector(".sx-chip-count").textContent, "+2");
  assert.match(chips[0].title, /On branch main · 2 uncommitted paths/);
  await chips[0].click();
  assert.deepEqual(clean(a.api.of("shellReveal")), [["shellReveal", "/work/snake"]], "the branch opens the folder");
  assert.equal(chips[1].getAttribute("role"), "switch"); assert.equal(chips[1].getAttribute("aria-checked"), "false");
  await chips[1].click(); await a.settle(4);
  assert.deepEqual(clean(a.api.of("workWorktrees")), [["workWorktrees", true]]);
  assert.match(a.calls.toasts.at(-1).message, /Each run now gets its own worktree/);
  const cli = a.one("main", "#sessions-worker-cli"), tier = a.one("main", "#sessions-worker-tier");
  assert.equal(cli.hidden, false); assert.deepEqual(texts(cli.children), ["OpenCode · glm-5.3", "Claude Code"]); assert.equal(cli.value, "opencode");
  assert.deepEqual(texts(tier.children), ["Auto tier", "Free tier", "Fast tier", "Heavy tier"]); assert.equal(tier.value, "auto");
  cli.value = "claude"; await cli.trigger("change"); await a.settle(3);
  assert.deepEqual(clean(a.api.of("setAiRouting")), [["setAiRouting", { executorCli: "claude" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Claude Code builds your tasks now\./);
  tier.value = "fast"; await tier.trigger("change"); await a.settle(3);
  assert.deepEqual(clean(a.api.of("setAiRouting").at(-1)), ["setAiRouting", { executorTier: "fast" }]);
  assert.equal(a.one("main", "#sessions-autonomy").mounted.id, "sessions-autonomy-control", "the permission chip is autonomy.js's own");
  // A folder that is not a git repository has no branch chip.
  const plain = await open("t1", { tasks: [task("t1")], api: bridge({ where: { ok: true, projectId: "p1", repo: false } }) });
  await plain.settle(4);
  assert.equal(plain.all("main", "#sessions-chips button").length, 0);
  assert.equal(plain.one("main", "#sessions-chips").hidden, true);
});

test("More folds the controls past Attach, the permission chip and Send behind one button for a short or narrow box", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  const form = a.one("main", "#sessions-compose");
  assert.equal(form.dataset.open, "false");
  const more = a.one("main", ".sx-more");
  assert.equal(more.getAttribute("aria-expanded"), "false"); assert.equal(more.getAttribute("aria-label"), "More");
  await more.click();
  assert.equal(form.dataset.open, "true"); assert.equal(more.getAttribute("aria-expanded"), "true");
  await more.click();
  assert.equal(form.dataset.open, "false");
});

test("while a send is under way the box says so and cannot be sent twice; a second action waits for the first", async () => {
  const a = await open("t1", { tasks: [task("t1", { status: "active", runId: "r" })], running: [{ taskId: "t1", runId: "r" }] });
  let release;
  a.api.assistantMessage = (...args) => new Promise((resolve) => { release = () => resolve({ ok: true, state: { messages: [] } }); a.api.calls.push(["assistantMessage", ...args]); });
  await type(a, "First"); box(a).form.trigger("submit"); await a.settle(3);
  assert.equal(box(a).send.textContent, "Sending…"); assert.equal(box(a).send.disabled, true);
  const actions = () => a.all("main", "#sessions-head [data-spec]");
  assert.ok(actions().length > 0, "the head offers something to do");
  assert.ok(actions().every((node) => node.disabled), "and none of it can be pressed while the send is out");
  await type(a, "Second"); await submit(a);
  assert.equal(a.api.of("assistantMessage").length, 1, "one at a time");
  assert.equal(a.window.MefiComposerPictures.box.options.blocked(), true, "and the picture button is held too");
  const toasts = a.calls.toasts.length;
  a.window.MefiComposerPictures.box.busy = true; await submit(a); a.window.MefiComposerPictures.box.busy = false;
  assert.equal(a.calls.toasts.length, toasts, "a press while one is out is ignored quietly: no word about pictures, no second send");
  release(); await a.settle(6);
  assert.equal(box(a).send.textContent, "Ask"); assert.equal(box(a).send.disabled, false);
  assert.ok(actions().every((node) => !node.disabled), "the head's actions come back with the box");
});

test("nothing to say sends nothing and puts the cursor back in the box; a send that comes back after the person moved on leaves the words they are writing alone", async () => {
  const a = await open("t1", { tasks: [task("t1", { status: "active", runId: "r" }), task("t2")], running: [{ taskId: "t1", runId: "r" }] });
  box(a).input.focused = false;
  const before = a.api.calls.length;
  await submit(a);
  assert.equal(a.api.calls.length, before, "nothing was asked of the host");
  assert.equal(box(a).input.focused, true, "the cursor is in the box, where the words go");
  // An Ask goes out, the person opens another session and starts writing; the answer arriving must not wipe that.
  let release;
  a.api.assistantMessage = (...args) => new Promise((resolve) => { release = () => resolve({ ok: true, state: { messages: [] } }); a.api.calls.push(["assistantMessage", ...args]); });
  await type(a, "About the first"); box(a).form.trigger("submit"); await a.settle(3);
  a.S.select("t2", { route: false }); await a.settle(4);
  await type(a, "Words for the second"); await a.settle();
  release(); await a.settle(6);
  assert.equal(box(a).input.value, "Words for the second", "the box shows the session that is open, and keeps what was typed into it");
  a.S.select("t1", { route: false }); await a.settle(4);
  assert.equal(box(a).input.value, "", "the first session's own words went with its send");
});

test("a session that is not on the board shows no box, and the thread waits for one that is", async () => {
  const a = await sessionsApp({ tasks: [task("t1")] });
  await a.settle();
  assert.equal(a.thread().hidden, true, "no session: no thread");
  assert.equal(a.one("main", "#sessions-compose").hidden, true);
});
