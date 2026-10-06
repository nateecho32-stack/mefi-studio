// A real-network check of a running relay: `wrangler dev` on this PC, or the
// deployed workers.dev address. Uses Node's own fetch and WebSocket.
//
//   node scripts/smoke.mjs https://mefi-relay.<you>.workers.dev
//       health, sign-in refusals, the WebSocket handshake rules and the keepalive
//   node scripts/smoke.mjs http://127.0.0.1:8787 --fake-discord 8799
//       the same, then two Studios (Studio's real scripts/hub-client.cjs)
//       through a whole session against a local fake Discord. Start the relay with
//       wrangler dev --var STUDIO_APP_ID:100000000000000001 --var DISCORD_API_BASE:http://127.0.0.1:8799
//
// Exit code 0 when every check passed.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const base = (args.find((arg) => /^https?:\/\//.test(arg)) ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const fakePort = Number(args[args.indexOf('--fake-discord') + 1]) || null;
const wsBase = base.replace(/^http/, 'ws');
const APP_ID = '100000000000000001';
let failures = 0;

function check(ok, what, detail = '') {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}\n`);
  if (!ok) failures += 1;
}
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(test, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await wait(25);
  }
  return null;
}

function socket() {
  const ws = new WebSocket(`${wsBase}/v1/ws`);
  const frames = [];
  let closedWith = null;
  ws.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))));
  ws.addEventListener('close', (event) => {
    closedWith = event.code;
  });
  const opened = new Promise((done, fail) => {
    ws.addEventListener('open', done, { once: true });
    ws.addEventListener('error', fail, { once: true });
  });
  return { ws, frames, opened, closed: () => closedWith };
}

async function basics() {
  const health = await fetch(`${base}/v1/health`, { redirect: 'error' });
  const body = await health.json();
  check(health.status === 200 && body.ok === true && body.protocol === 1, 'health answers', JSON.stringify(body));
  check(/^\d{17,20}$/.test(String(body.studioAppId ?? '')), 'health names the Studio Link app', String(body.studioAppId ?? 'missing'));

  const refused = await fetch(`${base}/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: 'not-a-real-token' }) });
  check([401, 503].includes(refused.status), 'a made-up Discord token is refused', String(refused.status));
  const lost = await fetch(`${base}/nope`);
  check(lost.status === 404, 'unknown paths are 404', String(lost.status));
  const unauth = await fetch(`${base}/v1/rooms`);
  check(unauth.status === 401, 'rooms need a session', String(unauth.status));

  const ping = socket();
  await ping.opened;
  ping.ws.send('{"type":"ping"}');
  check(Boolean(await until(() => ping.frames.find((frame) => frame.type === 'pong'))), 'the keepalive ping gets a pong');
  ping.ws.send(JSON.stringify({ type: 'hello', session: 'v1.bad.bad', protocol: 1 }));
  check((await until(() => ping.closed())) === 4001, 'a bad session closes with 4001', String(ping.closed()));

  const version = socket();
  await version.opened;
  version.ws.send(JSON.stringify({ type: 'hello', session: 'v1.x.y', protocol: 2 }));
  check((await until(() => version.closed())) === 4002, 'another protocol version closes with 4002', String(version.closed()));
}

function fakeDiscord(port) {
  const users = {
    'smoke-alice': { id: '200000000000000001', username: 'alice', global_name: 'Alice' },
    'smoke-bob': { id: '200000000000000002', username: 'bob', global_name: 'Bob' },
  };
  const server = createServer((req, res) => {
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
    const user = users[token];
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!user) return send(401, { message: '401: Unauthorized' });
    if (req.url === '/oauth2/@me') return send(200, { application: { id: APP_ID }, scopes: ['identify', 'guilds.members.read'], expires: new Date(Date.now() + 86_400_000).toISOString(), user });
    if (/^\/users\/@me\/guilds\/\d+\/member$/.test(req.url)) return send(200, { user, roles: user.id.endsWith('1') ? ['300000000000000001'] : [], joined_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), pending: false });
    return send(404, {});
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

async function session() {
  const hub = require('../../scripts/hub-client.cjs');
  const make = (token) => {
    const events = [];
    const client = hub.createHubClient({ url: base, getAccessToken: async () => ({ ok: true, token }), onEvent: (event) => events.push(event) });
    return { client, events, of: (type) => events.filter((event) => event.type === type) };
  };
  const alice = make('smoke-alice');
  const bob = make('smoke-bob');
  await alice.client.connect();
  await bob.client.connect();
  check(Boolean(await until(() => alice.client.status().state === 'ready' && bob.client.status().state === 'ready')), 'two Studios connect', `${alice.client.status().state}/${bob.client.status().error ?? ''}`);
  const made = await alice.client.createRoom({ kind: 'cowork', name: `Smoke ${Date.now() % 10000}`, policy: 'request', listed: true });
  check(made.ok, 'a room is made', made.error ?? made.reason ?? '');
  if (!made.ok) return;
  const roomId = made.room.id;
  const asked = await bob.client.requestJoin(roomId, 'smoke test');
  const decided = await alice.client.decide(asked.request?.id, 'approve');
  check(decided.request?.status === 'approved', 'a join request is approved');
  alice.client.subscribe(roomId);
  bob.client.subscribe(roomId);
  check(Boolean(await until(() => bob.of('presence').some((event) => event.inStudio.length === 2))), 'both are present in the room');
  const sent = await alice.client.sendMessage(roomId, 'hello over the real network');
  check(sent.ok, 'a message is sent', sent.reason ?? '');
  check(Boolean(await until(() => bob.of('message').some((event) => event.message.text === 'hello over the real network'))), 'the other Studio receives it');
  const played = await alice.client.listen(roomId, { action: 'start', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', label: 'Me at the zoo', provider: 'youtube' });
  check(played.ok && Boolean(await until(() => bob.of('listen').some((event) => event.session?.label === 'Me at the zoo'))), 'listen together reaches the room');
  const claim = await alice.client.claim(roomId, { machineId: 'pc-smoke', paths: ['src/**'], runId: 'smoke' });
  const clash = await bob.client.claim(roomId, { machineId: 'pc-smoke-2', paths: ['src/a.js'], runId: 'smoke2' });
  check(claim.ok && clash.error === 'conflict', 'cowork claims conflict as they should');
  check(alice.client.sendCompanion(roomId, { v: 1, name: 'Pip' }) && Boolean(await until(() => bob.of('companion').length)), 'a companion card crosses');
  await alice.client.releaseClaim(claim.leaseId);
  await alice.client.listen(roomId, { action: 'stop' });
  check((await alice.client.close(roomId)).ok, 'the room closes');
  await alice.client.disconnect();
  await bob.client.disconnect();
}

let discord = null;
try {
  if (fakePort) discord = await fakeDiscord(fakePort);
  await basics();
  if (fakePort) await session();
} catch (error) {
  check(false, 'the smoke run finished', error?.message ?? String(error));
} finally {
  discord?.close();
}
process.stdout.write(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
