// Team › Connectors (renderer/connectors.js) in a bare context with the shared fake DOM and a recording bridge
// that keeps its own small list: what the page shows for each connector, adding one and approving exactly what
// was shown, testing, tools off, places, the switch, a saved value, importing from other apps and the featured
// ones. The host's rules are tests/connectors.test.mjs; real geometry is tests/team_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createDom, Element } from "./fixtures/renderer-dom.mjs";

const source = readFileSync(new URL("../renderer/connectors.js", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 2)); };
const words = (node) => node.textContent.replace(/\s+/g, " ").trim();

function environment() {
  const dom = createDom();
  const calls = [], toasts = [];
  const servers = [
    { id: "docs", title: "docs", transport: "stdio", line: "node docs.js", status: "ready", fingerprint: "f-docs", enabled: true, places: ["builders"], envKeys: ["DOCS_KEY"], saved: [], standIns: [], missing: ["DOCS_KEY"], handWritten: true, tested: { at: Date.now() - 120000, ok: true, ms: 1200, found: 2, skipped: 0, error: "" }, approvedAt: 0, source: "", addedAt: 0,
      tools: [{ name: "search", description: "Search docs", off: false }, { name: "read", description: "Read a page", off: false }] },
  ];
  const view = (row) => structuredClone(row);
  const bridge = {
    connectorsList: async () => { calls.push(["list"]); return { ok: true, file: "~/.mefi-studio/mcp.json", secretsSafe: true, servers: servers.map(view), featured: [{ id: "playwright", title: "Playwright browser", description: "A real browser.", line: "npx -y @playwright/mcp@latest", needs: "Node.js", added: servers.some((row) => row.id === "playwright") }] }; },
    connectorsAdd: async (draft) => {
      calls.push(["add", plain(draft)]);
      const row = { id: draft.name, title: draft.name, transport: "stdio", line: draft.line, status: "needs-approval", fingerprint: `f-${draft.name}`, enabled: true, places: draft.places, envKeys: draft.envKeys ?? [], saved: Object.keys(draft.values ?? {}), standIns: [], missing: [], handWritten: false, tested: null, approvedAt: 0, source: "", addedAt: 1, tools: [] };
      servers.push(row); return { ok: true, server: view(row) };
    },
    connectorsFeatured: async (id) => { calls.push(["featured", id]); const row = { ...servers[0], id, title: "Playwright browser", status: "needs-approval", fingerprint: "f-pw", tools: [], handWritten: false }; servers.push(row); return { ok: true, server: view(row) }; },
    connectorsApprove: async (payload) => { calls.push(["approve", plain(payload)]); const row = servers.find((item) => item.id === payload.id); if (row.fingerprint !== payload.fingerprint) return { ok: false, error: "changed" }; row.status = "ready"; return { ok: true, server: view(row) }; },
    connectorsTest: async (id) => { calls.push(["test", id]); const row = servers.find((item) => item.id === id); row.tools = [{ name: "go", description: "Go", off: false }]; return { ok: true, ms: 900, tools: [{ name: "go" }], skipped: [], server: view(row) }; },
    connectorsUpdate: async (payload) => { calls.push(["update", plain(payload)]); const row = servers.find((item) => item.id === payload.id); if (payload.places) row.places = payload.places; if (payload.off) row.tools.forEach((tool) => { tool.off = payload.off.includes(tool.name); }); if (typeof payload.enabled === "boolean") { row.enabled = payload.enabled; row.status = payload.enabled ? "ready" : "off"; } return { ok: true, server: view(row) }; },
    connectorsRemove: async (id) => { calls.push(["remove", id]); servers.splice(servers.findIndex((item) => item.id === id), 1); return { ok: true, id }; },
    connectorsSecret: async (payload) => { calls.push(["secret", plain(payload)]); const row = servers.find((item) => item.id === payload.id); row.saved = payload.value ? [payload.key] : []; row.missing = payload.value ? [] : [payload.key]; return { ok: true, server: view(row) }; },
    connectorsCandidates: async () => { calls.push(["candidates"]); return { ok: true, secretsSafe: true, candidates: [{ key: "k1", name: "memory", line: "npx -y @modelcontextprotocol/server-memory", envKeys: [], hasValues: false, source: "Claude Code (~/.claude.json)", alsoIn: [], supported: true, why: "", added: null }, { key: "k2", name: "old", line: "https://x/sse", envKeys: [], hasValues: false, source: "Cursor", alsoIn: [], supported: false, why: "This connector uses the older SSE connection, which Studio can't use.", added: null }] }; },
    connectorsImport: async (payload) => { calls.push(["import", plain(payload)]); return { ok: true, added: ["memory"], valuesKept: [], skipped: [] }; },
    onSettingsChanged: () => {},
  };
  const window = { mefiStudio: bridge, MefiToast: (text, tone = "good") => toasts.push({ text, tone }) };
  vm.runInNewContext(source, { window, document: dom.document, Array, JSON, Promise, String, Number, Math, Set, Map, Date, Error, Object, structuredClone, setTimeout, clearTimeout });
  const root = new Element("div", "agents-connectors");
  return { dom, root, calls, toasts, servers, page: window.MefiConnectors };
}
const rowOf = (root, id) => root.querySelectorAll(".connectors-row-card").find((row) => row.dataset.id === id);
const buttonIn = (node, label) => node.querySelectorAll("button").find((button) => words(button) === label);

