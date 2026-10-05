// Build's Home in layout v2 (renderer/today.js mountHome): Today as the 0.5 prototype draws it. With no session open it
// borrows Home's own box (workspace.js's form) and gives it back; Talk it over sends the words as a chat and opens the
// conversation (the classic Home, the route's "chat" view), Build it sends them as a task; Enter and Ctrl Enter do the
// same; the four ways to start fill the box the way Vibe's does; Add files or an image hands each file to the module that
// takes it; Suggest a next step asks the same look Vibe's box asks for; Needs you is the first thing that waits on you,
// answered in place; Running now and Finished while you were away are one line per session. In Vibe, in layout v1, or
// on the "chat" view nothing of it is there. The real window (sizes, contrast, the captures beside the prototype) is
// tests/sessions_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

import { NOW, board, finished, job, loadToday, needApproval, needBlocked, needPlan, needQuestion, needReview, plain } from "./fixtures/today-env.mjs";

const INTENTS = {
  modify: { label: "Modify", hint: "Shape an existing feature", starter: "Change this project so that ", guide: "Adapt the existing behavior." },
  experiment: { label: "Experiment", hint: "Try a small possibility", starter: "Try a small experiment: ", guide: "Build a bounded experiment." },
  fix: { label: "Fix", hint: "Make something work again", starter: "Something is broken: ", guide: "Investigate the cause." },
  improve: { label: "Improve", hint: "Polish what is already here", starter: "Improve this project by ", guide: "Improve the experience." },
};
const world = (over = {}) => ({
  ...board({
    needs: [needReview({ title: "Export notes as Markdown" }), needQuestion({ title: "Should the empty state also appear when a search has no matches?", context: { taskId: "t1", taskTitle: "Add an empty state to the notes list" } }), needBlocked(), needPlan()],
    running: [job({ taskId: "t3", title: "Search notes by tag", route: "Claude Code", currentStep: "Writing parseTags()", progress: 0.6 }), job({ taskId: "t4", title: "Keyboard shortcut for a new note", route: "OpenCode", progress: undefined, currentStep: "" })],
    checking: [{ id: "t8", title: "Polish the onboarding copy" }],
    tasks: [finished({ id: "t20", title: "Pin favourite notes", doneAt: NOW - 5 * 3600000, verification: { state: "verified" } }), finished({ id: "t21", title: "Rename Untitled notes", doneAt: NOW - 6 * 3600000 })],
  }),
  greeting: "Good evening", headline: "What's next for Notes app?",
  ...over,
});
const byId = (t, id) => t.document.getElementById(id);
const words = (node) => (node ? node.textContent : null);
const files = (...names) => names.map((name) => ({ name, type: /\.(png|jpe?g|gif|webp)$/.test(name) ? `image/${name.split(".").pop().replace("jpg", "jpeg")}` : "text/plain" }));
const nav = (t, params) => t.window.dispatchEvent({ type: "mefi:nav", detail: { id: "workspace", action: "open", params } });
// What the other modules were asked, in order (the page's own host calls are in t.calls).
async function home(over = {}) {
  const log = [];
  const extras = {
    MefiComposerPictures: { get: () => ({ addFiles: async (list) => { log.push(["pictures", plain(list.map((file) => file.name))]); } }) },
    MefiFileInputs: { addFiles: async (_input, list) => { log.push(["files", plain(list.map((file) => file.name))]); } },
    MefiAutonomy: { mount: (root, options) => { log.push(["autonomy.mount", plain(options)]); const chip = new root.constructor("button"); chip.className = "autonomy-chip"; chip.textContent = "Auto"; root.append(chip); } },
    MefiSessions: { active: () => true, open: (taskId, options) => { log.push(["sessions.open", taskId, plain(options)]); return true; } },
    ...over.extras,
  };
  const t = await loadToday({ home: true, mode: "build", intents: INTENTS, data: world(), ...over, extras });
  await t.settle();
  t.log = log;
  return t;
}
const logOf = (t, name) => t.log.filter((call) => call[0] === name).map((call) => call.slice(1));

