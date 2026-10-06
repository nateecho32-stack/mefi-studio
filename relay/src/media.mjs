// Media and project links: which https links the relay accepts, and the
// oEmbed title lookup for listen together. Carried over from the Void Engine
// hub's src/media.mjs (publicHost, listenLink, the provider hosts), with the
// response reading moved to Web streams.
//
// The publicHost rule: every follower's Studio fetches a room's "file" link
// itself, so an address inside their own network (an IP literal, a
// single-label name, a .local or .lan name) would let one member make every
// other member's machine request it. Shared project links follow the same rule.

import { LIMITS, LISTEN_PROVIDERS } from './protocol.mjs';
import { DAY_MS, MINUTE_MS, SECOND_MS, cleanLine } from './util.mjs';

export const PROVIDER_HOSTS = Object.freeze({
  youtube: Object.freeze(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']),
  spotify: Object.freeze(['open.spotify.com']),
  soundcloud: Object.freeze(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']),
  vimeo: Object.freeze(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']),
  discord: Object.freeze(['cdn.discordapp.com', 'media.discordapp.net']),
});

const PRIVATE_SUFFIXES = Object.freeze(['.local', '.localhost', '.lan', '.internal', '.home', '.arpa', '.intranet']);

/** publicHost(hostname) -> false for an IP literal, a single-label name or a private-network suffix. */
export function publicHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || !host.includes('.')) return false;
  return !PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export const FILE_EXTENSIONS = Object.freeze(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'weba', 'mp4', 'm4v', 'webm', 'mov', 'ogv']);

export const OEMBED_ENDPOINTS = Object.freeze({
  youtube: 'https://www.youtube.com/oembed?format=json&url=',
  vimeo: 'https://vimeo.com/api/oembed.json?url=',
  soundcloud: 'https://soundcloud.com/oembed?format=json&url=',
  spotify: 'https://open.spotify.com/oembed?url=',
});

export const OEMBED_LIMITS = Object.freeze({ timeoutMs: 3 * SECOND_MS, maxBytes: 64 * 1024, cacheEntries: 500, cacheTtlMs: DAY_MS, failureTtlMs: 10 * MINUTE_MS });

const HTTPS_SHAPE = /^https:\/\/[^\s\x00-\x1f\x7f]+$/;
const FILE_PATH = new RegExp(`\\.(?:${FILE_EXTENSIONS.join('|')})$`, 'i');

/** One line of member or provider text for a frame. */
export const cleanMediaText = (value, max) => cleanLine(value, max);

/** The normalised https link for a listen provider, or null (not https, credentials, a port, too long, wrong host). */
export function listenLink(url, provider) {
  if (typeof url !== 'string' || url.length > LIMITS.listenUrlMax || !HTTPS_SHAPE.test(url)) return null;
  if (!LISTEN_PROVIDERS.includes(provider)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  const fits = provider === 'file' ? FILE_PATH.test(parsed.pathname) && publicHost(parsed.hostname) : PROVIDER_HOSTS[provider].includes(parsed.hostname);
  if (!fits) return null;
  return parsed.href.length <= LIMITS.listenUrlMax && HTTPS_SHAPE.test(parsed.href) ? parsed.href : null;
}

/** A now-playing link: https, no credentials or port, on a public host. */
export function publicLink(url, maxChars = LIMITS.listenUrlMax) {
  if (typeof url !== 'string' || url.length > maxChars || !HTTPS_SHAPE.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !publicHost(parsed.hostname)) return null;
  return parsed.href.length <= maxChars ? parsed.href : null;
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.body?.cancel?.().catch(() => {});
    return null;
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    return new TextEncoder().encode(text).length <= maxBytes ? text : null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * createOembed({ fetch, now }) -> { title(provider, url) }: a clean title or null, never throws.
 * Fixed endpoints only; the cache is memory and lost when the relay sleeps.
 */
export function createOembed({ fetch: fetchImpl = null, now }) {
  const cache = new Map();
  async function lookup(provider, url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OEMBED_LIMITS.timeoutMs);
    try {
      const response = await fetchImpl(`${OEMBED_ENDPOINTS[provider]}${encodeURIComponent(url)}`, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal, redirect: 'follow' });
      if (!response?.ok) {
        response?.body?.cancel?.().catch(() => {});
        return null;
      }
      const text = await readCapped(response, OEMBED_LIMITS.maxBytes);
      if (text === null) return null;
      const data = JSON.parse(text);
      return typeof data?.title === 'string' ? cleanMediaText(data.title, LIMITS.listenTitleMax) || null : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async function title(provider, url) {
    if (typeof fetchImpl !== 'function' || !Object.hasOwn(OEMBED_ENDPOINTS, provider) || typeof url !== 'string') return null;
    const key = `${provider} ${url}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < (hit.title ? OEMBED_LIMITS.cacheTtlMs : OEMBED_LIMITS.failureTtlMs)) return hit.title;
    const found = await lookup(provider, url);
    cache.delete(key);
    cache.set(key, { title: found, at: now() });
    while (cache.size > OEMBED_LIMITS.cacheEntries) cache.delete(cache.keys().next().value);
    return found;
  }
  return Object.freeze({ title });
}
