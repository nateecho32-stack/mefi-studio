// The Agents overview's live cards must not rebuild while the sheet is closed
// or when a status push changes nothing they show (Command-view mutation cost).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/agents.js", import.meta.url), "utf8");
const start = source.indexOf("  let overviewPainted = null");
const end = source.indexOf("  function queueToggle(");
assert.ok(start > 0 && end > start, "paintOverview slice not found in renderer/agents.js");

function element(id) {
  const el = { id, hidden: false, children: [], rebuilds: 0, removes: 0 };
  el.append = (...items) => { el.children.push(...items); el.rebuilds++; };
  Object.defineProperty(el, "lastChild", { get: () => ({ remove: () => { el.children.pop(); el.removes++; } }) });
  return el;
}

function harness() {
  const overlay = element("agents-overlay"); overlay.hidden = true;
  const live = element("agents-overview-live"); live.children.push("title", "detail");
  const hub = element("agents-work-hub"); hub.children.push("title", "detail");
  const ids = { "agents-overlay": overlay, "agents-overview-live": live, "agents-work-hub": hub };
  const context = vm.createContext({
    $: (id) => ids[id] || null,
    node: (tag, cls, text) => ({ tag, cls, text }),
    button: (text) => ({ tag: "button", text }),
    go: () => {}, window: {}, JSON,
    queue: { known: true }, liveStatus: null, liveAssistant: null,
  });
  vm.runInContext(`${source.slice(start, end)}; this.paintOverview = paintOverview;`, context);
  return { context, overlay, live, hub };
}

test("closed Agents sheet skips overview paints, then paints once when it opens", () => {
  const { context, overlay, live, hub } = harness();
  context.liveStatus = { running: [{ title: "Build", phase: "coding", taskId: "t1" }] };
  for (let i = 0; i < 10; i++) context.paintOverview();
  assert.equal(live.rebuilds, 0); assert.equal(hub.rebuilds, 0);
  overlay.hidden = false; context.paintOverview();
  assert.ok(live.rebuilds > 0 && hub.rebuilds > 0);
  assert.ok(live.children.some((item) => item.text === "Build · coding"));
});

test("open sheet rebuilds only when the shown data changes", () => {
  const { context, overlay, live, hub } = harness();
  overlay.hidden = false;
  context.liveAssistant = { questions: [{ status: "open", title: "Pick a model" }], agents: [{ role: "Lead", status: "running" }], mail: [] };
  context.paintOverview();
  const painted = [live.rebuilds, hub.rebuilds, live.children.length];
  // Fresh objects with identical content, as each status push delivers.
  for (let i = 0; i < 5; i++) { context.liveAssistant = JSON.parse(JSON.stringify(context.liveAssistant)); context.paintOverview(); }
  assert.deepEqual([live.rebuilds, hub.rebuilds, live.children.length], painted);
  context.liveAssistant = { ...context.liveAssistant, agents: [{ role: "Lead", status: "running", step: "tests" }] };
  context.paintOverview();
  assert.ok(hub.rebuilds > painted[1]);
  assert.ok(hub.children.some((item) => item.text === "Lead · running · tests"));
  assert.equal(live.children.length, painted[2], "repaint replaces rather than appends");
});
