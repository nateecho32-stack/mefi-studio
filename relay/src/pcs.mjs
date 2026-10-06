// My PCs (feature "pcs", docs/my-pcs.md): a member's own computers, and a
// friend's PC lent to them, find each other and pass envelopes through the
// relay. The relay stores nothing for it. A PC's id, name, kind, public keys
// and lend list ride on its socket's attachment (a.pc, a.pl; Cloudflare holds
// at most 2 KB there, so a status line never does) and are gone when the
// socket closes. Status lines and envelopes are passed on and forgotten.
// Envelopes are signed and sealed between the PCs themselves
// (scripts/pc-trust.cjs): the relay only routes them, and a relay that
// swapped keys would show the two screens different pairing numbers.
//
// Who sees whom. Viewer V (a socket that said pcHello) sees PC P (another
// such socket, never one with V's own PC id) when
//   - P is V's member's own (mine), or
//   - P lends itself to V's member (lends): P's lend list holds V's user id.
// A lend counts only for someone the lending member shares a room with (not
// the Lobby, which everyone is in), so nobody can push a PC into a stranger's
// list. V's roster names each PC id once, at most 16: the member's own before
// a lent one, then the latest pcHello. Status lines go to the same viewers,
// from the socket the roster names; a friend's copy leaves out `projects`.
//
// A pcSend from S to T is delivered when they are the same member, T lends to
// S's member, or S lends to T's member (so a lent PC can answer). pcMsg names
// the sender's keys, since a lent PC does not see the borrower's PCs and still
// checks their pairing ask and seals its answers to them.
//
//   const pcs = createPcs({ readySockets, sendFrame, sockets, now, friendsOf });
//   pcs.hello(ws, a, frame) ; pcs.state(ws, a, frame) ; pcs.send(ws, a, frame) -> { ok } | nack
//   pcs.gone(a)   a socket closed: its viewers get a fresh roster
//   pcs.sweep()   the alarm's pass over the rate buckets

import { LIMITS } from './protocol.mjs';
import { keyedBuckets } from './util.mjs';

export const PCS_LIMITS = Object.freeze({
  hellosPerMinute: 20, // Studio says pcHello after each ready and on a change; past this the frame is refused
  statesPerMinute: 6, // past this a status line is dropped
  sendsPerMinute: 60, // past this pcSend is nacked rate-limited
});

// How one PC socket sees another: its member's own, lent to it, or (for a
// pcSend only) one it may answer because it lends itself to that member.
const RANK = Object.freeze({ mine: 0, lends: 1, answers: 2 });

const nack = (reason, retryAfter) => (Number(retryAfter) > 0 ? { ok: false, reason, retryAfter: Math.min(86_400_000, Math.ceil(retryAfter)) } : { ok: false, reason });
const perMinute = (count, now) => keyedBuckets({ capacity: count, refillPerSec: count / 60, now });

/**
 * createPcs({ readySockets() -> [{ ws, a }], sendFrame(ws, type, fields), sockets: { write(ws, a) }, now, friendsOf(uid) -> Set })
 *   friendsOf: the members `uid` shares a room with, besides the Lobby (who a PC may lend itself to).
 */