test("each connector shows its state, what it runs, its tools, where it is used and the settings it needs", async () => {
  const t = environment();
  t.page.mount(t.root);
  await settle();
  assert.ok(t.root.classList.contains("connectors-page"));
  const docs = rowOf(t.root, "docs");
  assert.equal(docs.dataset.status, "ready");
  assert.match(words(docs), /Ready/); assert.match(words(docs), /2 tools/); assert.match(words(docs), /node docs\.js/); assert.match(words(docs), /Tested 2 min ago: started in 1\.2 s, 2 tools/);
  assert.deepEqual(docs.querySelectorAll(".connectors-tool").map((tool) => [tool.textContent, tool.getAttribute("aria-pressed")]), [["search", "true"], ["read", "true"]]);
  assert.deepEqual(docs.querySelectorAll(".connectors-place").map((place) => [place.dataset.place, place.getAttribute("aria-pressed")]), [["chat", "false"], ["agents", "false"], ["builders", "true"]]);
  assert.match(words(docs), /DOCS_KEYNo value yet/);
  assert.match(words(t.root.querySelector(".connectors-budget")), /Builders tools2\/16/);
  assert.match(words(t.root.querySelector(".connectors-featured")), /Playwright browser/);
  assert.match(words(t.root), /Grok and Antigravity can't receive connectors/);
});

test("adding one sends the command and settings, then approves exactly what it showed and tests it", async () => {
  const t = environment();
  t.page.mount(t.root);
  await settle();
  await buttonIn(t.root, "Add a connector").click();
  const panel = t.root.querySelector("#connectors-add");
  assert.ok(panel);
  const inputs = panel.querySelectorAll("input");
  const [name, line, keys] = inputs;
  name.value = "github"; await name.trigger("input");
  line.value = "npx -y @modelcontextprotocol/server-github"; await line.trigger("input");
  keys.value = "GITHUB_PERSONAL_ACCESS_TOKEN"; await keys.trigger("input");
  const value = t.root.querySelector("#connectors-add").querySelectorAll("input").find((input) => input.type === "password");
  value.value = "ghp_secret"; await value.trigger("input");
  await buttonIn(t.root.querySelector("#connectors-add"), "Add it").click();
  await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "add")[1], { name: "github", places: ["builders"], line: "npx -y @modelcontextprotocol/server-github", envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"], values: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_secret" } });
  const approve = t.root.querySelector("#connectors-approve");
  assert.ok(approve, "what was added waits for approval, shown with its command");
  assert.match(words(approve), /Studio never starts a connector you have not approved/);
  assert.match(words(approve), /npx -y @modelcontextprotocol\/server-github/);
  await buttonIn(approve, "Approve and test").click();
  await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "approve")[1], { id: "github", fingerprint: "f-github" });
  assert.deepEqual(t.calls.filter(([name]) => name === "test").map(([, id]) => id), ["github"]);
  assert.equal(rowOf(t.root, "github").dataset.status, "ready");
  assert.equal(t.root.querySelector("#connectors-approve"), null);
});