test("Build's Home is Today: the page goes first in Home's layer, borrows the box and the line under it, and reads the greeting and the question", async () => {
  const t = await home();
  const layer = byId(t, "workspace-layer");
  const page = byId(t, "today-build");
  assert.equal(page.parentNode, layer, "inside Home's own layer, so a session's cover and Home's backdrop work as before");
  assert.equal(layer.children[0], page, "before the classic page it stands in for");
  assert.equal(layer.dataset.today, "on", "CSS steps the classic page aside from this");
  assert.equal(page.hidden, false);
  assert.equal(page.getAttribute("aria-label"), "Today");
  assert.equal(t.today.hostsComposer(), true);
  assert.equal(words(byId(t, "today-build-kicker")), "Good evening");
  assert.equal(words(byId(t, "today-build-title")), "What's next for Notes app?");
  const column = page.querySelector(".today-b-col");
  assert.deepEqual(column.children.map((child) => child.id || child.className.split(" ")[0]), ["today-b-hero", "today-build-box", "ws-feedback-row", "today-build-note", "today-build-hint", "today-build-starts", "today-build-suggestions", "today-b-sect", "today-b-two"],
    "the greeting, the box, how a send went, the keys, the ways to start, Needs you, then Running now and Finished side by side");
  assert.equal(byId(t, "workspace-form").parentNode, byId(t, "today-build-box"), "Home's own box, borrowed: its drafts, pictures and picker stay Home's");
  assert.equal(byId(t, "workspace-input").placeholder, "Describe an idea, a fix or a question…", "the prototype's words in the box");
  const tools = byId(t, "today-build-tools");
  assert.equal(tools.parentNode, byId(t, "workspace-form"), "one row of controls under the words, inside the box");
  assert.deepEqual(tools.children.map((child) => child.id), ["today-build-attach", "today-build-files", "today-build-autonomy", "today-build-talk", "today-build-build"]);
  assert.equal(words(byId(t, "today-build-attach")), "Add files or an image");
  assert.equal(words(byId(t, "today-build-talk")), "Talk it over");
  assert.equal(words(byId(t, "today-build-build")), "Build itCtrl Enter", "Build it carries its key, as the prototype's");
  assert.deepEqual(logOf(t, "autonomy.mount"), [[{ id: "today-build-autonomy-control" }]], "the permission mode is autonomy-ui.js's own control, mounted once");
  assert.match(words(byId(t, "today-build-hint")), /Enter to talk it over · Shift Enter for a new line · Ctrl Enter to build/);
  assert.deepEqual(byId(t, "today-build-starts").children.map((chip) => words(chip)), ["Modify", "Experiment", "Fix", "Improve", "Suggest a next step"]);
  assert.deepEqual(byId(t, "today-build-starts").children.map((chip) => chip.title), ["Shape an existing feature", "Try a small possibility", "Make something work again", "Polish what is already here", "Mefi reads the project and suggests a few small next steps"]);
  assert.equal(t.today.snapshot().home, true);
});

test("the chat view is the classic Home: Today gives every piece back where it was, and takes it again on Today", async () => {
  const t = await home();
  const tools = byId(t, "today-build-tools");
  const before = { conversation: t.home.conversation.children.map((child) => child.id || child.className) };
  nav(t, { view: "chat" });
  await t.settle();
  assert.equal(t.today.homeView(), "chat");
  assert.equal(t.today.hostsComposer(), false);
  assert.equal(byId(t, "workspace-layer").dataset.today, undefined);
  assert.equal(byId(t, "today-build").hidden, true);
  assert.deepEqual(t.home.conversation.children.map((child) => child.id || child.className), ["workspace-thread", "ws-feedback-row", "workspace-form"], "the thread, how a send went, then the box: as the template has them");
  assert.equal(tools.parentNode, null, "Today's row of controls leaves with it");
  assert.equal(byId(t, "workspace-input").placeholder, "Ask about this project or discuss an idea…", "and the box says what Home's purpose says");
  assert.notDeepEqual(before.conversation, t.home.conversation.children.map((child) => child.id || child.className), "(it was borrowed before)");
  // A session over Home leaves whichever view was there; Today comes back on Today.
  nav(t, { view: "task", taskId: "t1" });
  await t.settle();
  assert.equal(t.today.homeView(), "chat");
  nav(t, {});
  await t.settle();
  assert.equal(t.today.hostsComposer(), true);
  assert.equal(byId(t, "workspace-form").parentNode, byId(t, "today-build-box"));
  assert.equal(logOf(t, "autonomy.mount").length, 1, "the same row comes back: nothing is mounted twice");
  const record = t.nav.registered.find((entry) => entry.id === "home-chat");
  assert.equal(record.label, "Open the conversation");
  assert.equal(record.kind, "action");
  assert.equal(record.hidden(), false, "Search lists it in Build");
  record.run();
  assert.deepEqual(t.callsOf("tabs.open").at(-1), { id: "workspace", params: { view: "chat" }, options: { preview: true } }, "it opens as a tab of its own, the preview tab until used");
  t.window.MefiVibe.mode = () => "vibe";
  assert.equal(record.hidden(), true, "Vibe has its own conversation drawer");
});

