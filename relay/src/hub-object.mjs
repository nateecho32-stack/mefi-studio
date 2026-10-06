// The Hub Durable Object: one instance holds every Studio's WebSocket and the
// relay's SQLite database, and hands both to the platform-free core
// (relay.mjs). It uses the WebSocket Hibernation API, so an idle relay sleeps
// while sockets stay open; each socket's state rides in its attachment.
//
// A plain class (no import from "cloudflare:workers"): Cloudflare accepts it
// as a Durable Object, and the Node test adapter can load the same file.

import { createRelay } from './relay.mjs';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
});

export function jsonResponse(status, body) {
  const headers = { ...JSON_HEADERS };
  if ((status === 429 || status === 503) && Number(body?.retryAfter) > 0) headers['retry-after'] = String(Math.ceil(body.retryAfter / 1000));
  return new Response(JSON.stringify(body), { status, headers });
}

export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    const sql = {
      exec: (query, ...bindings) => ctx.storage.sql.exec(query, ...bindings).toArray(),
      transaction: (fn) => ctx.storage.transactionSync(fn),
    };
    const sockets = {
      list: () => ctx.getWebSockets(),
      read: (ws) => {
        try {
          return ws.deserializeAttachment();
        } catch {
          return null;
        }
      },
      write: (ws, value) => ws.serializeAttachment(value),
      send: (ws, text) => {
        try {
          ws.send(text);
        } catch {
          // a socket that is already closing
        }
      },
      close: (ws, code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          // already closed
        }
      },
    };
    const alarms = { get: () => ctx.storage.getAlarm(), set: (at) => ctx.storage.setAlarm(at) };
    const outbound = env?.[Symbol.for('mefi.relay.fetch')] ?? ((input, init) => fetch(input, init));
    const clock = env?.[Symbol.for('mefi.relay.now')] ?? (() => Date.now());
    this.relay = createRelay({ sql, sockets, alarms, env, fetch: outbound, now: clock });
    this.ready = ctx.blockConcurrencyWhile(() => this.relay.init());
    // Studio's keepalive: Cloudflare answers it without waking the relay or billing a request.
    if (typeof WebSocketRequestResponsePair === 'function') ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  /** Accept the server half of a WebSocket (fetch's upgrade, or the Node adapter's memory socket). */
  async acceptSocket(server, { ip = '' } = {}) {
    this.ctx.acceptWebSocket(server);
    if (this.relay.open(server, { ip })) await this.relay.schedule();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const ip = request.headers.get('cf-connecting-ip') ?? '';
    if (url.pathname === '/v1/ws') {
      if (String(request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') return jsonResponse(426, { ok: false, error: 'upgrade-required' });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      await this.acceptSocket(server, { ip });
      return new Response(null, { status: 101, webSocket: client });
    }
    const bodyText = request.method === 'GET' ? '' : await request.text();
    const result = await this.relay.http({ method: request.method, path: url.pathname, query: url.searchParams, headers: request.headers, bodyText, ip });
    return jsonResponse(result.status, result.body);
  }

  async webSocketMessage(ws, message) {
    await this.relay.message(ws, message);
  }

  async webSocketClose(ws) {
    this.relay.closed(ws);
    try {
      ws.close(1000, 'closed');
    } catch {
      // the runtime already answered the close
    }
  }

  async webSocketError(ws) {
    this.relay.closed(ws);
  }

  async alarm() {
    await this.relay.alarm();
  }
}
