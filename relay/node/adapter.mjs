// The relay under Node, for tests: the real Worker (src/worker.mjs) and the
// real Hub Durable Object class (src/hub-object.mjs) over a fake Durable
// Object state. SQLite is node:sqlite; sockets are in-memory pairs whose
// client half has the shape Studio's scripts/hub-client.cjs expects of a
// WebSocket. Nothing listens on a port.
//
//   const relay = createNodeRelay({ env, discord, now });
//   relay.fetch(href, init)        -> Response   (fetch-shaped, for hub-client)
//   new relay.WebSocket(url)       -> a client socket (opens on the next tick)
//   relay.hibernate()              -> drop the Hub instance's memory, keep its database and sockets
//   await relay.runAlarm()         -> run a due alarm now
//   relay.sql(query, ...b)         -> rows, to look inside the database
//
// discord: { [accessToken]: { user: { id, username, global_name? }, member?: {...} | null, scopes?, appId? } }
// answers the relay's calls to Discord; a token that is not listed gets 401.

import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.mjs';
import { Hub } from '../src/hub-object.mjs';

export const TEST_APP_ID = '100000000000000001';
export const TEST_GUILD_ID = '1345380333302059129';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that plays Discord's two endpoints (and refuses everything else, like oEmbed), on the relay's clock. */
export function fakeDiscord(accounts, { calls = [], now = () => Date.now() } = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const token = /^Bearer (.+)$/.exec(String(init.headers?.authorization ?? ''))?.[1] ?? '';
    calls.push({ path: url.pathname, token });
    const account = accounts[token];
    if (url.hostname !== 'discord.com') return json(404, {});
    if (!account) return json(401, { message: '401: Unauthorized', code: 0 });
    if (account.down) return json(503, {});
    if (url.pathname === '/api/v10/oauth2/@me') {
      return json(200, {
        application: { id: account.appId ?? TEST_APP_ID },
        scopes: account.scopes ?? ['identify', 'guilds.members.read'],
        expires: new Date(now() + 7 * 86_400_000).toISOString(),
        user: account.user,
      });
    }
    if (url.pathname === `/api/v10/users/@me/guilds/${TEST_GUILD_ID}/member`) {
      if (account.member === null) return json(404, { message: 'Unknown Guild', code: 10004 });
      return json(200, { user: account.user, roles: [], joined_at: new Date(now() - 30 * 86_400_000).toISOString(), pending: false, ...(account.member ?? {}) });
    }
    return json(404, {});
  };
}

class ServerSocket {
  constructor(client) {
    this.client = client;
    this.attachment = null;
    this.open = true;
  }
  serializeAttachment(value) {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > 16_384) throw new Error('attachment over 16 KB');
    this.attachment = JSON.parse(text);
  }
  deserializeAttachment() {
    return this.attachment === null ? null : JSON.parse(JSON.stringify(this.attachment));
  }
  send(text) {
    if (!this.open) throw new Error('socket closed');
    const client = this.client;
    queueMicrotask(() => client.deliver(text));
  }
  close(code = 1000) {
    if (!this.open) return;
    this.open = false;
    const client = this.client;
    queueMicrotask(() => client.ended(code));
  }
}

export function createNodeRelay({ env: extraEnv = {}, discord = {}, now = () => Date.now(), fetchCalls = [] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const servers = new Set();
  let alarmAt = null;
  let autoResponse = null;
  let depth = 0;
  const ctx = {
    storage: {
      sql: { exec: (query, ...bindings) => ({ toArray: () => db.prepare(query).all(...bindings) }) },
      transactionSync(fn) {
        if (depth > 0) return fn();
        depth += 1;
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = fn();
          db.exec('COMMIT');
          return out;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        } finally {
          depth -= 1;
        }
      },
      getAlarm: async () => alarmAt,
      setAlarm: async (at) => {
        alarmAt = at;
      },
    },
    getWebSockets: () => [...servers].filter((ws) => ws.open),
    acceptWebSocket: (ws) => servers.add(ws),
    setWebSocketAutoResponse: (pair) => {
      autoResponse = pair;
    },
    blockConcurrencyWhile: (fn) => fn(),
  };
  const env = {
    STUDIO_APP_ID: TEST_APP_ID,
    GUILD_ID: TEST_GUILD_ID,
    ...extraEnv,
    [Symbol.for('mefi.relay.fetch')]: fakeDiscord(discord, { calls: fetchCalls, now: now ?? (() => Date.now()) }),
    [Symbol.for('mefi.relay.now')]: now,
  };
  // Cloudflare's auto-response pair, which Node does not have.
  if (typeof globalThis.WebSocketRequestResponsePair !== 'function') {
    globalThis.WebSocketRequestResponsePair = class {
      constructor(request, response) {
        this.request = request;
        this.response = response;
      }
    };
  }
  let hub = new Hub(ctx, env);
  const stub = { fetch: async (request) => (await hub.ready, hub.fetch(request)) };
  env.HUB = { idFromName: (name) => name, get: () => stub };

  async function relayFetch(href, init = {}) {
    return worker.fetch(new Request(href, init), env);
  }

  class ClientSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url, { ip = '127.0.0.1' } = {}) {
      this.url = String(url);
      this.readyState = 0;
      this.received = [];
      this.server = new ServerSocket(this);
      setTimeout(async () => {
        await hub.ready;
        await hub.acceptSocket(this.server, { ip });
        if (!this.server.open) return;
        this.readyState = 1;
        this.onopen?.({});
      }, 0);
    }
    send(text) {
      if (this.readyState !== 1) throw new Error('not open');
      const pair = autoResponse;
      // Cloudflare's auto-response: an exact match is answered without waking the relay.
      if (pair && text === pair.request) {
        queueMicrotask(() => this.deliver(pair.response));
        return;
      }
      const server = this.server;
      queueMicrotask(() => hub.webSocketMessage(server, text));
    }
    close(code = 1000) {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      this.server.open = false;
      hub.webSocketClose(this.server, code, '', true);
      queueMicrotask(() => this.onclose?.({ code }));
    }
    deliver(text) {
      if (this.readyState !== 1) return;
      this.received.push(JSON.parse(text));
      this.onmessage?.({ data: text });
    }
    ended(code) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({ code });
    }
  }

  return {
    fetch: relayFetch,
    WebSocket: ClientSocket,
    env,
    sql: (query, ...bindings) => db.prepare(query).all(...bindings),
    autoResponse: () => autoResponse,
    alarmAt: () => alarmAt,
    async runAlarm() {
      await hub.ready;
      await hub.alarm();
    },
    /** The relay sleeps and wakes: a new Hub instance over the same database and sockets. */
    hibernate() {
      hub = new Hub(ctx, env);
      return hub.ready;
    },
    get hub() {
      return hub;
    },
    sockets: () => [...servers].filter((ws) => ws.open),
    close() {
      for (const ws of servers) ws.open = false;
      db.close();
    },
  };
}
