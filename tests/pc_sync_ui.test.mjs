import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/pc-sync.js (Friends › Your PCs) in a vm with a tiny DOM and a fake
// sync bridge: opening the card only looks; Sync this PC and Put my commits on
// top are the only things that sync, and never twice at once; the last answer
// from any source paints at once; the background look repaints an open card
// and drives the Friends badge; a project switch starts over; and the browser
// preview says where syncing works.

const source = await readFile(new URL("../renderer/pc-sync.js", import.meta.url), "utf8");
const hub = await readFile(new URL("../renderer/companion-hub.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.className = ""; this.text = ""; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  find(id) { return this.id === id ? this : this.children.map((child) => child.find?.(id)).find(Boolean) ?? null; }
  byClass(name) { return this.className.split(" ").includes(name) ? this : this.children.map((child) => child.byClass?.(name)).find(Boolean) ?? null; }
}

function environment(api, extra = {}) {
  const events = {};
  const window = { mefiStudio: api, addEventListener: (type, fn) => { (events[type] ??= []).push(fn); }, ...extra };
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag), getElementById: (id) => extra.elements?.[id] ?? null }, Date, Number, Array, Set, Promise });
  vm.runInContext(source, context);
  return { sync: window.MefiPcSync, fire: (type) => (events[type] ?? []).forEach((fn) => fn({ type })) };
}

const answer = (overrides = {}) => ({
  ok: true, checkedAt: Date.UTC(2026, 8, 26, 23, 50), headline: "This PC matches GitHub main.", lines: ["This PC matches GitHub main."], pending: [], risk: 0,
  state: { repo: true, remote: true, device: "DESKTOP-ONE", behind: 0 }, ...overrides,
});

function bridge(replies) {
  const calls = [];
  const waiting = [];
  let pushEvent = null;
  const reply = (name) => (...args) => {
    calls.push([name, args]);
    return new Promise((resolve, reject) => waiting.push({ name, resolve, reject, value: replies[name] }));
  };
  return {
    api: { syncStatus: reply("syncStatus"), syncRun: reply("syncRun"), onSyncEvent: (fn) => { pushEvent = fn; } },
    calls,
    answer: (index = waiting.length - 1, value) => waiting[index].resolve(value ?? waiting[index].value),
    fail: (index, error) => waiting[index].reject(error),
    push: (result) => pushEvent(result),
  };
}

test("opening the card looks, then lays out the headline, the details and this PC's name", async () => {
  const fake = bridge({ syncStatus: answer({ headline: "Some work on this PC is not on GitHub yet.", lines: ["Some work on this PC is not on GitHub yet.", "2 uncommitted files in this checkout.", "Branch wip/cli on GitHub: 1 commit not on main."], pending: [{}, {}], risk: 1 }) });
  const card = environment(fake.api).sync.card();
  assert.deepEqual(fake.calls.map(([name]) => name), ["syncStatus"], "opening never pulls or pushes");
  assert.equal(card.find("pc-sync-status").textContent, "Checking GitHub…");
  assert.equal(card.find("pc-sync-status").getAttribute("role"), "status");
  assert.equal(card.find("pc-sync-run").disabled, true);
  fake.answer(0);
  await flush();
  assert.equal(card.dataset.state, "pending");
  assert.equal(card.find("pc-sync-status").textContent, "Some work on this PC is not on GitHub yet.");
  const list = card.byClass("pc-sync-list");
  assert.equal(list.hidden, false);
  assert.deepEqual(list.children.map((item) => item.textContent), ["2 uncommitted files in this checkout.", "Branch wip/cli on GitHub: 1 commit not on main."]);
  const meta = card.byClass("pc-sync-meta");
  assert.equal(meta.hidden, false);
  assert.match(meta.textContent, /^DESKTOP-ONE · checked /);
  assert.equal(card.find("pc-sync-run").disabled, false);
  assert.equal(card.find("pc-sync-rebase").hidden, true, "nothing to rebase");
});

test("Sync this PC runs once at a time, asks for no rebase, and reports what it did", async () => {
  const fake = bridge({ syncStatus: answer({ headline: "GitHub has 1 commit this PC has not pulled yet.", state: { repo: true, remote: true, device: "PC", behind: 1 } }), syncRun: answer({ lines: ["This PC matches GitHub main.", "Pulled 1 commit from GitHub."] }) });
  const card = environment(fake.api).sync.card();
  fake.answer(0);
  await flush();
  assert.equal(card.dataset.state, "pending", "commits to pull still count as waiting");
  const run = card.find("pc-sync-run");
  run.click();
  run.click();
  card.find("pc-sync-rebase").click();
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls)), [["syncStatus", []], ["syncRun", [{ rebase: false }]]]);
  assert.equal(run.disabled, true);
  assert.equal(run.textContent, "Syncing…");
  assert.equal(card.find("pc-sync-status").textContent, "Syncing with GitHub…");
  assert.equal(card.getAttribute("aria-busy"), "true");
  fake.answer(1);
  await flush();
  assert.equal(card.dataset.state, "clean");
  assert.equal(card.find("pc-sync-status").textContent, "This PC matches GitHub main.");
  assert.equal(run.textContent, "Sync this PC");
  assert.equal(card.getAttribute("aria-busy"), null);
});