test("nothing of it in Vibe, in layout v1, or while Home is away; leaving Home gives the box back", async () => {
  const vibe = await home({ mode: "vibe" });
  assert.equal(byId(vibe, "today-build"), null);
  assert.equal(byId(vibe, "workspace-form").parentNode, vibe.home.conversation);
  const v1 = await home({ layout: "v1" });
  assert.equal(byId(v1, "today-build"), null);
  assert.equal(byId(v1, "workspace-form").parentNode, v1.home.conversation);
  const t = await home();
  byId(t, "workspace-layer").hidden = true;
  t.today.syncHome();
  assert.equal(t.today.hostsComposer(), false, "Home left (workspace.js exit() asks): the box is back in its place");
  assert.equal(byId(t, "workspace-form").parentNode, t.home.conversation);
  byId(t, "workspace-layer").hidden = false;
  t.today.syncHome();
  assert.equal(t.today.hostsComposer(), true);
  // The mode changing in place (Settings' switch) is heard through html[data-ui-mode].
  t.window.MefiVibe.mode = () => "vibe"; t.documentElement.dataset.uiMode = "vibe";
  t.today.syncHome();
  assert.equal(t.today.hostsComposer(), false);
  t.window.MefiVibe.mode = () => "build"; t.documentElement.dataset.uiMode = "build";
  t.today.syncHome();
  t.today.stop();
  assert.equal(byId(t, "today-build"), null, "stop() takes the page away");
  assert.equal(byId(t, "workspace-form").parentNode, t.home.conversation, "and gives everything back");
  assert.equal(byId(t, "workspace-layer").dataset.today, undefined);
});

test("Talk it over sends the words as a chat and opens the conversation; Build it sends them as a task and stays", async () => {
  const t = await home();
  const input = byId(t, "workspace-input");
  await byId(t, "today-build-talk").click(); await t.settle();
  assert.deepEqual(t.callsOf("send"), [], "nothing in the box: nothing is sent");
  assert.equal(words(byId(t, "today-build-note")), "Describe what you have in mind first.");
  assert.equal(byId(t, "today-build-note").hidden, false);
  input.value = "Should tags be case-insensitive?";
  await byId(t, "today-build-talk").click(); await t.settle();
  assert.deepEqual(t.callsOf("send"), [{ purpose: "chat", words: "Should tags be case-insensitive?" }], "Home's own send, as a chat: the box keeps its purpose and its drafts");
  assert.deepEqual(t.callsOf("tabs.open"), [{ id: "workspace", params: { view: "chat" }, options: { preview: true } }], "the reply lands in the conversation, so its page opens");
  assert.equal(byId(t, "today-build-note").hidden, true);
  input.value = "Add keyboard navigation to the tag chips";
  await byId(t, "today-build-build").click(); await t.settle();
  assert.deepEqual(t.callsOf("send").at(-1), { purpose: "work", words: "Add keyboard navigation to the tag chips" });
  assert.equal(t.callsOf("tabs.open").length, 1, "a task stays on Today, with Home's own Task added line and View task");
});