export function createPcs({ readySockets, sendFrame, sockets, now, friendsOf = () => new Set() }) {
  const hellos = perMinute(PCS_LIMITS.hellosPerMinute, now);
  const states = perMinute(PCS_LIMITS.statesPerMinute, now);
  const sends = perMinute(PCS_LIMITS.sendsPerMinute, now);

  /** Every ready socket that said pcHello. */
  const pcSockets = () => readySockets().filter(({ a }) => a.pc);

  /** How the PC on attachment `v` sees the one on `p`: 'mine', 'lends', 'answers' (with `replies`) or null. */
  function relation(v, p, replies = false) {
    if (!v.pc || !p.pc || v.cid === p.cid || v.pc.id === p.pc.id) return null;
    if (p.uid === v.uid) return 'mine';
    if (p.pl?.includes(v.uid)) return 'lends';
    if (replies && v.pl?.includes(p.uid)) return 'answers';
    return null;
  }

  /** The socket `v` means by PC `id` when two say they are it: the member's own first, then the latest pcHello. */
  function pick(v, id, all, replies = false) {
    let best = null;
    for (const entry of all) {
      if (entry.a.pc.id !== id) continue;
      const how = relation(v, entry.a, replies);
      if (!how) continue;
      if (!best || RANK[how] < RANK[best.how] || (RANK[how] === RANK[best.how] && entry.a.pc.since > best.entry.a.pc.since)) best = { entry, how };
    }
    return best;
  }

  /** The PCs viewer `v` sees, each id once, in the protocol's shape. */
  function roster(v, all) {
    const ids = new Set();
    for (const { a: p } of all) if (relation(v, p)) ids.add(p.pc.id);
    return [...ids]
      .map((id) => pick(v, id, all))
      .sort((x, y) => RANK[x.how] - RANK[y.how] || x.entry.a.pc.name.localeCompare(y.entry.a.pc.name) || (x.entry.a.pc.id < y.entry.a.pc.id ? -1 : 1))
      .slice(0, LIMITS.pcsPerViewer)
      .map(({ entry: { a: p }, how }) => ({
        id: p.pc.id,
        name: p.pc.name,
        kind: p.pc.kind,
        owner: { id: p.uid, name: p.name || 'member' },
        mine: how === 'mine',
        lends: how === 'lends',
        keys: { sign: p.pc.sign, box: p.pc.box },
        since: p.pc.since,
      }));
  }

  /** A fresh roster to every PC socket of member `uid` and of the members in `lent`. */
  function refresh(uid, lent) {
    const all = pcSockets();
    for (const { ws, a: v } of all) {
      if (v.uid === uid || lent.includes(v.uid)) sendFrame(ws, 'pcs', { pcs: roster(v, all) });
    }
  }

  /** pcHello: this socket is PC `pc.id`. Its own roster follows, and every PC that sees it, or did, gets a fresh one. */
  function hello(ws, a, { pc, keys, lendTo }) {
    if (!hellos.take(a.cid).ok) return sendFrame(ws, 'error', { code: 'rateLimited', message: 'pcHello' });
    const friends = lendTo.length ? friendsOf(a.uid) : new Set();
    const lent = [...new Set(lendTo)].filter((uid) => uid !== a.uid && friends.has(uid));
    const before = a.pl ?? [];
    a.pc = { id: pc.id, name: pc.name, kind: pc.kind, sign: keys.sign, box: keys.box, since: a.pc?.id === pc.id ? a.pc.since : now() };
    a.pl = lent;
    sockets.write(ws, a);
    refresh(a.uid, [...new Set([...before, ...lent])]);
    return undefined;
  }

  /** pcState: this PC's status line, to the PCs that see it; a friend's copy without the projects. */
  function state(ws, a, { state: line }) {
    if (!a.pc || !states.take(a.cid).ok) return;
    const all = pcSockets();
    const { projects: _projects, ...shared } = line;
    for (const { ws: to, a: v } of all) {
      const seen = pick(v, a.pc.id, all);
      if (!seen || seen.entry.a.cid !== a.cid) continue;
      sendFrame(to, 'pcState', { from: a.pc.id, state: seen.how === 'mine' ? line : shared });
    }
  }

  /** pcSend: one envelope for PC `to`. -> { ok } | nack not-online / not-allowed / rate-limited */
  function send(ws, a, { to, env }) {
    if (!a.pc) return nack('not-allowed');
    const rate = sends.take(a.cid);
    if (!rate.ok) return nack('rate-limited', rate.retryAfterMs);
    const all = pcSockets();
    if (to === a.pc.id || !all.some((entry) => entry.a.pc.id === to && entry.a.cid !== a.cid)) return nack('not-online');
    const target = pick(a, to, all, true);
    if (!target) return nack('not-allowed');
    sendFrame(target.entry.ws, 'pcMsg', { from: a.pc.id, fromUser: a.uid, fromName: a.name || 'member', keys: { sign: a.pc.sign, box: a.pc.box }, env });
    return { ok: true };
  }

  /** A socket closed (its attachment already says so): the PCs that saw it get a fresh roster. */
  function gone(a) {
    if (!a?.pc) return;
    refresh(a.uid, a.pl ?? []);
  }

  function sweep() {
    for (const bucket of [hellos, states, sends]) bucket.sweep();
  }

  return Object.freeze({ hello, state, send, gone, sweep, roster: (a) => roster(a, pcSockets()) });
}