test("Put my commits on top appears only when it can run, and asks for the rebase", async () => {
  const diverged = answer({ ok: false, headline: "main changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.", problems: [{ kind: "diverged" }], canRebase: true, risk: 1, state: { repo: true, remote: true, device: "PC", behind: 1 } });
  const fake = bridge({ syncStatus: diverged, syncRun: answer({ lines: ["This PC matches GitHub main.", "Put 1 commit from this PC on top of GitHub's.", "Pushed 1 commit to GitHub."] }) });
  const card = environment(fake.api).sync.card();
  fake.answer(0);
  await flush();
  const rebase = card.find("pc-sync-rebase");
  assert.equal(rebase.hidden, false);
  assert.equal(card.dataset.state, "problem");
  rebase.click();
  assert.equal(rebase.textContent, "Putting your commits on top…");
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls[1])), ["syncRun", [{ rebase: true }]]);
  fake.answer(1);
  await flush();
  assert.equal(rebase.hidden, true);
  assert.equal(card.dataset.state, "clean");
  assert.deepEqual(card.byClass("pc-sync-list").children.map((item) => item.textContent), ["Put 1 commit from this PC on top of GitHub's.", "Pushed 1 commit to GitHub."]);
});

test("the badge counts work only this PC holds, commits to pull, and a GitHub it could not check", async () => {
  const fake = bridge({});
  const { sync } = environment(fake.api);
  assert.equal(sync.badge(), 0, "nothing known yet");
  const seen = [];
  sync.subscribe((result) => seen.push(result));
  fake.push(answer({ risk: 2, state: { repo: true, remote: true, behind: 3 } }));
  assert.equal(sync.badge(), 3, "two at-risk items plus one for commits waiting on GitHub");
  fake.push(answer({ ok: false, risk: 0, problems: [{ kind: "fetch-failed" }] }));
  assert.equal(sync.badge(), 1, "a GitHub that could not be checked needs a look");
  fake.push(answer({ risk: 0, problems: [{ kind: "offline" }] }));
  assert.equal(sync.badge(), 0, "offline alone is not work to do");
  assert.equal(seen.length, 3);
  assert.equal(sync.last().problems[0].kind, "offline");
});

test("a background look repaints an open card, and reopening paints the last answer at once", async () => {
  const fake = bridge({ syncStatus: answer() });
  const { sync } = environment(fake.api);
  const card = sync.card();
  fake.answer(0);
  await flush();
  fake.push(answer({ headline: "GitHub has 2 commits this PC has not pulled yet.", state: { repo: true, remote: true, device: "PC", behind: 2 } }));
  assert.equal(card.find("pc-sync-status").textContent, "GitHub has 2 commits this PC has not pulled yet.");
  assert.equal(card.dataset.state, "pending");
  card.isConnected = false;
  fake.push(answer({ headline: "later" }));
  assert.notEqual(card.find("pc-sync-status").textContent, "later", "a card that left the page stops listening");
  const again = sync.card();
  assert.equal(again.find("pc-sync-status").textContent, "later");
  assert.equal(fake.calls.length, 2, "and still asks");
  fake.push(answer({ headline: "ignored while the card's own look is out" }));
  assert.equal(again.find("pc-sync-status").textContent, "later", "a card's own look wins over a background answer");
  fake.answer(1);
  await flush();
  fake.push(answer({ ok: true, risk: 0, problems: [{ kind: "offline" }], headline: "GitHub could not be reached. As of the last check, this PC matched GitHub." }));
  assert.equal(again.dataset.state, "offline");
});

test("a project switch forgets the old answer and looks again", async () => {
  const fake = bridge({ syncStatus: answer({ risk: 1 }) });
  const { sync, fire } = environment(fake.api);
  fake.push(answer({ risk: 4 }));
  const seen = [];
  sync.subscribe((result) => seen.push(result));
  fire("mefi:project-changed");
  assert.equal(sync.badge(), 0);
  assert.deepEqual(seen, [null]);
  assert.deepEqual(fake.calls.map(([name]) => name), ["syncStatus"]);
  fake.answer(0);
  await flush();
  assert.equal(sync.badge(), 1);
});

