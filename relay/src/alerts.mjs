// Telling the moderators when something needs a look, in Discord: one short
// line to a private channel through a webhook the owner made there
// (MOD_ALERT_WEBHOOK), and/or as a direct message from the Studio bot to
// each OWNER_IDS account (MOD_ALERT_BOT_TOKEN, the bot's token; the bot has
// to share a server with them). Both are Worker secrets; with neither,
// nothing is ever posted. A line names nobody and links nothing. It says how
// many members newly look like they are farming credits (credits.mjs
// farmingFlags, once a day after the upkeep), when credits went on hold for
// a newcomer wave (credits.mjs heldList, each member once until their holds
// are decided), and when a Build Jam's voting closed and its results wait a
// day for a look (events.mjs). The details stay in Studio's Friends ›
// Moderation, where every admin route checks the reader again.
//
//   const alerts = createAlerts({ store, fetch, webhook, botToken, owners });
//   await alerts.flags(list)   new farming flags since the last line  -> whether one was posted
//   await alerts.holds(list)   members whose credits newly went on hold -> whether one was posted
//   await alerts.jam(info)     a jam waiting for its review           -> whether one was posted

/** A Discord webhook's address, as Discord hands it out. */
export const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{20,100}$/;
/** A Discord bot token's shape: three dot-separated parts. */
export const BOT_TOKEN = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/;
export const ALERT_TIMEOUT_MS = 8000;
const DISCORD_API = 'https://discord.com/api/v10';

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/**
 * createAlerts({ store, fetch, webhook, botToken, owners })
 *   webhook:  MOD_ALERT_WEBHOOK; anything that is not a Discord webhook's address leaves the channel out
 *   botToken: MOD_ALERT_BOT_TOKEN, the Studio bot's token, to message `owners` (OWNER_IDS) directly; else no messages
 * -> { on, flags(list), holds(list), jam(info) }
 */
export function createAlerts({ store, fetch: fetchImpl, webhook = '', botToken = '', owners = [] }) {
  const toChannel = WEBHOOK.test(String(webhook ?? ''));
  const toOwners = BOT_TOKEN.test(String(botToken ?? '')) && owners.length > 0;
  const on = toChannel || toOwners;
  const channels = new Map(); // owner id -> their direct-message channel with the bot (memory only: opened again after a wake)

  /** One request to Discord with a time limit. -> { ok, body } */
  async function call(url, payload, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
    try {
      // Workers' fetch has no redirect: 'error'; 'manual' plus wanting a 2xx does the same.
      const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload), redirect: 'manual', signal: controller.signal });
      const ok = response.status >= 200 && response.status < 300;
      let body = null;
      if (ok && response.status !== 204) {
        try {
          body = await response.json();
        } catch {
          body = null;
        }
      }
      return { ok, body };
    } catch {
      return { ok: false, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** A direct message from the bot to each owner, opening the conversation the first time. -> whether one arrived */
  async function message(content) {
    const auth = { authorization: `Bot ${botToken}` };
    let sent = false;
    for (const userId of owners) {
      let channel = channels.get(userId);
      if (!channel) {
        const opened = await call(`${DISCORD_API}/users/@me/channels`, { recipient_id: userId }, auth);
        channel = opened.ok && /^\d{17,20}$/.test(String(opened.body?.id ?? '')) ? String(opened.body.id) : null;
        if (!channel) continue;
        channels.set(userId, channel);
      }
      sent = (await call(`${DISCORD_API}/channels/${channel}/messages`, { content, allowed_mentions: { parse: [] } }, auth)).ok || sent;
    }
    return sent;
  }

  async function post(content) {
    if (!on) return false;
    const [channel, direct] = await Promise.all([
      toChannel ? call(webhook, { username: 'Mefi relay', content, allowed_mentions: { parse: [] } }).then((answer) => answer.ok) : false,
      toOwners ? message(content) : false,
    ]);
    return channel || direct;
  }

  /**
   * The farming flags not told before, as one line (a flag that went away and came back is told again). What was told
   * is kept as the flags' member ids and reasons (meta "alerted_flags"), and only once the line went out.
   */
  async function flags(list) {
    if (!on || !Array.isArray(list)) return false;
    const keys = list.map((flag) => `${flag.id}|${flag.why}`);
    let told = [];
    try {
      told = JSON.parse(store.meta('alerted_flags') ?? '[]');
    } catch {
      told = [];
    }
    const fresh = keys.filter((key) => !told.includes(key));
    if (!fresh.length) {
      store.setMeta('alerted_flags', JSON.stringify(keys));
      return false;
    }
    const sent = await post(`For moderators: ${plural(fresh.length, 'member newly looks', 'members newly look')} like they are farming credits (${list.length} on the list in all). Studio's Friends › Moderation has the details.`);
    if (sent) store.setMeta('alerted_flags', JSON.stringify(keys));
    return sent;
  }

  /**
   * Members whose credits newly went on hold for a newcomer wave (credits.mjs heldList), as one line; each member is
   * told once until their holds are decided (meta "alerted_holds", kept only once the line went out).
   */
  async function holds(list) {
    if (!on || !Array.isArray(list)) return false;
    const ids = list.map((hold) => String(hold?.member?.id ?? '')).filter(Boolean);
    let told = [];
    try {
      told = JSON.parse(store.meta('alerted_holds') ?? '[]');
    } catch {
      told = [];
    }
    const fresh = ids.filter((id) => !told.includes(id));
    if (!fresh.length) {
      store.setMeta('alerted_holds', JSON.stringify(ids));
      return false;
    }
    const sent = await post(`For moderators: credits for ${plural(fresh.length, 'more member are', 'more members are')} on hold: more than 3 members who joined the server in the last 30 days paid the same member this week. Studio's Friends › Moderation › Credits on hold lets you pay them or drop them; they drop by themselves after 30 days.`);
    if (sent) store.setMeta('alerted_holds', JSON.stringify(ids));
    return sent;
  }

  /** A Build Jam whose voting closed: its theme, its entries and votes, and when it pays by itself. */
  async function jam({ theme, resultsAt, entries = 0, votes = 0, batched = 0 } = {}) {
    if (!on) return false;
    const when = Number.isFinite(resultsAt) ? ` <t:${Math.floor(resultsAt / 1000)}:R>` : '';
    const batches = batched ? ` ${plural(batched, 'vote')} came from accounts made and joined together, so they count once or not at all.` : '';
    return post(`For moderators: voting closed for the Build Jam "${String(theme ?? '').slice(0, 60)}": ${plural(entries, 'entry', 'entries')}, ${plural(votes, 'vote')} that count.${batches} The prizes pay by themselves${when} unless you hold them; Studio's Friends › Moderation shows every vote.`);
  }

  return Object.freeze({ on, flags, holds, jam });
}