test("tools off, places, the switch, a saved value and Remove each send one change", async () => {
  const t = environment();
  t.page.mount(t.root);
  await settle();
  await rowOf(t.root, "docs").querySelectorAll(".connectors-tool")[1].click(); await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "update").at(-1)[1], { id: "docs", off: ["read"] });
  await rowOf(t.root, "docs").querySelectorAll(".connectors-place")[0].click(); await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "update").at(-1)[1], { id: "docs", places: ["builders", "chat"] });
  const toggle = rowOf(t.root, "docs").querySelector(".connectors-switch");
  toggle.checked = false; await toggle.trigger("change"); await settle();
  assert.deepEqual(t.calls.filter(([name]) => name === "update").at(-1)[1], { id: "docs", enabled: false });
  const setting = rowOf(t.root, "docs").querySelector(".connectors-setting");
  const input = setting.querySelector("input"); input.value = "k3y";
  await buttonIn(setting, "Save").click(); await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "secret")[1], { id: "docs", key: "DOCS_KEY", value: "k3y" });
  assert.match(words(rowOf(t.root, "docs")), /Saved in Studio/);
  await buttonIn(rowOf(t.root, "docs"), "Remove").click(); await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "remove"), ["remove", "docs"]);
  assert.equal(rowOf(t.root, "docs"), undefined);
  assert.match(words(t.root), /No connectors yet/);
});

test("import lists other apps' servers, never the ones Studio can't use, and brings in only what was picked", async () => {
  const t = environment();
  t.page.mount(t.root);
  await settle();
  await buttonIn(t.root, "Import from other apps").click();
  await settle();
  const panel = t.root.querySelector("#connectors-import");
  const rows = panel.querySelectorAll(".connectors-import-row");
  assert.deepEqual(rows.map((row) => row.dataset.key), ["k1", "k2"]);
  assert.equal(rows[1].querySelector("input").disabled, true); assert.match(words(rows[1]), /older SSE connection/);
  const go = () => buttonIn(t.root.querySelector("#connectors-import"), "Import") ?? buttonIn(t.root.querySelector("#connectors-import"), "Import 1");
  assert.equal(go().disabled, true, "nothing picked, nothing to import");
  const pick = rows[0].querySelector("input"); pick.checked = true; await pick.trigger("change");
  assert.equal(buttonIn(t.root.querySelector("#connectors-import"), "Import 1").disabled, false);
  await buttonIn(t.root.querySelector("#connectors-import"), "Import 1").click(); await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "import")[1], { keys: ["k1"], values: false });
  assert.match(t.toasts.at(-1).text, /1 connector added\. Approve each one to use it\./);
  assert.equal(t.root.querySelector("#connectors-import"), null);
});

test("a featured connector is added for approval, never started by itself", async () => {
  const t = environment();
  t.page.mount(t.root);
  await settle();
  await buttonIn(t.root.querySelector(".connectors-featured"), "Add").click(); await settle();
  assert.deepEqual(t.calls.find(([name]) => name === "featured"), ["featured", "playwright"]);
  assert.equal(t.calls.some(([name]) => name === "test" || name === "approve"), false);
  assert.ok(t.root.querySelector("#connectors-approve"), "it opens on its approval");
});