test("Enter talks it over, Ctrl Enter builds it, Shift Enter is a new line, and an open picker keeps its Enter", async () => {
  let pickerOpen = false;
  const t = await home({ extras: { MefiComposerPicker: { get: () => ({ isOpen: () => pickerOpen }) } } });
  const input = byId(t, "workspace-input");
  input.value = "Words";
  const press = async (more = {}) => { let stopped = false, prevented = false; await input.trigger("keydown", { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, target: input, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; }, ...more }); await t.settle(); return { stopped, prevented }; };
  assert.deepEqual(await press(), { stopped: true, prevented: true }, "Home's own Enter (send in the purpose it was left on) never runs on Today");
  assert.deepEqual(t.callsOf("send").map((call) => call.purpose), ["chat"]);
  await press({ ctrlKey: true });
  assert.deepEqual(t.callsOf("send").map((call) => call.purpose), ["chat", "work"]);
  assert.deepEqual(await press({ shiftKey: true }), { stopped: false, prevented: false });
  pickerOpen = true;
  assert.deepEqual(await press(), { stopped: false, prevented: false }, "Enter picks the suggestion");
  assert.equal(t.callsOf("send").length, 2);
  // Away from Today the listener is gone.
  pickerOpen = false;
  nav(t, { view: "chat" }); await t.settle();
  assert.equal((input.listeners.keydown || []).length, 0);
});

test("while Home's box is sending, or with no project, Talk it over and Build it wait", async () => {
  const t = await home();
  t.home.workspace.state.pending = true;
  t.today.composerChanged();
  assert.equal(byId(t, "today-build-talk").disabled, true);
  assert.equal(byId(t, "today-build-build").disabled, true);
  assert.equal(byId(t, "today-build-build").getAttribute("aria-busy"), "true");
  byId(t, "workspace-input").value = "Words";
  await byId(t, "today-build-talk").click(); await t.settle();
  assert.deepEqual(t.callsOf("send"), []);
  t.home.workspace.state.pending = false; t.today.composerChanged();
  assert.equal(byId(t, "today-build-build").disabled, false);
  t.home.workspace.state.projectId = null;
  await t.push(world({ projectId: null, projectName: "", headline: "Pick a project to begin" }));
  assert.equal(byId(t, "today-build-build").disabled, true);
  assert.equal(words(byId(t, "today-build-title")), "Pick a project to begin");
});

test("Modify, Experiment, Fix and Improve start the words as Vibe's box does, and the chip says which one the words start with", async () => {
  const t = await home();
  const input = byId(t, "workspace-input");
  const chip = (id) => byId(t, "today-build-starts").children.find((node) => node.dataset.start === id);
  await chip("modify").click();
  assert.equal(input.value, "Change this project so that ", "an empty box takes the starter");
  assert.equal(input.focused, true);
  assert.equal(chip("modify").getAttribute("aria-pressed"), "true");
  input.value += "tags ignore case";
  await chip("fix").click();
  assert.equal(input.value, "Something is broken: tags ignore case", "a starter already there is swapped, the words after it kept");
  assert.equal(chip("fix").getAttribute("aria-pressed"), "true");
  assert.equal(chip("modify").getAttribute("aria-pressed"), "false");
  input.value = "My own words";
  await chip("improve").click();
  assert.equal(input.value, "My own words", "words of your own are left as they are");
});

test("Add files or an image: a picture goes to the box's pictures and the rest into the words; with pictures off it says Add files", async () => {
  const t = await home();
  const picker = byId(t, "today-build-files");
  picker.files = files("shot.png", "notes.md", "photo.jpg");
  await picker.trigger("change"); await t.settle();
  assert.deepEqual(t.log.filter((call) => call[0] === "pictures" || call[0] === "files"), [["pictures", ["shot.png", "photo.jpg"]], ["files", ["notes.md"]]], "the same split a drop makes");
  const off = await home({ pictures: false });
  assert.equal(words(byId(off, "today-build-attach")), "Add files", "a PC with pictures switched off is not offered them");
  const offPicker = byId(off, "today-build-files");
  offPicker.files = files("shot.png", "notes.md");
  await offPicker.trigger("change"); await off.settle();
  assert.deepEqual(off.log.filter((call) => call[0] === "pictures" || call[0] === "files"), [["files", ["shot.png", "notes.md"]]], "file-inputs.js says why a picture cannot go");
});

