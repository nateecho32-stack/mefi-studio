// Community events the relay runs by itself, on its alarm, with nobody to
// organise them:
//
// - The weekly Build Jam. Every Monday at 00:00 UTC a jam opens with a theme
//   from the list below (next week's is shown too, so people can plan).
//   Until Saturday a member may enter one of their shared projects; until
//   the next Monday members play the entries and vote for up to three. A
//   vote counts only from a member in good standing (credits.mjs standing())
//   who played that entry during the jam (play_log, which already holds only
//   plays from members in good standing, once per player and day), and the
//   votes of one batch of accounts (made within 3 days of each other and
//   joined the server within 12 hours of each other: credits.mjs GUARD)
//   count once, and not at all for their own batch's entry. Only members in good
//   standing may enter. When voting closes on Monday the jam waits a day for
//   a moderator's look (status "review": they see every vote and why it
//   counts, may take a voter's votes out or an entry, and may pay sooner;
//   the jam switch, credits.mjs SWITCHES, holds the prizes for as long as it
//   is off), then the results are paid from the jam's pool (economy.mjs): an
//   entry played by three or more members earns a showcase reward, and the
//   top three with at least three votes share the rest 50/30/20, at most 40
//   credits a vote, with no place for anyone who took one in the two jams
//   before (the prizes go round). An entry whose project left the hub drops
//   out. Votes stay hidden from members until then.
// - Co-work hours. Three times a day (02:00, 10:00 and 18:00 UTC) the relay
//   opens a listed co-work room for an hour. It looks who is there at three
//   moments (15, 35 and 55 minutes in): a member who joined that hour's room
//   and has Studio connected, on any page (a restart mid-hour reconnects by
//   itself, so it never loses anyone their place). Everyone seen at two of
//   the three, with at least one other member seen too, earns 4 credits. The
//   room closes at the end of the hour.
// - Building together. In any member's co-work room, two or more members with
//   Studio connected at once earn a tick each time the relay looks (at most
//   every 10 minutes); three ticks in a day pay 4 credits, once a day.
//
// Every reward goes through credits.award(): both sides in good standing, paid
// once per (giver, earner, kind, what), under the kind's caps and, for the
// together and co-work rewards, the day's community budget. The giver of a
// together or co-work reward is a member who was there with the earner, so
// the 15-a-week limit between two members applies: two aged accounts sitting
// in a room are capped like everything else; of the members there, the giver
// is the one who has given the earner least this week. A jam prize's giver is
// the event. While the relay is paused, nothing here starts, runs or pays.
// There are no rewards for inviting or bringing anyone (Discord's platform
// rules): credits come from building and playing together.

import { GUARD } from './credits.mjs';
import { DAY_MS, HOUR_MS, MINUTE_MS, isOpaqueId, isSnowflake } from './util.mjs';
import { dayOf } from './economy.mjs';

export const WEEK_MS = 7 * DAY_MS;
/** Monday 5 January 1970, 00:00 UTC: weeks are counted from here, so a jam runs Monday to Monday. */
export const FIRST_MONDAY = Date.UTC(1970, 0, 5);
export const weekOf = (ms) => Math.floor((ms - FIRST_MONDAY) / WEEK_MS);
export const weekStart = (week) => FIRST_MONDAY + week * WEEK_MS;

export const JAM = Object.freeze({
  entriesMs: 5 * DAY_MS, // Monday to Saturday 00:00: enter, play and vote
  votesPerMember: 3,
  placeMinVotes: 3,
  placePerVote: 40, // a place pays at most this many credits for each vote it got
  placeRestJams: 2, // a member who took a place sits out the places of this many jams after
  shares: Object.freeze([0.5, 0.3, 0.2]),
  showcasePlayers: 3, // members who played an entry, for its showcase reward
  showcaseAmount: 5,
  showcaseShareMax: 0.3, // of the pool, at most, for all the showcase rewards together
  listMax: 100,
  reviewMs: DAY_MS, // after voting closes, a day for a moderator's look before the prizes are paid
});

/** Why a jam vote counts for nothing (or nothing more), as a moderator's view of the jam says it. */
export const VOTE_WHYS = Object.freeze(['no-entry', 'standing', 'self', 'not-played', 'own-batch', 'same-batch']);
/** A jam's statuses before its prizes are paid: running, in its day of review, released by a moderator. */
const UNPAID = Object.freeze(['open', 'review', 'release']);

export const COWORK = Object.freeze({
  hoursUtc: Object.freeze([2, 10, 18]),
  lengthMs: HOUR_MS,
  opensEarlyMs: 10 * MINUTE_MS,
  checksAt: Object.freeze([15 * MINUTE_MS, 35 * MINUTE_MS, 55 * MINUTE_MS]),
  checksNeeded: 2,
  minAttendees: 2,
  amount: 4,
  maxMembers: 100,
  name: 'Co-work hour',
});

export const TOGETHER = Object.freeze({ everyMs: 10 * MINUTE_MS, ticksNeeded: 3, amount: 4 });

export const EVENT_KEEP_MS = 180 * DAY_MS;

/** One theme a week, in this order, round and round. Short, open, kind to any kind of project. */
export const THEMES = Object.freeze([
  'One button', 'Tiny worlds', 'Night shift', 'Echoes', 'Gravity is optional', 'Made of paper', 'Lost and found',
  'Only one room', 'Weather', 'Machines with feelings', 'Upside down', 'Glow', 'Something is following you',
  'Build it twice', 'Shapes', 'Time loop', 'Under the sea', 'Small sounds', 'The last level', 'Garden',
  'Signals', 'Collect them all', 'Fix it', 'Mirror', 'Fast and slow', 'Home', 'Out of order', 'Friends',
  'Leftovers', 'The map is wrong',
]);

