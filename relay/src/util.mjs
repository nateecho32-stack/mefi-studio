// Small shared pieces for the relay: time units, ids, base64url, HMAC, token
// buckets and text cleaning. Web Crypto only (crypto.subtle and
// crypto.getRandomValues), so the same code runs in a Cloudflare Worker and in
// Node 24 for the tests: no node:* imports and no Buffer anywhere.

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const SNOWFLAKE = /^\d{17,20}$/;
export const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isSnowflake = (value) => typeof value === 'string' && SNOWFLAKE.test(value);
export const isOpaqueId = (value) => typeof value === 'string' && OPAQUE_ID.test(value);

const encoder = new TextEncoder();
export const utf8 = (text) => encoder.encode(String(text));
export const utf8Length = (text) => encoder.encode(String(text)).length;

export function randomBytes(count) {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text) {
  const base = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const padded = base + '='.repeat((4 - (base.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** newId('room') -> "room_<16 base64url characters>" (96 random bits). */
export function newId(prefix) {
  if (!/^[a-z][a-z0-9]{0,15}$/.test(prefix)) throw new TypeError(`newId prefix must be lowercase letters or digits, got "${prefix}"`);
  return `${prefix}_${b64url(randomBytes(12))}`;
}

export async function hmacKey(rawBytes) {
  return crypto.subtle.importKey('raw', rawBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** HMAC-SHA256 of text under key -> Uint8Array(32). */
export async function hmac(key, text) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(text)));
}

/** Constant-time comparison of two byte arrays or two strings. */
export function sameBytes(a, b) {
  const left = typeof a === 'string' ? utf8(a) : a;
  const right = typeof b === 'string' ? utf8(b) : b;
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

/**
 * keyedBuckets({ capacity, refillPerSec, now }) -> { take(key, cost?) -> { ok, retryAfterMs }, sweep() }
 * Token buckets in memory. They are lost when the relay sleeps, which only
 * ever refills them early.
 */
export function keyedBuckets({ capacity, refillPerSec, now }) {
  const buckets = new Map();
  function take(key, cost = 1) {
    const at = now();
    const bucket = buckets.get(key) ?? { tokens: capacity, at };
    bucket.tokens = Math.min(capacity, bucket.tokens + ((at - bucket.at) / 1000) * refillPerSec);
    bucket.at = at;
    buckets.set(key, bucket);
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { ok: true, retryAfterMs: 0 };
    }
    return { ok: false, retryAfterMs: Math.ceil(((cost - bucket.tokens) / refillPerSec) * 1000) };
  }
  function sweep() {
    const at = now();
    for (const [key, bucket] of buckets) {
      if (bucket.tokens + ((at - bucket.at) / 1000) * refillPerSec >= capacity) buckets.delete(key);
    }
  }
  return Object.freeze({ take, sweep, size: () => buckets.size });
}

// Zero-width, bidi controls, word joiners and the BOM: they can disguise names and labels.
const INVISIBLE = /[\u{ad}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{206f}\u{feff}]/gu;
const CONTROL = /[\u0000-\u001f\u007f]/g;
const TEXT_JUNK = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line of display text: invisible and control characters out, spaces collapsed, at most max characters. */
export function cleanLine(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

/** Free text (tabs and line breaks kept): other control characters out, at most max characters, or null when blank. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(TEXT_JUNK, '');
  if (!/\S/.test(text) || text.length > max) return null;
  return text;
}