test("Suggest a next step asks the same look Vibe's box asks for, shows what came back, and Add to the draft puts it under the words", async () => {
  let reply = { ok: true, projectId: "p1", suggestions: [{ label: "Keyboard tag chips", text: "Let arrow keys move between the tag chips.", reason: "they are mouse-only today" }, { label: "Empty search state", text: "Say when a search finds nothing." }, { label: "Third", text: "Three" }, { label: "Fourth", text: "Four" }] };
  const t = await home({ bridge: { planningExplore: () => reply } });
  const input = byId(t, "workspace-input");
  input.value = "Something is broken: the tag chips";
  await byId(t, "today-build-suggest").click(); await t.settle();
  const [asked] = t.callsOf("planningExplore");
  assert.equal(asked.projectId, "p1");
  assert.equal(asked.intent, "suggest");
  assert.equal(asked.focus, "destination");
  assert.equal(asked.draft.title, "Fix this project", "the approach the words start with");
  assert.match(asked.draft.destination, /^Something is broken: the tag chips\n\nApproach: Fix\. Investigate the cause\.$/);
  assert.match(asked.draft.outOfScope, /Suggestions for review only/);
  const list = byId(t, "today-build-suggestions");
  assert.equal(list.hidden, false);
  assert.equal(list.querySelectorAll(".today-b-sug").length, 3, "three at most, as Vibe shows");
  assert.equal(words(byId(t, "today-build-suggest")), "Suggest again");
  await list.querySelector(".today-b-sug .today-btn").click(); await t.settle();
  assert.equal(input.value, "Something is broken: the tag chips\n\nKeyboard tag chips\n\nLet arrow keys move between the tag chips.");
  assert.equal(words(list.querySelector(".today-b-sug .today-btn")), "Added to the draft");
  assert.deepEqual(t.callsOf("send"), [], "nothing is sent");
  reply = { ok: false, error: "No AI is connected." };
  await byId(t, "today-build-suggest").click(); await t.settle();
  assert.equal(words(list.querySelector('[role="alert"]')), "No AI is connected.");
  await t.push(world({ projectId: null }));
  await byId(t, "today-build-suggest").click(); await t.settle();
  assert.match(words(list), /Choose a project/);
});

test("Needs you is the first thing that waits on you: the task, the question, its first two answers and Open task; answered, it is a Decided line", async () => {
  const t = await home();
  const holder = byId(t, "today-build-need");
  const card = holder.children[0];
  assert.equal(card.dataset.key, "question:q1", "the question comes before the stuck task; the result to review is under Finished, not here");
  assert.equal(words(card.querySelector(".today-b-ask-k b")), "Add an empty state to the notes list", "the task it comes from, as the prototype's heading");
  assert.equal(words(card.querySelector(".today-b-ask-q")), "Should the empty state also appear when a search has no matches?");
  assert.deepEqual(card.querySelectorAll(".today-b-opts button").map((node) => [words(node), node.className.includes("primary")]), [["Yes, ignore case", true], ["Keep them separate", false], ["Open task", false]], "the recommended answer first and filled; an answer that asks for words stays in the Inbox");
  await card.querySelector('[data-option="yes"]').click(); await t.settle();
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q1", optionId: "yes", projectId: "p1" }]);
  assert.match(words(holder.children[0]), /Decided · Answered: Yes, ignore case/);
  // Open task opens its session.
  const t2 = await home();
  await byId(t2, "today-build-need").querySelectorAll(".today-b-opts button").at(-1).click();
  assert.deepEqual(logOf(t2, "sessions.open"), [["t1", { preview: true }]]);
});