test("problems, a folder with no remote and a rejected call all read plainly", async () => {
  const fake = bridge({ syncStatus: answer({ ok: false, headline: "This project has no origin remote yet. Publish it to GitHub once to link your PCs.", lines: ["This project has no origin remote yet. Publish it to GitHub once to link your PCs."], state: { repo: true, remote: false } }) });
  const card = environment(fake.api).sync.card();
  fake.answer(0);
  await flush();
  assert.equal(card.dataset.state, "problem");
  assert.equal(card.find("pc-sync-run").hidden, true, "nothing to sync until the project is on GitHub");
  const broken = bridge({});
  const other = environment(broken.api).sync.card();
  broken.fail(0, new Error("IPC closed"));
  await flush();
  assert.equal(other.dataset.state, "problem");
  assert.equal(other.find("pc-sync-status").textContent, "Sync could not run: IPC closed");
});

test("Set up this PC checks nothing until opened, then lists what is missing and gets a project", async () => {
  const fake = bridge({ syncStatus: answer() });
  const calls = [];
  let status = {
    ok: true, ready: false, account: null,
    tools: [{ id: "git", name: "Git", installed: true, version: "2.47.1" }, { id: "gh", name: "GitHub CLI", installed: true, version: "2.63.0" }, { id: "node", name: "Node.js", installed: false, version: null }],
    project: { root: "E:/code/app", github: "me/app", hook: true },
    steps: [{ id: "install-node", label: "Install Node.js", why: "Projects install their packages with it." }, { id: "github-login", label: "Sign in to GitHub", why: "So this PC can pull and push." }],
    notes: ["This project is on an exFAT drive. Move it."],
  };
  Object.assign(fake.api, {
    pcSetupStatus: async () => { calls.push("status"); return status; },
    pcSetupAction: async (id) => { calls.push(`action:${id}`); return { ok: true, message: "Finish in the setup window, then choose Check again." }; },
    pcSetupRepos: async () => { calls.push("repos"); return { ok: true, repos: [{ repo: "me/app", private: true }, { repo: "me/site", private: false }] }; },
    pcSetupClone: async (repo) => { calls.push(`clone:${repo}`); return { ok: true, folder: "C:\\code\\site" }; },
  });
  const card = environment(fake.api).sync.card();
  const box = card.find("pc-setup");
  assert.ok(box, "the card carries the section");
  assert.deepEqual(calls, [], "nothing runs until it is opened");
  assert.equal(card.find("pc-setup-get").disabled, true);
  box.open = true;
  box.listeners.toggle[0]({ type: "toggle" });
  await flush();
  assert.deepEqual(calls, ["status"]);
  assert.equal(card.find("pc-setup-status").textContent, "A few things to finish on this PC:");
  const checks = box.byClass("pc-setup-list").children.map((item) => item.textContent);
  assert.deepEqual(checks, ["✓ Git 2.47.1", "✓ GitHub CLI 2.63.0", "• Node.js is not installed", "• Not signed in to GitHub", "✓ This project is on GitHub (me/app)", "✓ Claude Code sessions in this project sync when they start", "• This project is on an exFAT drive. Move it."]);
  const steps = box.children.find((child) => child.children?.some((item) => item.dataset.step));
  assert.deepEqual(steps.children.map((item) => [item.dataset.step, item.textContent]), [["install-node", "Install Node.js"], ["github-login", "Sign in to GitHub"]]);
  assert.equal(card.find("pc-setup-get").disabled, true, "no repositories to list before a sign-in");
  steps.children[1].click();
  await flush();
  assert.equal(calls.at(-1), "action:github-login");
  assert.equal(card.find("pc-setup-status").textContent, "Finish in the setup window, then choose Check again.");
  status = { ...status, ready: true, account: "me", steps: [], notes: [] };
  card.find("pc-setup-check").click();
  await flush();
  assert.equal(card.find("pc-setup-status").textContent, "This PC is ready to share projects through GitHub.");
  assert.equal(card.find("pc-setup-get").disabled, false);
  card.find("pc-setup-get").click();
  await flush();
  const select = card.find("pc-setup-repos");
  assert.deepEqual(select.children.map((option) => [option.value, option.textContent]), [["me/app", "me/app (private)"], ["me/site", "me/site"]]);
  select.value = "me/site";
  card.find("pc-setup-clone").click();
  await flush();
  assert.deepEqual(calls.slice(-2), ["clone:me/site", "status"]);
  assert.match(card.find("pc-setup-status").textContent, /^This PC is ready|^Got me\/site into C:\\code\\site and opened it/);
});

test("Set up this PC is only offered where the desktop bridge has it", () => {
  const fake = bridge({ syncStatus: answer() });
  assert.equal(environment(fake.api).sync.card().find("pc-setup"), null);
});

test("the browser preview has no bridge, so the card says where syncing works", () => {
  const card = environment(undefined).sync.card();
  assert.equal(card.dataset.state, "unavailable");
  assert.equal(card.find("pc-sync-status").textContent, "Syncing your PCs works in the desktop app.");
  assert.equal(card.byClass("pc-sync-actions").hidden, true);
});

