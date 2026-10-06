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

// What a join link opens in a browser: the code, and where to put it. The code
// is the only thing on the page, checked against the code alphabet above.
function joinPage(code) {
  const shown = /^[A-Z0-9]{8}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Join a room in Mefi Studio</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05080a;color:#e7f5ee;font:16px/1.5 system-ui,sans-serif}main{max-width:520px;padding:32px 20px;text-align:center}code{display:block;margin:18px 0;font-size:38px;letter-spacing:.12em;color:#a7f3da}button{font:inherit;padding:8px 18px;border-radius:999px;border:1px solid #71cbb7;background:transparent;color:#a7f3da;cursor:pointer}a{color:#a7f3da}p{color:#abc4c9}</style></head>
<body><main><h1>You're invited to a room</h1><p>Open Mefi Studio, go to <strong>Friends › Rooms</strong>, and enter this code in <strong>Join with a code</strong>:</p><code id="code">${shown}</code>
<button type="button" onclick="navigator.clipboard.writeText('${shown}').then(()=>{this.textContent='Copied'})">Copy the code</button>
<p>Don't have Mefi Studio yet? <a href="https://nateecho32-stack.github.io/mefi-studio/">Get it here</a>.</p></main></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}

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
    const join = /^\/join\/([A-Za-z0-9]{8})$/.exec(url.pathname);
    if (join && request.method === 'GET') return joinPage(join[1].toUpperCase());
    if (!url.pathname.startsWith('/v1/')) return jsonResponse(404, { ok: false, error: 'not-found' });
    if (Number(request.headers.get('content-length') ?? 0) > LIMITS.bodyBytes) return jsonResponse(413, { ok: false, error: 'too-large' });
    return env.HUB.get(env.HUB.idFromName('hub')).fetch(request);
  },
};