test("a stuck task or a go-ahead offers the app's own two first actions; with nothing waiting it says you are caught up", async () => {
  const stuck = await home({ data: world({ needs: [needBlocked()] }) });
  const card = byId(stuck, "today-build-need").children[0];
  assert.equal(card.dataset.tone, "bad", "a task that stopped reads as a failure");
  assert.equal(words(card.querySelector(".today-b-ask-k b")), "Fix the login redirect loop");
  assert.equal(words(card.querySelector(".today-b-ask-q")), "The same check failed three times.");
  assert.deepEqual(card.querySelectorAll(".today-b-opts button").map(words), ["Try again", "It's done", "Open task"]);
  await card.querySelector(".today-b-opts button").click(); await stuck.settle();
  assert.deepEqual(stuck.callsOf("tasksAction"), [{ taskId: "t6", projectId: "p1", action: "retry" }]);
  const approval = await home({ data: world({ needs: [needApproval()] }) });
  assert.deepEqual(byId(approval, "today-build-need").children[0].querySelectorAll(".today-b-opts button").map(words), ["Approve build", "Drop it", "Open task"]);
  const calm = await home({ data: world({ needs: [needReview(), needPlan()] }) });
  assert.match(words(byId(calm, "today-build-need")), /^You're all caught up\. Nothing is waiting on you right now\.$/);
});

test("Running now and Finished while you were away: one line per session, what it is doing or how it ended, opening it", async () => {
  const t = await home();
  const running = byId(t, "today-build-running").children;
  assert.deepEqual(running.map((row) => [words(row.querySelector(".today-b-row-title")), words(row.querySelector(".today-b-row-meta"))]), [["Search notes by tag", "Claude Code · Writing parseTags()"], ["Keyboard shortcut for a new note", "OpenCode · building"]]);
  assert.equal(running[0].querySelector(".today-b-bar i").style.width, "60%", "how far it is, when the run says");
  assert.ok(running[1].querySelector(".today-b-bar").className.includes("is-flowing"), "else a bar that flows");
  const finishedRows = byId(t, "today-build-finished").children;
  assert.deepEqual(finishedRows.map((row) => [row.dataset.key, words(row.querySelector(".today-b-row-meta")), words(row.querySelector(".today-b-end"))]), [
    ["review:t7", "Ready to review", "Review"],
    ["check:t8", "Checking its work", null],
    ["done:t20", "Verified 5 h ago", "Done"],
  ], "a result to review first, then what is being checked, then what finished: three at most");
  await finishedRows[0].click();
  assert.deepEqual(logOf(t, "sessions.open"), [["t7", { preview: true, tab: "changes" }]], "a result opens on what it changed");
  await running[0].click();
  assert.deepEqual(logOf(t, "sessions.open").at(-1), ["t3", { preview: true }]);
  const quiet = await home({ data: world({ needs: [], running: [], checking: [], tasks: [] }) });
  assert.equal(words(byId(quiet, "today-build-running")), "Nothing is running.");
  assert.equal(words(byId(quiet, "today-build-finished")), "Nothing new.");
});

test("a push redraws only what changed: an unchanged row is the same node", async () => {
  const t = await home();
  const before = byId(t, "today-build-running").children[0];
  const need = byId(t, "today-build-need").children[0];
  await t.push(world({ running: [job({ taskId: "t3", title: "Search notes by tag", route: "Claude Code", currentStep: "Writing parseTags()", progress: 0.6 }), job({ taskId: "t9", title: "A new run", route: "Codex", progress: 0.1 })] }));
  assert.equal(byId(t, "today-build-running").children[0], before, "the row under the hand stays");
  assert.equal(byId(t, "today-build-need").children[0], need);
  assert.equal(words(byId(t, "today-build-running").children[1].querySelector(".today-b-row-title")), "A new run");
});

test("with no workspace module (a browser preview) the buttons do nothing harmful and the page still draws", async () => {
  const t = await home({ extras: { MefiWorkspace: undefined } });
  assert.equal(byId(t, "today-build").hidden, false);
  byId(t, "workspace-input").value = "Words";
  await byId(t, "today-build-build").click(); await t.settle();
  assert.deepEqual(t.callsOf("send"), []);
});
