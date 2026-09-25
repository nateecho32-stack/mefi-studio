import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// The real preload.cjs, run with a fake contextBridge and ipcRenderer: each
// community method must reach exactly its main.cjs channel with exactly the
// payload the handler reads, and the event must hand the renderer the bare
// status. renderer/community.js codes against these names.

const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");

function bridge() {
  const invoked = [];
  const listeners = [];
  // executeInMainWorld runs the bridge's installer against this context,
  // which stands in for the page's window.
  const page = {
    require: (request) => {
      assert.equal(request, "electron");
      return {
        contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
        ipcRenderer: {
          invoke: async (channel, ...args) => { invoked.push({ channel, args }); return { ok: true }; },
          on: (channel, listener) => listeners.push({ channel, listener }),
        },
      };
    },
  };
  vm.runInNewContext(preloadSource, page);
  return { name: Object.keys(page).find((key) => key === "mefiStudio") ?? null, api: page.mefiStudio, invoked, listeners };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("every community method reaches its own channel", async () => {
  const { name, api, invoked } = bridge();
  assert.equal(name, "mefiStudio");
  const expected = [
    ["communityStatus", [], "community:status", []],
    ["communityLink", [], "community:link", []],
    ["communityLinkCancel", [], "community:link-cancel", []],
    ["communityCheck", [], "community:check", []],
    ["communityUnlink", [], "community:unlink", []],
    ["communityPrompt", ["snooze"], "community:prompt", [{ action: "snooze" }]],
    ["communityOpen", ["invite"], "community:open", [{ target: "invite" }]],
  ];
  for (const [method, args, channel, payload] of expected) {
    assert.equal(typeof api[method], "function", method);
    invoked.length = 0;
    assert.deepEqual(plain(await api[method](...args)), { ok: true }, method);
    assert.equal(invoked.length, 1, method);
    assert.equal(invoked[0].channel, channel, method);
    assert.deepEqual(plain(invoked[0].args), payload, method);
  }
});

test("prompt and open pass a name, never an object or a URL of the renderer's making", async () => {
  const { api, invoked } = bridge();
  await api.communityPrompt({ action: "never" });
  await api.communityOpen({ href: "https://evil.example" });
  await api.communityOpen();
  assert.deepEqual(plain(invoked.map((call) => call.args[0])), [{ action: null }, { target: null }, { target: null }]);
  await api.communityOpen("https://evil.example");
  assert.deepEqual(plain(invoked.at(-1).args[0]), { target: "https://evil.example" }, "a string passes through as a name; main maps names to its own URLs");
});

test("onCommunityEvent listens on community:event and hands over the bare status", () => {
  const { api, listeners } = bridge();
  const seen = [];
  api.onCommunityEvent((status) => seen.push(status));
  const mine = listeners.filter((entry) => entry.channel === "community:event");
  assert.equal(mine.length, 1);
  const status = { available: true, linked: false, entitlement: { premium: false } };
  mine[0].listener({ sender: "ipc-event" }, status);
  assert.deepEqual(seen, [status], "the IPC event object stays in the preload");
});

test("the bridge exposes no way to read a Discord token", () => {
  const { api } = bridge();
  const community = Object.keys(api).filter((key) => /community/i.test(key)).sort();
  assert.deepEqual(community, [
    "communityCheck", "communityLink", "communityLinkCancel", "communityOpen", "communityPrompt", "communityStatus", "communityUnlink", "onCommunityEvent",
  ]);
  assert.ok(!Object.keys(api).some((key) => /discord|token/i.test(key)));
});
