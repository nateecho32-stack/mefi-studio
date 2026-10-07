// Telling the moderators when something needs a look, in a private Discord
// channel: the relay posts one short line to a webhook the owner made there
// (MOD_ALERT_WEBHOOK, a Worker secret; with none, nothing is ever posted).
// A line names nobody and links nothing. It says how many members newly look
// like they are farming credits (credits.mjs farmingFlags, once a day after
// the upkeep), and when a Build Jam's voting closed and its results wait a
// day for a look (events.mjs). The details stay in Studio's Friends ›
// Moderation, where every admin route checks the reader again.
//
//   const alerts = createAlerts({ store, fetch, webhook });
//   await alerts.flags(list)   new farming flags since the last line -> whether one was posted
//   await alerts.jam(info)     a jam waiting for its review          -> whether one was posted

/** A Discord webhook's address, as Discord hands it out. */
export const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{20,100}$/;
export const ALERT_TIMEOUT_MS = 8000;

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/**
 * createAlerts({ store, fetch, webhook })
 *   webhook: MOD_ALERT_WEBHOOK; anything that is not a Discord webhook's address turns the alerts off
 * -> { on, flags(list), jam(info) }
 */
export function createAlerts({ store, fetch: fetchImpl, webhook = '' }) {
  const on = WEBHOOK.test(String(webhook ?? ''));

  async function post(content) {
    if (!on) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
    try {
      // Workers' fetch has no redirect: 'error'; 'manual' plus wanting a 2xx does the same.
      const response = await fetchImpl(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Mefi relay', content, allowed_mentions: { parse: [] } }),
        redirect: 'manual',
        signal: controller.signal,
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
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

  /** A Build Jam whose voting closed: its theme, its entries and votes, and when it pays by itself. */
  async function jam({ theme, resultsAt, entries = 0, votes = 0, batched = 0 } = {}) {
    if (!on) return false;
    const when = Number.isFinite(resultsAt) ? ` <t:${Math.floor(resultsAt / 1000)}:R>` : '';
    const batches = batched ? ` ${plural(batched, 'vote')} came from accounts made and joined together, so they count once or not at all.` : '';
    return post(`For moderators: voting closed for the Build Jam "${String(theme ?? '').slice(0, 60)}": ${plural(entries, 'entry', 'entries')}, ${plural(votes, 'vote')} that count.${batches} The prizes pay by themselves${when} unless you hold them; Studio's Friends › Moderation shows every vote.`);
  }

  return Object.freeze({ on, flags, jam });
}