export const themeFor = (week) => THEMES[((week % THEMES.length) + THEMES.length) % THEMES.length];

export function jamWindow(week) {
  const startsAt = weekStart(week);
  return { id: `jam_w${week}`, week, startsAt, entriesUntil: startsAt + JAM.entriesMs, endsAt: startsAt + WEEK_MS, theme: themeFor(week) };
}

export function jamPhase(row, at) {
  if (row.status !== 'open') return 'results';
  if (at < row.entries_until) return 'entries';
  if (at < row.ends_at) return 'voting';
  return 'results';
}

/** The co-work hour slot covering `at` (opening early included), or null. */
export function coworkSlot(at) {
  const day = dayOf(at);
  for (const offset of [0, 1]) {
    for (const hour of COWORK.hoursUtc) {
      const startsAt = (day + offset) * DAY_MS + hour * HOUR_MS;
      if (at >= startsAt - COWORK.opensEarlyMs && at < startsAt + COWORK.lengthMs) return { id: `cowork_d${day + offset}h${hour}`, startsAt, endsAt: startsAt + COWORK.lengthMs };
    }
  }
  return null;
}

/** When the next co-work hour starts, after `at`. */
export function nextCoworkStart(at) {
  const day = dayOf(at);
  for (const offset of [0, 1]) {
    for (const hour of COWORK.hoursUtc) {
      const startsAt = (day + offset) * DAY_MS + hour * HOUR_MS;
      if (startsAt > at) return startsAt;
    }
  }
  return null;
}

/**
 * How a jam's pool is paid: showcase rewards first (at most 30% of the pool,
 * 5 each, less each when many earn one), then the places 50/30/20 from the
 * rest, each at most 40 credits a vote. `ranked` is the entries in final order:
 * [{ userId, votes, players, resting }] (a resting entry may take a showcase reward, never a place).
 * -> [{ userId, place|null, amount, why: 'place'|'showcase' }]
 */
export function splitPool(pool, ranked) {
  const payouts = new Map();
  const add = (userId, amount, why, place = null) => {
    if (amount <= 0) return;
    const was = payouts.get(userId) ?? { userId, place: null, amount: 0, why };
    was.amount += amount;
    if (place !== null) {
      was.place = place;
      was.why = 'place';
    }
    payouts.set(userId, was);
  };
  const showcase = ranked.filter((entry) => entry.players >= JAM.showcasePlayers);
  const each = showcase.length ? Math.min(JAM.showcaseAmount, Math.floor((pool * JAM.showcaseShareMax) / showcase.length)) : 0;
  for (const entry of showcase) add(entry.userId, each, 'showcase');
  const rest = pool - each * showcase.length;
  const placed = ranked.filter((entry) => entry.votes >= JAM.placeMinVotes && !entry.resting).slice(0, JAM.shares.length);
  placed.forEach((entry, index) => add(entry.userId, Math.min(Math.floor(rest * JAM.shares[index]), entry.votes * JAM.placePerVote), 'place', index + 1));
  return [...payouts.values()];
}

/**
 * createEvents({ store, now, credits, economy, rooms, paused, review })
 *   credits: { award(o) -> Promise<number>, standing(uid, held), heldUntil(uid) -> Promise<number>, card(uid),
 *              isOff(switchKey), facts(uid) -> { accountCreatedAt, joinedAt } }
 *   economy: createEconomy(...)
 *   rooms:   { present(roomId) -> uid[] (members with the room open), online(roomId) -> uid[] (members with Studio connected),
 *              open({ name, maxMembers }) -> roomId, join(roomId, uid) -> result, close(roomId), member(roomId, uid) -> bool }
 *   paused:  () -> bool, the relay's pause: nothing is made, run or paid while it is on
 *   review:  async ({ id, theme, resultsAt, entries, votes, batched }) when a jam's voting closes and its day of review
 *            starts (the relay tells the moderators); a fault there never stops the jam
 * -> { routes(route), tick(), nextDue(), forget(uid), upkeep(), summary(uid) }
 */
