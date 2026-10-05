// The Worker in front of the relay. It only routes: the health check is
// answered here, anything outside /v1/ or too large is refused here (so it
// never costs a Durable Object request), and the rest goes to the one Hub
// object, which holds every socket and the database.

import { Hub, jsonResponse } from './hub-object.mjs';
import { LIMITS, PROTOCOL_VERSION } from './protocol.mjs';

export { Hub };

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const ABOUT = `Mefi Studio relay

Passes room chat, listen-together, companions and cowork claims between Mefi
Studio apps. Chat is passed along and never stored; the code is public in the
mefi-studio repository under relay/.
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!METHODS.has(request.method)) return jsonResponse(405, { ok: false, error: 'method-not-allowed' });
    if (url.pathname === '/' && request.method === 'GET') return new Response(ABOUT, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    if (url.pathname === '/v1/health' && request.method === 'GET') {
      const body = { ok: true, protocol: PROTOCOL_VERSION, service: 'mefi-relay' };
      if (/^\d{17,20}$/.test(String(env.STUDIO_APP_ID ?? ''))) body.studioAppId = String(env.STUDIO_APP_ID);
      if (String(env.PAUSED ?? '') === 'true') body.paused = true;
      return jsonResponse(200, body);
    }
    if (!url.pathname.startsWith('/v1/')) return jsonResponse(404, { ok: false, error: 'not-found' });
    if (Number(request.headers.get('content-length') ?? 0) > LIMITS.bodyBytes) return jsonResponse(413, { ok: false, error: 'too-large' });
    return env.HUB.get(env.HUB.idFromName('hub')).fetch(request);
  },
};
