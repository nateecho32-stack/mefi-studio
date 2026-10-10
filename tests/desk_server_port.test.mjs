// The desk server survives an engine relaunch (docs/plans/scratch-tier.md
// WP0-B): a new server rebinds the port and token the last one saved, falls
// back to an OS-picked port when the saved one is taken, and the Agent Brain
// host keeps that state through its deskState collaborator and registers an
// adopted run's owner without writing new config files. Real loopback
// sockets, no files, no model calls.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import deskServer from "../scripts/desk-server.cjs";
import host from "../scripts/agent-brain-host.cjs";

const post = (url, token, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-mefi-desk-token": token }, body: JSON.stringify(body) });

test("a relaunched desk server rebinds the saved port and token", async () => {
  const first = deskServer.createDeskServer({ handle: async () => ({ ok: true, answer: "one" }) });
  const saved = await first.start();
  assert.match(saved.url, /^http:\/\/127\.0\.0\.1:\d+\/desk$/);
  assert.equal(saved.port, Number(saved.url.match(/:(\d+)\//)[1]));
  assert.equal(saved.reused, false, "a fresh start picked its own port");
  await first.stop();
  const second = deskServer.createDeskServer({ handle: async () => ({ ok: true, answer: "two" }), port: saved.port, token: saved.token });
  const again = await second.start();
  try {
    assert.equal(again.port, saved.port, "the same port");
    assert.equal(again.token, saved.token, "the same token");
    assert.equal(again.reused, true);
    const answer = await post(again.url, saved.token, { question: "still there?" });
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { ok: true, answer: "two", escalated: false });
  } finally {
    await second.stop();
  }
});

test("a saved port that is taken falls back to an OS-picked one, and says so", async () => {
  const squatter = net.createServer();
  await new Promise((resolve) => squatter.listen(0, "127.0.0.1", resolve));
  const taken = squatter.address().port;
  const server = deskServer.createDeskServer({ handle: async () => ({ ok: true }), port: taken, token: "ab".repeat(24) });
  try {
    const address = await server.start();
    assert.notEqual(address.port, taken);
    assert.equal(address.reused, false);
    assert.equal(address.token, "ab".repeat(24), "the token is kept even when the port moved");
    assert.equal(server.port, taken, "the server remembers what it wanted");
  } finally {
    await server.stop();
    await new Promise((resolve) => squatter.close(resolve));
  }
  const odd = deskServer.createDeskServer({ handle: async () => ({ ok: true }), port: 99999999 });
  const address = await odd.start();
  try { assert.equal(address.reused, false, "an impossible saved port is ignored"); }
  finally { await odd.stop(); }
});

test("the Agent Brain host saves the desk's address, rebinds it next time and registers an adopted run's owner", async () => {
  const dir = path.join(process.cwd(), "fixture-only-brain");
  let state = null;
  const deskState = { read: async () => state, write: async (next) => { state = { ...next }; } };
  const brainA = host.createAgentBrain({ dataFile: (name) => path.join(dir, name), deskState });
  const scriptFile = path.join(process.cwd(), "scripts", "desk-mcp.mjs");
  const files = await brainA.prepareDeskTool({ taskId: "t1", runId: "r1", script: scriptFile });
  assert.ok(files?.claude, "the first engine writes the run's config");
  assert.ok(state && Number.isInteger(state.port) && typeof state.token === "string", "its address is saved");
  const config = JSON.parse(await (await import("node:fs/promises")).readFile(files.claude, "utf8"));
  assert.equal(config.mcpServers.mefi_desk.env.MEFI_DESK_URL, `http://127.0.0.1:${state.port}/desk`);
  // The first engine is gone: its server too. The next one rebinds.
  brainA.releaseDeskTool("r1");
  const serverA = await brainA.prepareDeskTool({ taskId: "t1", runId: "r2", script: scriptFile });
  brainA.releaseDeskTool("r2");
  assert.ok(serverA, "the first engine still served while it lived");
  const brainB = host.createAgentBrain({ dataFile: (name) => path.join(dir, name), deskState });
  // The port is still held by brainA's server until it stops: adoption falls
  // back and says the desk is not the one the run was started with.
  assert.equal(await brainB.adoptDeskTool({ runId: "r1" }), false, "the saved port was taken, so the adopted run's old config no longer reaches this desk");
  const brainC = host.createAgentBrain({ dataFile: (name) => path.join(dir, name), deskState: { read: async () => null, write: async () => {} } });
  assert.equal(await brainC.adoptDeskTool({ runId: "r1" }), false, "with no saved address the run's old config points nowhere");
  assert.equal(await brainC.adoptDeskTool({}), false);
});