test("the Friends section mounts the card inside the hub, and the Friends bubble carries the badge", () => {
  const friends = hub.slice(hub.indexOf('} else if (section === "friends") {'), hub.indexOf("} else {", hub.indexOf('} else if (section === "friends") {')));
  assert.match(friends, /window\.MefiPcSync\?\.card\?\.\(\)/);
  assert.match(friends, /el\.extra\.append\(pcs\)/);
  assert.doesNotMatch(friends, /action\([^)]*MefiPcSync/, "Sync answers in place; it is not a navigate-away action");
  const badge = hub.slice(hub.indexOf("function syncBadge()"), hub.indexOf("function update(next)"));
  assert.match(badge, /\[data-hub-section="friends"\]/);
  assert.match(badge, /window\.MefiPcSync\?\.badge\?\.\(\)/);
  assert.match(hub, /window\.MefiPcSync\?\.subscribe\?\.\(\(\) => syncBadge\(\)\);/, "the badge follows every answer");
});

test("Keep this PC up to date reads and sets the switch; Linking this PC lists what is left with the place that finishes it", async () => {
  const fake = bridge({ syncStatus: answer() });
  const follows = [];
  const routes = [];
  const vault = { open: false, scrolled: 0, scrollIntoView() { this.scrolled += 1; } };
  Object.assign(fake.api, {
    syncFollow: async (on) => { follows.push(on); return { ok: true, on: on ?? false }; },
    pcSetupStatus: async () => ({ ok: true, ready: true, account: "me", tools: [], project: {}, steps: [], notes: [], links: [
      { id: "vault", done: false, label: "Not paired with your vault yet", action: "vault" },
      { id: "link-id", done: true, label: "Discord linking is set up on this PC", action: "community" },
      { id: "hub", done: false, label: "No rooms hub address yet (Settings › Community › Connection details)", action: "community" },
    ] }),
  });
  const card = environment(fake.api, { MefiNav: { go: (id) => routes.push(id) }, elements: { "pc-vault": vault } }).sync.card();
  await flush();
  const tick = card.find("pc-sync-follow");
  assert.equal(tick.checked, false, "the saved setting, off");
  tick.checked = true;
  tick.listeners.change[0]({ type: "change" });
  await flush();
  assert.deepEqual(follows, [undefined, true]);
  assert.equal(tick.checked, true);
  const box = card.find("pc-setup");
  box.open = true;
  box.listeners.toggle[0]({ type: "toggle" });
  await flush();
  const rows = card.find("pc-setup-links").children;
  assert.deepEqual(rows.map((row) => row.textContent), ["• Not paired with your vault yetOpen", "✓ Discord linking is set up on this PC", "• No rooms hub address yet (Settings › Community › Connection details)Open Settings"]);
  rows[0].children.find((child) => child.tagName === "BUTTON").click();
  assert.equal(vault.open, true, "Open opens Share between my PCs");
  rows[2].children.find((child) => child.tagName === "BUTTON").click();
  assert.deepEqual(routes, ["community"], "Open Settings goes to Settings › Community");
});

test("a long report reads as a few grouped lines, with the whole list one press away", async () => {
  const lines = [
    "Some work on this PC is not on GitHub yet.",
    "1 uncommitted file in this checkout.",
    "Worktree relay (wip/relay): 49 uncommitted files.",
    "Branch land/consolidate on this PC: 1 commit not on main.",
    "Branch ui/map on this PC: 2 commits not on main.",
    "Branch wip/agent-link on GitHub: 1 commit not on main.",
    "Branch wip/relay on GitHub: 2 commits not on main.",
    "Branch wip/ui-map on GitHub: 1 commit not on main.",
  ];
  const fake = bridge({ syncStatus: answer({ headline: lines[0], lines, pending: [{}], risk: 1 }) });
  const card = environment(fake.api).sync.card();
  fake.answer(0);
  await flush();
  const brief = card.byClass("pc-sync-brief");
  const full = card.byClass("pc-sync-list");
  assert.equal(brief.hidden, false);
  assert.deepEqual(brief.children.map((item) => item.textContent), [
    "1 uncommitted file in this checkout.",
    "1 other worktree has uncommitted work",
    "2 branches on this PC with commits not on main",
    "3 branches on GitHub not merged into main",
  ]);
  assert.equal(full.hidden, true);
  const toggle = card.find("pc-sync-toggle");
  assert.equal(toggle.textContent, "Show all 7");
  toggle.click();
  assert.equal(full.hidden, false);
  assert.equal(brief.hidden, true);
  assert.equal(full.children.length, 7);
  assert.equal(toggle.textContent, "Show less");
});
