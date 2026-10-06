// Room chat without storage: message ids that prove their author, and the
// relay's signature on each message.
//
// An id is shaped like a Discord snowflake (Studio checks ^\d{17,20}$):
//
//   ((t - Discord epoch) << 22) | low22
//
// where t is the send time in ms (strictly increasing inside the relay, so ids
// are unique) and low22 is the first 22 bits of HMAC(key, "mid1|room|author|t").
// The relay keeps no message rows, yet an edit from anyone but the author
// fails isAuthor(), and a forged match needs a 1-in-4-million hit on one
// fixed (message, member) pair.
//
// sig = HMAC(key, "msg1|room|id|author.id|author.name|editedAt|replyTo|text"), 22
// base64url characters (128 bits). Studio keeps it with its own copy of the
// message. When that copy later fills a gap for another member (peer history)
// or backs a report, the relay checks the signature, so a peer cannot put
// words in someone else's mouth.

import { b64url, hmac, isSnowflake, sameBytes } from './util.mjs';

const DISCORD_EPOCH = 1420070400000n;
const LOW_MASK = 0x3fffffn;

/** The send time an id carries, in ms. */
export function idTime(id) {
  return Number(BigInt(id) >> 22n) + Number(DISCORD_EPOCH);
}

const low22 = (mac) => BigInt(((mac[0] << 14) | (mac[1] << 6) | (mac[2] >> 2)) & 0x3fffff);

export function createChat({ key, now }) {
  let lastT = 0;
  const nextT = () => {
    lastT = Math.max(now(), lastT + 1);
    return lastT;
  };

  async function makeId(roomId, authorId) {
    const t = nextT();
    const mac = await hmac(key, `mid1|${roomId}|${authorId}|${t}`);
    return String(((BigInt(t) - DISCORD_EPOCH) << 22n) | low22(mac));
  }

  async function isAuthor(id, roomId, authorId) {
    if (!isSnowflake(id) || !isSnowflake(authorId)) return false;
    let value;
    try {
      value = BigInt(id);
    } catch {
      return false;
    }
    const t = idTime(id);
    const mac = await hmac(key, `mid1|${roomId}|${authorId}|${t}`);
    return low22(mac) === (value & LOW_MASK);
  }

  async function sign(roomId, message) {
    const text = `msg1|${roomId}|${message.id}|${message.author.id}|${message.author.name}|${message.editedAt ?? ''}|${message.replyTo ?? ''}|${message.text}`;
    return b64url(await hmac(key, text)).slice(0, 22);
  }

  async function checkSig(roomId, message) {
    if (typeof message?.sig !== 'string') return false;
    return sameBytes(await sign(roomId, message), message.sig);
  }

  /** The message shape Studio reads (hub-client.cjs roomMessage), signed. */
  async function build(roomId, { id, author, text, editedAt = null, replyTo = null }) {
    const message = {
      id,
      author: { id: author.id, name: author.name, viaStudio: true },
      text,
      createdAt: idTime(id),
      editedAt,
      mentions: { users: [], roles: [], everyone: false },
      attachments: [],
      replyTo,
    };
    message.sig = await sign(roomId, message);
    return message;
  }

  return Object.freeze({ makeId, isAuthor, sign, checkSig, build, idTime });
}