export function createEvents({ store, now, credits, economy, rooms, paused = () => false, review = null }) {
  const eventRow = (id) => (isOpaqueId(id) ? store.get('SELECT * FROM events WHERE id = ?', id) : undefined);
  const nameOf = (uid) => store.get('SELECT name FROM members WHERE user_id = ?', uid)?.name ?? 'member';

  // ---- the weekly Build Jam -------------------------------------------------------

  /** This week's jam, made the first time anyone or the alarm asks (never while the relay is paused). */
  function currentJam(at = now()) {
    const window = jamWindow(weekOf(at));
    if (paused()) return eventRow(window.id) ?? null;
    store.run(
      `INSERT INTO events (id, kind, title, theme, starts_at, entries_until, ends_at, status) VALUES (?, 'jam', ?, ?, ?, ?, ?, 'open') ON CONFLICT (id) DO NOTHING`,
      window.id, `Build Jam: ${window.theme}`, window.theme, window.startsAt, window.entriesUntil, window.endsAt,
    );
    return eventRow(window.id);
  }

  const jamDays = (row) => ({ from: dayOf(row.starts_at), to: dayOf(row.ends_at - 1) });
  // How long a closed jam waits for a moderator's look: a day, or nothing while the review is switched off.
  const reviewMs = () => (credits.isOff('review') ? 0 : JAM.reviewMs);

  /** Members in good standing who played the entry's project during the jam (its owner never counts). */
  function playersOf(row, entry) {
    const { from, to } = jamDays(row);
    return Number(store.get('SELECT COUNT(DISTINCT player_id) AS n FROM play_log WHERE project_id = ? AND day BETWEEN ? AND ? AND player_id <> ?', entry.project_id, from, to, entry.user_id)?.n ?? 0);
  }

  function playedDuring(row, projectId, uid) {
    const { from, to } = jamDays(row);
    return Boolean(store.get('SELECT 1 AS yes FROM play_log WHERE project_id = ? AND player_id = ? AND day BETWEEN ? AND ?', projectId, uid, from, to));
  }

  function projectLite(projectId) {
    const row = store.get('SELECT id, owner_id, url, host, title, blurb, kind FROM projects WHERE id = ?', projectId);
    return row ? { id: row.id, ownerId: row.owner_id, url: row.url, host: row.host, title: row.title, blurb: row.blurb, kind: row.kind } : null;
  }

  function jamView(row, uid, at = now()) {
    const phase = jamPhase(row, at);
    const entries = store.all('SELECT * FROM event_entries WHERE event_id = ? ORDER BY at LIMIT ?', row.id, JAM.listMax);
    const mine = store.all('SELECT entrant_id FROM event_votes WHERE event_id = ? AND voter_id = ?', row.id, uid).map((vote) => vote.entrant_id);
    const results = row.results ? JSON.parse(row.results) : null;
    const { from, to } = jamDays(row);
    const out = {
      id: row.id,
      title: row.title,
      theme: row.theme,
      phase,
      startsAt: row.starts_at,
      entriesUntil: row.entries_until,
      endsAt: row.ends_at,
      // Voting closes at endsAt; the results come a day later, after a moderator's look (JAM.reviewMs).
      resultsAt: row.ends_at + reviewMs(),
      // The pool so far: what the budget left on the jam's finished days.
      pool: row.pool ?? economy.jamPool(from, Math.min(to, dayOf(at) - 1)),
      nextTheme: themeFor(weekOf(row.starts_at) + 1),
      entries: entries.map((entry) => {
        const project = projectLite(entry.project_id);
        const view = {
          user: { id: entry.user_id, name: nameOf(entry.user_id) },
          project,
          players: playersOf(row, entry),
          mine: entry.user_id === uid,
          voted: mine.includes(entry.user_id),
          played: project ? playedDuring(row, project.id, uid) : false,
        };
        // Votes stay hidden while the jam runs, so nobody votes with the crowd.
        if (results) view.votes = results.votes?.[entry.user_id] ?? 0;
        return view;
      }),
      you: {
        entered: entries.find((entry) => entry.user_id === uid)?.project_id ?? null,
        votesLeft: Math.max(0, JAM.votesPerMember - mine.length),
      },
    };
    if (results) out.results = results.payouts;
    return out;
  }

  /**
   * Which of these members make a batch (credits.mjs GUARD): Discord accounts made within 3 days of each other that
   * also joined the server within 12 hours of each other, most likely one person's. -> Map uid -> its batch (one of
   * its uids); a member in no batch is a batch of their own.
   */
  function batchesOf(uids) {
    const list = [...new Set(uids)].sort().map((uid) => ({ uid, ...credits.facts(uid) }));
    const root = new Map(list.map(({ uid }) => [uid, uid]));
    const find = (uid) => {
      let top = uid;
      while (root.get(top) !== top) top = root.get(top);
      root.set(uid, top);
      return top;
    };
    const near = (a, b, span) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= span;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const [one, two] = [list[i], list[j]];
        if (!near(one.accountCreatedAt, two.accountCreatedAt, GUARD.batchMadeMs) || !near(one.joinedAt, two.joinedAt, GUARD.batchJoinedMs)) continue;
        const [x, y] = [find(one.uid), find(two.uid)];
        if (x !== y) root.set(y, x);
      }
    }
    return new Map(list.map(({ uid }) => [uid, find(uid)]));
  }

  /**
   * A jam's count as it stands now: which votes count (from a member in good standing who played the entry during the
   * jam, never their own, one per batch of accounts and none from the entrant's own batch), the entries in order with
   * their votes and players, and what the pool pays.
   * -> { entries, ranked, pool, payouts, votes: [{ voterId, entrantId, at, counted, why }], batch }
   */
  async function tally(row) {
    // An entry whose project left the hub (removed, reported away, or its owner forgotten) drops out.
    const entries = store.all('SELECT e.* FROM event_entries e JOIN projects p ON p.id = e.project_id WHERE e.event_id = ? ORDER BY e.at', row.id);
    const votes = store.all('SELECT voter_id, entrant_id, at FROM event_votes WHERE event_id = ? ORDER BY at, voter_id', row.id);
    const voters = [...new Set(votes.map((vote) => vote.voter_id))];
    const held = new Map();
    for (const voter of voters) held.set(voter, await credits.heldUntil(voter));
    const good = new Set(voters.filter((voter) => credits.standing(voter, held.get(voter)).ok));
    // The batch rule can be switched off (credits.mjs SWITCHES "batches"): then every member is a batch of their own.
    const batch = credits.isOff('batches') ? new Map([...voters, ...entries.map((entry) => entry.user_id)].map((uid) => [uid, uid])) : batchesOf([...voters, ...entries.map((entry) => entry.user_id)]);
    const counted = new Map(); // entrant -> the batches whose vote counted
    const checked = votes.map((vote) => {
      const entry = entries.find((item) => item.user_id === vote.entrant_id);
      let why = null;
      if (!entry) why = 'no-entry';
      else if (!good.has(vote.voter_id)) why = 'standing';
      else if (vote.voter_id === entry.user_id) why = 'self';
      else if (!playedDuring(row, entry.project_id, vote.voter_id)) why = 'not-played';
      else if (batch.get(vote.voter_id) === batch.get(entry.user_id)) why = 'own-batch';
      else {
        const seen = counted.get(entry.user_id) ?? new Set();
        if (seen.has(batch.get(vote.voter_id))) why = 'same-batch';
        seen.add(batch.get(vote.voter_id));
        counted.set(entry.user_id, seen);
      }
      return { voterId: vote.voter_id, entrantId: vote.entrant_id, at: vote.at, counted: why === null, why };
    });
    // Who took a place in the jams just before sits this one's places out.
    const resting = new Set();
    for (const before of store.all(`SELECT results FROM events WHERE kind = 'jam' AND status = 'closed' AND ends_at <= ? ORDER BY ends_at DESC LIMIT ?`, row.starts_at, JAM.placeRestJams)) {
      for (const payout of JSON.parse(before.results ?? '{}').payouts ?? []) if (payout.place && payout.userId) resting.add(payout.userId);
    }
    const ranked = entries
      .map((entry) => ({ userId: entry.user_id, projectId: entry.project_id, votes: counted.get(entry.user_id)?.size ?? 0, players: playersOf(row, entry), at: entry.at, resting: resting.has(entry.user_id) }))
      .sort((a, b) => b.votes - a.votes || b.players - a.players || a.at - b.at);
    const { from, to } = jamDays(row);
    const pool = entries.length ? economy.jamPool(from, to) : 0;
    const payouts = splitPool(pool, ranked).map((payout) => ({ ...payout, projectId: ranked.find((entry) => entry.userId === payout.userId)?.projectId ?? null, name: nameOf(payout.userId) }));
    return { entries, ranked, pool, payouts, votes: checked, batch };
  }

  /**
   * A moderator's view of a jam (GET /v1/admin/jam): each entry in its place now with its voters, whether each vote
   * counts and why not (VOTE_WHYS), how old each voter's Discord account is, when they joined the server and their
   * batch ("A", "B"...: accounts the batch rule ties together, only when there are two or more), and what the pool
   * would pay if the jam closed now.
   */
  async function reviewView(row) {
    const at = now();
    const count = await tally(row);
    const sizes = new Map();
    for (const root of count.batch.values()) sizes.set(root, (sizes.get(root) ?? 0) + 1);
    const letters = new Map();
    for (const [root, size] of [...sizes].sort((x, y) => (x[0] < y[0] ? -1 : 1))) if (size > 1) letters.set(root, String.fromCharCode(65 + (letters.size % 26)));
    const person = (uid) => ({ id: uid, name: nameOf(uid), ...credits.facts(uid), batch: letters.get(count.batch.get(uid)) ?? null });
    const held = credits.isOff('jam');
    return {
      id: row.id,
      theme: row.theme,
      // "entries" or "voting" while it runs, "review" while it waits for a look, "release" once a moderator paid it.
      status: row.status === 'open' ? jamPhase(row, at) : row.status,
      endsAt: row.ends_at,
      resultsAt: held ? null : row.status === 'review' || row.status === 'open' ? row.ends_at + reviewMs() : at,
      held,
      pool: count.pool,
      payouts: count.payouts.map(({ userId, name, place, amount, why }) => ({ userId, name, place, amount, why })),
      entries: count.ranked.map((entry) => ({
        user: person(entry.userId),
        project: projectLite(entry.projectId),
        votes: entry.votes,
        players: entry.players,
        resting: entry.resting,
        voters: count.votes.filter((vote) => vote.entrantId === entry.userId).map((vote) => ({ ...person(vote.voterId), counted: vote.counted, why: vote.why })),
      })),
    };
  }

  /**
   * Closing a jam, in steps the alarm takes: when voting closes it waits a day for a moderator's look ("review"; a jam
   * nobody entered closes at once), then its count is final and the prizes are paid ("paying", then "closed"). A
   * moderator may pay sooner ("release"), and the jam switch (credits.mjs SWITCHES) holds a jam in review for as long
   * as it is off. Safe to run again: each payment is paid once.
   */
  async function closeJam(row) {
    if (row.status === 'closed') return;
    if (row.status === 'open') {
      const entered = Number(store.get('SELECT COUNT(*) AS n FROM event_entries e JOIN projects p ON p.id = e.project_id WHERE e.event_id = ?', row.id)?.n ?? 0);
      // The day of review can be switched off (credits.mjs SWITCHES "review"): then the prizes pay straight away.
      store.run(`UPDATE events SET status = ? WHERE id = ? AND status = 'open'`, entered && reviewMs() > 0 ? 'review' : 'release', row.id);
      row = eventRow(row.id);
      if (row?.status === 'review') {
        try {
          const count = await tally(row);
          await review?.({ id: row.id, theme: row.theme, resultsAt: row.ends_at + JAM.reviewMs, entries: count.entries.length, votes: count.votes.filter((vote) => vote.counted).length, batched: count.votes.filter((vote) => vote.why === 'same-batch' || vote.why === 'own-batch').length });
        } catch {
          // the moderators' heads-up is a courtesy: the jam goes on without it
        }
        return;
      }
    }
    if (row?.status === 'review' || row?.status === 'release') {
      // The jam switch holds the prizes; a jam in review waits its day out unless a moderator released it.
      if (credits.isOff('jam') || (row.status === 'review' && now() < row.ends_at + reviewMs())) return;
      const count = await tally(row);
      store.transaction(() => {
        const fresh = eventRow(row.id);
        if (fresh.status !== 'review' && fresh.status !== 'release') return;
        const votes = Object.fromEntries(count.ranked.filter((entry) => entry.votes > 0).map((entry) => [entry.userId, entry.votes]));
        store.run(`UPDATE events SET status = 'paying', pool = ?, results = ? WHERE id = ?`, count.pool, JSON.stringify({ votes, payouts: count.payouts, entries: count.entries.length }), row.id);
      });
    }
    const paying = eventRow(row.id);
    if (paying?.status !== 'paying') return;
    const results = JSON.parse(paying.results ?? '{}');
    for (const payout of results.payouts ?? []) {
      const paid = await credits.award({ actor: `event:${paying.id}`, target: payout.userId, kind: 'jam', uniq: paying.id, ref: paying.id, amount: payout.amount });
      payout.paid = paid;
    }
    store.run(`UPDATE events SET status = 'closed', results = ?, closed_at = ? WHERE id = ? AND status = 'paying'`, JSON.stringify(results), now(), paying.id);
  }

  // ---- co-work hours --------------------------------------------------------------

  /** The co-work hour open now (made, with its room, the first time it is asked for). */
  function currentCowork(at = now()) {
    const slot = coworkSlot(at);
    if (!slot) return null;
    let row = eventRow(slot.id);
    if (!row && !paused()) {
      store.transaction(() => {
        if (eventRow(slot.id)) return;
        const roomId = rooms.open({ name: COWORK.name, maxMembers: COWORK.maxMembers });
        store.run(`INSERT INTO events (id, kind, title, room_id, starts_at, ends_at, status) VALUES (?, 'cowork', ?, ?, ?, ?, 'open')`, slot.id, COWORK.name, roomId, slot.startsAt, slot.endsAt);
      });
      row = eventRow(slot.id);
    }
    return row ?? null;
  }

  function coworkView(row, uid, at = now()) {
    if (!row) return null;
    const attendees = Number(store.get('SELECT COUNT(*) AS n FROM event_attendance WHERE event_id = ? AND checks >= ?', row.id, COWORK.checksNeeded)?.n ?? 0);
    return {
      id: row.id,
      title: row.title,
      roomId: row.status === 'open' ? row.room_id : null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      started: at >= row.starts_at,
      joined: row.status === 'open' && row.room_id ? rooms.member(row.room_id, uid) : false,
      here: row.status === 'open' && row.room_id ? rooms.online(row.room_id).length : 0,
      checks: Number(store.get('SELECT checks FROM event_attendance WHERE event_id = ? AND user_id = ?', row.id, uid)?.checks ?? 0),
      checksDone: row.checks_done,
      checksNeeded: COWORK.checksNeeded,
      attendees,
      amount: COWORK.amount,
    };
  }

  /** Look who is in the room at each check that is due; at the end, pay and close. */
  async function runCowork(row, at) {
    if (row.status !== 'open') return;
    const due = COWORK.checksAt.filter((offset) => at >= row.starts_at + offset).length;
    if (due > row.checks_done && row.room_id) {
      const here = rooms.online(row.room_id);
      store.transaction(() => {
        const fresh = eventRow(row.id);
        if (fresh.checks_done >= due) return;
        for (const uid of here) {
          store.run('INSERT INTO event_attendance (event_id, user_id, checks) VALUES (?, ?, 1) ON CONFLICT (event_id, user_id) DO UPDATE SET checks = checks + 1', row.id, uid);
        }
        store.run('UPDATE events SET checks_done = ? WHERE id = ?', due, row.id);
      });
    }
    if (at < row.ends_at) return;
    const attended = store.all('SELECT user_id, checks FROM event_attendance WHERE event_id = ? AND checks >= ? ORDER BY checks DESC, user_id', row.id, COWORK.checksNeeded);
    const held = new Map();
    for (const one of attended) held.set(one.user_id, await credits.heldUntil(one.user_id));
    const good = attended.filter((one) => credits.standing(one.user_id, held.get(one.user_id)).ok);
    const paid = {};
    if (good.length >= COWORK.minAttendees) {
      for (const one of good) {
        const partner = giverFor(one.user_id, good.map((other) => other.user_id));
        paid[one.user_id] = await credits.award({ actor: partner, target: one.user_id, kind: 'cowork', uniq: row.id, ref: row.id });
      }
    }
    store.run(`UPDATE events SET status = 'closed', results = ?, closed_at = ? WHERE id = ? AND status = 'open'`, JSON.stringify({ attended: attended.length, paid }), now(), row.id);
    if (row.room_id) rooms.close(row.room_id);
  }

  /**
   * Of the members who were there with `uid`, the one who has given them the
   * least in the last 7 days (ties: the lowest id). Every reward between two
   * members counts toward their 15-a-week limit, so a pair that used theirs
   * up leaves the others to give, and nobody is stuck behind one partner.
   */
  function giverFor(uid, there) {
    const others = there.filter((other) => other !== uid).sort();
    const given = (other) => Number(store.get('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE actor_id = ? AND target_id = ? AND at > ?', other, uid, now() - 7 * DAY_MS)?.n ?? 0);
    let best = others[0] ?? null, least = Infinity;
    for (const other of others) {
      const amount = given(other);
      if (amount < least) { least = amount; best = other; }
    }
    return best;
  }

  // ---- building together ------------------------------------------------------------

  async function together(at) {
    if (at - Number(store.meta('together_at') ?? 0) < TOGETHER.everyMs) return;
    store.setMeta('together_at', at);
    const eventRooms = new Set(store.all(`SELECT room_id FROM events WHERE kind = 'cowork' AND room_id IS NOT NULL`).map((row) => row.room_id));
    const groups = [];
    for (const room of store.all(`SELECT id FROM rooms WHERE kind = 'cowork' AND status = 'active'`)) {
      if (eventRooms.has(room.id)) continue;
      // Members of the room with Studio connected: working on anything, together.
      const here = rooms.online(room.id);
      if (here.length >= 2) groups.push(here);
    }
    if (!groups.length) return;
    const held = new Map();
    for (const uid of new Set(groups.flat())) held.set(uid, await credits.heldUntil(uid));
    const day = dayOf(at);
    const ticked = new Map(); // uid -> the members in good standing with them
    for (const group of groups) {
      const good = group.filter((uid) => credits.standing(uid, held.get(uid)).ok).sort();
      if (good.length < 2) continue;
      for (const uid of good) ticked.set(uid, [...new Set([...(ticked.get(uid) ?? []), ...good])]);
    }
    const reached = [];
    store.transaction(() => {
      for (const [uid, there] of ticked) {
        const partner = giverFor(uid, there);
        const row = store.get(
          `INSERT INTO together_ticks (day, user_id, ticks, partner_id, last_at) VALUES (?, ?, 1, ?, ?)
           ON CONFLICT (day, user_id) DO UPDATE SET ticks = ticks + 1, partner_id = excluded.partner_id, last_at = excluded.last_at RETURNING ticks`,
          day, uid, partner, at,
        );
        if (Number(row?.ticks) === TOGETHER.ticksNeeded) reached.push({ uid, partner });
      }
    });
    for (const { uid, partner } of reached) await credits.award({ actor: partner, target: uid, kind: 'together', uniq: `d${day}`, ref: null });
  }

  // ---- the alarm -----------------------------------------------------------------------

  /** Everything due now: this week's jam exists, last week's is paid, the co-work hour runs, together ticks. */
  async function tick() {
    const at = now();
    currentJam(at);
    for (const row of store.all(`SELECT * FROM events WHERE kind = 'jam' AND status <> 'closed' AND ends_at <= ?`, at)) await closeJam(row);
    currentCowork(at);
    for (const row of store.all(`SELECT * FROM events WHERE kind = 'cowork' AND status = 'open'`)) await runCowork(row, at);
    await together(at);
  }

  /**
   * The next moment tick() has something to do, always in the future: a time
   * already past (an hour whose room opened, a jam not paid yet) would wake
   * the relay every second, so work that is due runs again a minute later,
   * and nothing is due while the relay is paused (null).
   */
  function nextDue() {
    if (paused()) return null;
    const at = now();
    const soon = at + MINUTE_MS;
    const candidates = [weekStart(weekOf(at) + 1)];
    const start = nextCoworkStart(at);
    if (start) candidates.push(start - COWORK.opensEarlyMs > at ? start - COWORK.opensEarlyMs : soon);
    for (const row of store.all(`SELECT * FROM events WHERE kind = 'cowork' AND status = 'open'`)) {
      for (const offset of COWORK.checksAt) if (row.starts_at + offset > at) candidates.push(row.starts_at + offset);
      candidates.push(row.ends_at > at ? row.ends_at : soon);
    }
    // A jam past its end: closed a minute later or, in review, once its day is out; never while the jam switch holds it
    // (switching it back on schedules the alarm again).
    for (const row of store.all(`SELECT status, ends_at FROM events WHERE kind = 'jam' AND status <> 'closed' AND ends_at <= ?`, at)) {
      if ((row.status === 'review' || row.status === 'release') && credits.isOff('jam')) continue;
      const due = row.status === 'review' ? row.ends_at + reviewMs() : at;
      candidates.push(due > at ? due : soon);
    }
    return Math.min(...candidates);
  }

  // ---- what a member sees ------------------------------------------------------------

  function summary(uid) {
    const at = now();
    const jam = currentJam(at);
    const last = store.get(`SELECT * FROM events WHERE kind = 'jam' AND status = 'closed' ORDER BY ends_at DESC LIMIT 1`);
    const waiting = store.get(`SELECT * FROM events WHERE kind = 'jam' AND status IN ('review', 'release', 'paying') ORDER BY ends_at DESC LIMIT 1`);
    const held = waiting && waiting.status !== 'paying' && credits.isOff('jam');
    const cowork = currentCowork(at);
    const day = dayOf(at);
    const ticks = Number(store.get('SELECT ticks FROM together_ticks WHERE day = ? AND user_id = ?', day, uid)?.ticks ?? 0);
    return {
      now: at,
      jam: jam ? jamView(jam, uid, at) : null,
      lastJam: last ? { id: last.id, theme: last.theme, endsAt: last.ends_at, pool: last.pool, results: JSON.parse(last.results ?? '{}').payouts ?? [] } : null,
      // A jam whose voting closed and whose results are not out yet: when they come (null while a moderator holds them).
      reviewing: waiting ? { id: waiting.id, theme: waiting.theme, resultsAt: held ? null : waiting.status === 'review' ? Math.max(at, waiting.ends_at + reviewMs()) : at } : null,
      cowork: coworkView(cowork, uid, at),
      nextCowork: nextCoworkStart(cowork ? cowork.ends_at : at),
      together: { ticks: Math.min(ticks, TOGETHER.ticksNeeded), needed: TOGETHER.ticksNeeded, amount: TOGETHER.amount, everyMs: TOGETHER.everyMs },
      budget: economy.status(),
    };
  }

  /** A line for the Lobby front page: the jam's theme and phase, the next co-work hour. */
  function front(uid) {
    const at = now();
    const jam = currentJam(at);
    const cowork = currentCowork(at);
    return {
      jam: jam ? { id: jam.id, theme: jam.theme, phase: jamPhase(jam, at), entriesUntil: jam.entries_until, endsAt: jam.ends_at, entries: Number(store.get('SELECT COUNT(*) AS n FROM event_entries WHERE event_id = ?', jam.id)?.n ?? 0), entered: Boolean(store.get('SELECT 1 AS yes FROM event_entries WHERE event_id = ? AND user_id = ?', jam.id, uid)) } : null,
      cowork: cowork ? { id: cowork.id, startsAt: cowork.starts_at, endsAt: cowork.ends_at, here: cowork.room_id && cowork.status === 'open' ? rooms.online(cowork.room_id).length : 0 } : { id: null, startsAt: nextCoworkStart(at), endsAt: null, here: 0 },
    };
  }

  // ---- routes ----------------------------------------------------------------------------

  function routes(route) {
    const reply = (status, body) => ({ status, body });
    const fail = (status, error, extra = {}) => reply(status, { ok: false, error, ...extra });

    route('GET', '/v1/events', ({ actor }) => reply(200, { ok: true, ...summary(actor.uid) }));

    // Entering: one of your own shared projects, one entry per member, until Saturday. Prizes go only to members in
    // good standing, so only they may enter: a new second account cannot crowd the list.
    route('POST', '/v1/events/:id/entry', async ({ actor, params, body }) => {
      const held = await credits.heldUntil(actor.uid);
      const at = now();
      const result = store.transaction(() => {
        const row = eventRow(params.id);
        if (!row || row.kind !== 'jam') return fail(404, 'not-found');
        if (jamPhase(row, at) !== 'entries') return fail(409, 'conflict', { reason: 'entries-closed' });
        const project = store.get('SELECT id, owner_id FROM projects WHERE id = ?', body.projectId);
        if (!project) return fail(404, 'not-found', { reason: 'project' });
        if (project.owner_id !== actor.uid) return fail(403, 'forbidden', { reason: 'not-yours' });
        const stand = credits.standing(actor.uid, held);
        if (!stand.ok) return fail(403, 'forbidden', { reason: 'standing', hold: stand.reason });
        const was = store.get('SELECT project_id FROM event_entries WHERE event_id = ? AND user_id = ?', row.id, actor.uid);
        if (was?.project_id === project.id) return reply(200, { ok: true, unchanged: true });
        // A different project is a different entry: the votes for the old one go.
        if (was) store.run('DELETE FROM event_votes WHERE event_id = ? AND entrant_id = ?', row.id, actor.uid);
        store.run('INSERT INTO event_entries (event_id, user_id, project_id, at) VALUES (?, ?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE SET project_id = excluded.project_id, at = excluded.at', row.id, actor.uid, project.id, at);
        return reply(200, { ok: true });
      });
      if (!result.body.ok) return result;
      return reply(200, { ok: true, jam: jamView(eventRow(params.id), actor.uid) });
    }, { write: true, body: 'enterEvent' });

    route('DELETE', '/v1/events/:id/entry', ({ actor, params }) => {
      const at = now();
      const row = eventRow(params.id);
      if (!row || row.kind !== 'jam') return fail(404, 'not-found');
      if (jamPhase(row, at) !== 'entries') return fail(409, 'conflict', { reason: 'entries-closed' });
      store.transaction(() => {
        store.run('DELETE FROM event_votes WHERE event_id = ? AND entrant_id = ?', row.id, actor.uid);
        store.run('DELETE FROM event_entries WHERE event_id = ? AND user_id = ?', row.id, actor.uid);
      });
      return reply(200, { ok: true, jam: jamView(eventRow(row.id), actor.uid) });
    }, { write: true, readOnlyOk: true });

    // A moderator takes an entry out of a jam that is still running or waiting for its review.
    route('DELETE', '/v1/events/:id/entries/:userId', ({ actor, params }) => {
      const row = eventRow(params.id);
      if (!row || row.kind !== 'jam' || !isSnowflake(params.userId)) return fail(404, 'not-found');
      if (!UNPAID.includes(row.status)) return fail(409, 'conflict', { reason: 'closed' });
      store.transaction(() => {
        store.run('DELETE FROM event_votes WHERE event_id = ? AND entrant_id = ?', row.id, params.userId);
        store.run('DELETE FROM event_entries WHERE event_id = ? AND user_id = ?', row.id, params.userId);
        store.run('INSERT INTO audit (kind, actor_id, target_id, detail, at) VALUES (?, ?, ?, ?, ?)', 'event-entry-remove', actor.uid, params.userId, JSON.stringify({ eventId: row.id }), now());
      });
      return reply(200, { ok: true });
    }, { write: true, mod: true });

    // Voting: members in good standing, for entries they played during the jam, three each.
    route('POST', '/v1/events/:id/votes', async ({ actor, params, body }) => {
      const held = await credits.heldUntil(actor.uid);
      const at = now();
      const result = store.transaction(() => {
        const row = eventRow(params.id);
        if (!row || row.kind !== 'jam') return fail(404, 'not-found');
        const phase = jamPhase(row, at);
        if (phase !== 'entries' && phase !== 'voting') return fail(409, 'conflict', { reason: 'voting-closed' });
        const stand = credits.standing(actor.uid, held);
        if (!stand.ok) return fail(403, 'forbidden', { reason: 'standing', hold: stand.reason });
        // A moderator took this member's votes out of this jam (the void route below): they stay out of it.
        if (store.get(`SELECT 1 AS yes FROM audit WHERE kind = 'event-votes-void' AND target_id = ? AND room_id = ?`, actor.uid, row.id)) return fail(403, 'forbidden', { reason: 'barred' });
        const entry = store.get('SELECT * FROM event_entries WHERE event_id = ? AND user_id = ?', row.id, body.userId);
        if (!entry) return fail(404, 'not-found', { reason: 'entry' });
        if (entry.user_id === actor.uid) return fail(403, 'forbidden', { reason: 'self' });
        if (!playedDuring(row, entry.project_id, actor.uid)) return fail(409, 'conflict', { reason: 'play-first' });
        if (store.get('SELECT 1 AS yes FROM event_votes WHERE event_id = ? AND voter_id = ? AND entrant_id = ?', row.id, actor.uid, entry.user_id)) return reply(200, { ok: true, unchanged: true });
        const used = Number(store.get('SELECT COUNT(*) AS n FROM event_votes WHERE event_id = ? AND voter_id = ?', row.id, actor.uid)?.n ?? 0);
        if (used >= JAM.votesPerMember) return fail(409, 'limit', { reason: 'votes-used' });
        store.run('INSERT INTO event_votes (event_id, voter_id, entrant_id, at) VALUES (?, ?, ?, ?)', row.id, actor.uid, entry.user_id, at);
        return reply(200, { ok: true });
      });
      if (!result.body.ok) return result;
      return reply(200, { ok: true, jam: jamView(eventRow(params.id), actor.uid) });
    }, { write: true, body: 'voteEvent' });

    route('DELETE', '/v1/events/:id/votes/:userId', ({ actor, params }) => {
      const row = eventRow(params.id);
      if (!row || row.kind !== 'jam' || !isSnowflake(params.userId)) return fail(404, 'not-found');
      if (row.status !== 'open' || now() >= row.ends_at) return fail(409, 'conflict', { reason: 'voting-closed' });
      store.run('DELETE FROM event_votes WHERE event_id = ? AND voter_id = ? AND entrant_id = ?', row.id, actor.uid, params.userId);
      return reply(200, { ok: true, jam: jamView(row, actor.uid) });
    }, { write: true, readOnlyOk: true });

    // Moderators: the jam to look at (the one waiting for its review, else this week's), with every vote, whether it
    // counts and why not, each voter's account age, server join date and batch, and what the prizes would be now.
    route('GET', '/v1/admin/jam', async () => {
      const row = store.get(`SELECT * FROM events WHERE kind = 'jam' AND status IN ('review', 'release') ORDER BY ends_at DESC LIMIT 1`) ?? currentJam();
      return reply(200, { ok: true, jam: row ? await reviewView(row) : null });
    }, { mod: true });

    // Moderators: a voter's votes in this jam no longer count, and they cannot vote in it again; audited (the audit
    // row's room_id holds the jam's id, which the vote route reads).
    route('DELETE', '/v1/admin/jam/:id/votes/:userId', ({ actor, params }) => {
      const row = eventRow(params.id);
      if (!row || row.kind !== 'jam' || !isSnowflake(params.userId)) return fail(404, 'not-found');
      if (!UNPAID.includes(row.status)) return fail(409, 'conflict', { reason: 'closed' });
      const removed = store.transaction(() => {
        const gone = store.all('DELETE FROM event_votes WHERE event_id = ? AND voter_id = ? RETURNING entrant_id', row.id, params.userId).length;
        store.run('INSERT INTO audit (kind, actor_id, target_id, room_id, detail, at) VALUES (?, ?, ?, ?, ?, ?)', 'event-votes-void', actor.uid, params.userId, row.id, JSON.stringify({ votes: gone }), now());
        return gone;
      });
      return reply(200, { ok: true, removed });
    }, { write: true, mod: true });

    // Moderators: pay a jam in review now instead of waiting its day out (never while the jam switch holds its prizes).
    route('POST', '/v1/admin/jam/:id/release', ({ actor, params }) => {
      const row = eventRow(params.id);
      if (!row || row.kind !== 'jam') return fail(404, 'not-found');
      if (row.status !== 'review') return fail(409, 'conflict', { reason: row.status === 'open' ? 'voting' : 'closed' });
      if (credits.isOff('jam')) return fail(409, 'conflict', { reason: 'held' });
      store.transaction(() => {
        store.run(`UPDATE events SET status = 'release' WHERE id = ? AND status = 'review'`, row.id);
        store.run('INSERT INTO audit (kind, actor_id, room_id, at) VALUES (?, ?, ?, ?)', 'event-release', actor.uid, row.id, now());
      });
      return reply(200, { ok: true });
    }, { write: true, mod: true });

    // A co-work hour: join its room straight away, no request to approve.
    route('POST', '/v1/events/:id/join', ({ actor, params }) => {
      const row = eventRow(params.id);
      if (!row || row.kind !== 'cowork') return fail(404, 'not-found');
      if (actor.isNew) return fail(403, 'forbidden', { reason: 'new-member' });
      if (row.status !== 'open' || !row.room_id || now() >= row.ends_at) return fail(410, 'gone', { reason: 'over' });
      const joined = rooms.join(row.room_id, actor.uid);
      if (!joined.ok) return reply(joined.status ?? 409, { ok: false, error: joined.error ?? 'conflict', reason: joined.reason });
      return reply(200, { ok: true, roomId: row.room_id, cowork: coworkView(eventRow(row.id), actor.uid) });
    }, { write: true });
  }

  // ---- keeping the store small -------------------------------------------------------

  /** Forget me: the member's entries, votes, attendance and ticks, and their id and name in every result. */
  function forget(uid) {
    store.run('DELETE FROM event_votes WHERE voter_id = ? OR entrant_id = ?', uid, uid);
    store.run('DELETE FROM event_entries WHERE user_id = ?', uid);
    store.run('DELETE FROM event_attendance WHERE user_id = ?', uid);
    store.run('DELETE FROM together_ticks WHERE user_id = ?', uid);
    store.run('UPDATE together_ticks SET partner_id = NULL WHERE partner_id = ?', uid);
    for (const row of store.all('SELECT id, results FROM events WHERE results LIKE ?', `%${uid}%`)) {
      const results = JSON.parse(row.results ?? '{}');
      if (results.votes) delete results.votes[uid];
      if (results.paid) delete results.paid[uid];
      for (const payout of results.payouts ?? []) if (payout.userId === uid) Object.assign(payout, { userId: null, name: 'a former member', projectId: null });
      store.run('UPDATE events SET results = ? WHERE id = ?', JSON.stringify(results), row.id);
    }
  }

  /** Daily: events after 180 days, together ticks after a week. */
  function upkeep() {
    const at = now();
    for (const row of store.all(`SELECT id FROM events WHERE status = 'closed' AND ends_at < ?`, at - EVENT_KEEP_MS)) {
      for (const table of ['event_entries', 'event_votes', 'event_attendance']) store.run(`DELETE FROM ${table} WHERE event_id = ?`, row.id);
      store.run('DELETE FROM events WHERE id = ?', row.id);
    }
    store.run('DELETE FROM together_ticks WHERE day < ?', dayOf(at) - 7);
  }

  return Object.freeze({ routes, tick, nextDue, forget, upkeep, summary, front, currentJam, currentCowork });
}
