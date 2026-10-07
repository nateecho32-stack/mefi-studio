// Credits, ranks and the project hub.
//
// Members share their projects as small cards (a public https link, a title
// and a short blurb; never a file) and play each other's. Sharing is free and
// earns nothing on its own. Credits come from playing: when a member plays
// someone else's project for two minutes, both of them earn (the maker 5, the
// player 2), and a star earns the maker 3. Credits are never bought and never
// cashed out; they are spent on featuring a project at the top of the hub for
// a day, and in the Shop (shop.mjs), where a style pack's maker earns a share
// of what it sold for (a tip included) through sale(), under that kind's own
// caps.
//
// Ranks come in two kinds. Levels follow lifetime credits (Spark, Ember,
// Flame, Comet, Star, Nova, Void) and are badges in Studio only. Special
// ranks are the member's own Discord roles (Builder, Helper, Mentor,
// Spotlight...), which moderators grant as before: credits never hand out a
// Discord role, so the bot's "points never grant a role" rule stands.
//
// Against farming (GUARD below): nobody earns from their own project; every
// credit is one row keyed (actor, target, kind, uniq), so it is paid once;
// both sides must be in good standing: a Discord account 30 days old, a week
// in the server, not read-only, and not inside the 30 days after Forget me
// (which keeps only a keyed fingerprint so it cannot reset the limits). A
// play pays a maker once a day per player whichever of their projects was
// played, a star once a week per member, and one member can make another
// earn at most 15 credits a week, every kind together, under daily caps and
// an overall 60 a day. A play token pays only for the day it started. Plays
// and stars that count toward "Top" come from members in good standing only,
// and a member's plays count once a week per project there, however often
// they play it (a few second accounts playing every day cannot outrun many
// different players). Moderators can read where a member's credits came
// from, take back the ones that came from farming (also what a member who
// later used Forget me gave, kept under an id that names nobody), and switch
// off any kind of reward, the jam's prizes or featuring while they look into
// a new trick (SWITCHES). Community events (events.mjs) add three
// kinds paid only through award(): building together, co-work hours and the
// weekly Build Jam's prizes, the first two under the day's community budget
// (economy.mjs). There are no invite or referral rewards
// (Discord's platform rules), no reaction rewards and no public leaderboard:
// a balance is private, a rank badge is public, and ranks are worked out
// here from lifetime credits, never sent by a Studio.

import { publicLink, publicHost } from './media.mjs';
import { DAY_MS, MINUTE_MS, b64url, cleanLine, hmac, isOpaqueId, isSnowflake, keyedBuckets, newId, randomBytes, sameBytes } from './util.mjs';

export const RANKS = Object.freeze([
  Object.freeze({ key: 'spark', name: 'Spark', at: 0 }),
  Object.freeze({ key: 'ember', name: 'Ember', at: 50 }),
  Object.freeze({ key: 'flame', name: 'Flame', at: 200 }),
  Object.freeze({ key: 'comet', name: 'Comet', at: 600 }),
  Object.freeze({ key: 'star', name: 'Star', at: 1500 }),
  Object.freeze({ key: 'nova', name: 'Nova', at: 4000 }),
  Object.freeze({ key: 'void', name: 'Void', at: 10000 }),
]);

/** Special ranks: Discord role keys from ROLE_IDS_JSON that are shown as badges, in this order. */
export const SPECIAL_RANKS = Object.freeze(['mod', 'contributor', 'patron', 'spotlight', 'mentor', 'helper', 'builder', 'cowork_host', 'room_host', 'regular']);

export const EARN = Object.freeze({
  played: Object.freeze({ amount: 5, perDay: 30 }), // the maker, when a member plays one of their projects for 2 minutes: once per (player, maker, day)
  play: Object.freeze({ amount: 2, perDay: 10 }), // the player, for playing someone else's project: once per (maker, day)
  starred: Object.freeze({ amount: 3, perDay: 15 }), // the maker, for a star: once per (member, maker, week)
  // Community rewards (events.mjs), paid only through award(): building together in a co-work room once a day, a
  // co-work hour attended with others (twice a day at most), both from the day's community budget (economy.mjs);
  // and the weekly Build Jam's prizes from its pool, which are paid once per jam and sit outside the daily caps.
  together: Object.freeze({ amount: 4, perDay: 4, award: true }),
  cowork: Object.freeze({ amount: 4, perDay: 8, award: true }),
  jam: Object.freeze({ amount: 0, max: 450, perDay: 1000, award: true, prize: true }),
  // A Shop sale (shop.mjs), paid only through sale(): a community pack's maker earns a share of what its buyer paid
  // (the price and any tip). Prize-style, so the day's 60 and the 15-a-week pair limit do not stack on its own caps
  // (300 a day, and GUARD.salePairWeek from one buyer to one maker in 7 days). A sale still counts toward that pair's
  // 15 for every other kind, so after one, the buyer's plays and stars pay that maker nothing more that week.
  sale: Object.freeze({ amount: 0, max: 100, perDay: 300, prize: true }),
  dayCap: 60,
});

/** Who may give or earn credits, and how much one member can be worth to another. */
export const GUARD = Object.freeze({
  accountAgeMs: 30 * DAY_MS, // a Discord account younger than this neither gives nor earns
  serverAgeMs: 7 * DAY_MS, // nor does one in the Void Engine server for less than a week
  pairWeek: 15, // one member can make another earn at most this many credits in 7 days, every kind together
  forgetHoldMs: 30 * DAY_MS, // after Forget me the same account gives and earns nothing for this long
  playStartsPerHour: 30,
  starsPerHour: 30,
  reviewDays: 30, // what a moderator's credit review looks back over
  // "Looks like farming" for moderators: someone who earned at least flagMin in reviewDays with flagShare of it from one
  // member, or two members who each made the other earn at least flagMutual.
  flagMin: 30,
  flagShare: 0.6,
  flagMutual: 10,
  projectReportsPerHour: 10,
  salePairWeek: 100, // what one buyer's Shop purchases can make one maker earn in 7 days
  // A "batch": two Discord accounts made within 3 days of each other that also joined the server within 12 hours of each
  // other, most likely one person's (made and brought in together). A jam's votes from one batch count once
  // (events.mjs). Narrow on purpose: two friends who signed up the same week and joined on different days are no batch.
  batchMadeMs: 3 * DAY_MS,
  batchJoinedMs: 12 * 60 * MINUTE_MS,
});

/**
 * What a moderator can switch off while they look into a new trick (POST /v1/admin/credits/switches), without pausing
 * the relay: each kind of reward (it pays nothing while off), the Build Jam's prizes (held, not lost: events.mjs pays
 * them once they are back on) and featuring; and two of the jam's own rules, should one misfire: its day of review
 * before the prizes pay, and one vote per batch of accounts (events.mjs). -> switch key: the EARN kinds it stops.
 */
export const SWITCHES = Object.freeze({
  plays: Object.freeze(['played', 'play']),
  stars: Object.freeze(['starred']),
  together: Object.freeze(['together']),
  cowork: Object.freeze(['cowork']),
  jam: Object.freeze(['jam']),
  sales: Object.freeze(['sale']),
  featuring: Object.freeze([]),
  review: Object.freeze([]),
  batches: Object.freeze([]),
});
const SWITCH_OF = Object.freeze(Object.fromEntries(Object.entries(SWITCHES).flatMap(([key, kinds]) => kinds.map((kind) => [kind, key]))));
/** A forgotten member's id in the credit rows they gave (forget below): random, so it names nobody. */
export const GONE_ID = /^gone:[A-Za-z0-9_-]{16,22}$/;

const DISCORD_EPOCH = 1_420_070_400_000n;
/** When a Discord account was made, from its id (a snowflake), or null. */
export function accountCreatedAt(id) {
  return isSnowflake(id) ? Number((BigInt(id) >> 22n) + DISCORD_EPOCH) : null;
}

export const PROJECT_LIMITS = Object.freeze({
  urlChars: 512,
  titleChars: 100,
  blurbChars: 300,
  perOwner: 5,
  createsPerDay: 3,
  hubTotal: 2000,
  playMinMs: 2 * MINUTE_MS,
  playMaxMs: 6 * 60 * MINUTE_MS,
  idleMs: 90 * DAY_MS,
  featureCost: 100,
  featureMs: DAY_MS,
  featureSlots: 3,
  featureCooldownMs: 7 * DAY_MS,
  listMax: 60,
  eventKeepMs: 180 * DAY_MS,
});

export const PROJECT_KINDS = Object.freeze(['game', 'app', 'tool', 'art', 'music', 'other']);

/** The Lobby front page (GET /v1/front): a week back, and how many of each list. */
export const FRONT = Object.freeze({ weekMs: 7 * DAY_MS, fresh: 5, rankUps: 6, people: 24, rooms: 6 });

const dayOf = (ms) => Math.floor(ms / DAY_MS);
const weekOf = (ms) => Math.floor(ms / (7 * DAY_MS));
const SHORT_LINKS = /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|t\.me|dsc\.gg|discord\.gg)$/i;

export function rankFor(lifetime) {
  let index = 0;
  for (let at = 0; at < RANKS.length; at += 1) if (lifetime >= RANKS[at].at) index = at;
  const rank = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  const progress = next ? Math.max(0, Math.min(1, (lifetime - rank.at) / (next.at - rank.at))) : 1;
  return { key: rank.key, name: rank.name, next: next ? { key: next.key, name: next.name, at: next.at } : null, progress: Math.round(progress * 100) / 100 };
}

export function specialRanks(roleKeys = [], isMod = false) {
  const held = new Set(roleKeys);
  if (isMod) held.add('mod');
  return SPECIAL_RANKS.filter((key) => held.has(key));
}

/** A shareable project link: https, a public host, no credentials or port, no link shortener. */
export function projectLink(url) {
  const href = publicLink(url, PROJECT_LIMITS.urlChars);
  if (!href) return null;
  const host = new URL(href).hostname.toLowerCase();
  return SHORT_LINKS.test(host) || !publicHost(host) ? null : { href, host };
}

/**
 * createCredits({ store, now, key, sendToUser, member })
 *   key: an HMAC key for play tokens; sendToUser(uid, type, fields); member(uid) -> describeMember()
 * -> { routes(route), forget(uid, fingerprint), fingerprint(uid), upkeep(), me(uid), card(uid), account(uid), front(uid), standing(uid, heldUntil),
 *      spend(uid, amount), sale({ buyer, maker, itemId, amount, buyerHeld, makerHeld }), tell(uid, delta, reason),
 *      farmingFlags(), isOff(switchKey), facts(uid) -> { accountCreatedAt, joinedAt } }
 */
export function createCredits({ store, now, key, sendToUser, member, economy = null }) {
  const accountRow = (uid) => store.get('SELECT * FROM accounts WHERE user_id = ?', uid);
  const playStarts = keyedBuckets({ capacity: GUARD.playStartsPerHour, refillPerSec: GUARD.playStartsPerHour / 3600, now });
  const starTaps = keyedBuckets({ capacity: GUARD.starsPerHour, refillPerSec: GUARD.starsPerHour / 3600, now });
  const projectReports = keyedBuckets({ capacity: GUARD.projectReportsPerHour, refillPerSec: GUARD.projectReportsPerHour / 3600, now });

  /** The SWITCHES a moderator turned off (meta "credits_off"), as a Set of their keys. */
  function switchedOff() {
    try {
      const list = JSON.parse(store.meta('credits_off') ?? '[]');
      return new Set(Array.isArray(list) ? list.filter((key) => Object.hasOwn(SWITCHES, key)) : []);
    } catch {
      return new Set();
    }
  }
  const isOff = (key) => switchedOff().has(key);

  /** What the jam's batch rule reads about a member: when their Discord account was made and when they joined the server. */
  const facts = (uid) => ({ accountCreatedAt: accountCreatedAt(uid), joinedAt: member(uid)?.joinedAt ?? null });

  /** Forget me's fingerprint of an account: keyed, so it names nobody without the relay's key. */
  async function fingerprint(uid) {
    return b64url(await hmac(key, `hold1|${uid}`)).slice(0, 22);
  }
  /** Until when Forget me holds this account's credits (0: no hold). Async, so routes read it before their transaction. */
  async function heldUntil(uid) {
    const row = store.get('SELECT until FROM credit_holds WHERE fingerprint = ?', await fingerprint(uid));
    return row && row.until > now() ? row.until : 0;
  }
  /**
   * Whether a member may give or earn credits now: { ok, reason, until }.
   * reason: unknown, read-only, new-account, new-member or forgot-me (hub-client CREDIT_HOLDS); until: when it lifts, if known.
   */
  function standing(uid, held = 0) {
    const at = now();
    const who = member(uid);
    if (!who) return { ok: false, reason: 'unknown', until: null };
    if (who.readOnly) return { ok: false, reason: 'read-only', until: null };
    const created = accountCreatedAt(uid);
    if (created === null || at - created < GUARD.accountAgeMs) return { ok: false, reason: 'new-account', until: created === null ? null : created + GUARD.accountAgeMs };
    if (!Number.isFinite(who.joinedAt) || at - who.joinedAt < GUARD.serverAgeMs) return { ok: false, reason: 'new-member', until: Number.isFinite(who.joinedAt) ? who.joinedAt + GUARD.serverAgeMs : null };
    if (held > at) return { ok: false, reason: 'forgot-me', until: held };
    return { ok: true, reason: null, until: null };
  }

  function account(uid) {
    const row = accountRow(uid);
    const today = dayOf(now());
    const earnedToday = row && row.day === today ? row.earned_today : 0;
    const streakLive = row && row.streak_day >= today - 1 ? row.streak : 0;
    return { balance: row?.balance ?? 0, lifetime: row?.lifetime ?? 0, today: earnedToday, todayCap: EARN.dayCap, streak: streakLive, best: row?.best_streak ?? 0 };
  }

  /**
   * Pay credits inside the caller's transaction: once per (actor, target, kind, uniq), under the kind's and the
   * day's caps and the pair limit. `amount` asks for a different amount than the kind's own (a jam prize), never
   * more than its max. A prize kind is outside the daily and pair caps, and the community kinds are capped by
   * what is left of the day's budget (economy.mjs). -> the amount paid.
   */
  function pay({ actor, target, kind, uniq, ref = null, amount: asked = null }) {
    const rule = EARN[kind];
    const prize = rule.prize === true;
    const at = now();
    const today = dayOf(at);
    const inserted = store.get(
      `INSERT INTO credit_events (actor_id, target_id, kind, ref, uniq, day, amount, at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (actor_id, target_id, kind, uniq) DO NOTHING RETURNING id`,
      actor,
      target,
      kind,
      ref,
      uniq,
      today,
      at,
    );
    if (!inserted) return 0;
    // A kind a moderator switched off pays nothing, and its row stays at 0 like a revoked one, so what happened while
    // it was off never pays later. The jam's prizes are held by events.mjs instead, before anything is paid.
    if (kind !== 'jam' && isOff(SWITCH_OF[kind])) return 0;
    const kindToday = Number(store.get('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE target_id = ? AND kind = ? AND day = ?', target, kind, today)?.n ?? 0);
    // What this member already made the other earn in the last 7 days, every kind together.
    const pairWeek = Number(store.get('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE actor_id = ? AND target_id = ? AND at > ?', actor, target, at - 7 * DAY_MS)?.n ?? 0);
    const row = accountRow(target);
    const earnedToday = row && row.day === today ? row.earned_today : 0;
    const base = asked === null ? rule.amount : Math.max(0, Math.min(Math.floor(Number(asked) || 0), rule.max ?? rule.amount));
    const capped = Math.max(0, Math.min(base, rule.perDay - kindToday, prize ? Infinity : EARN.dayCap - earnedToday, prize ? Infinity : GUARD.pairWeek - pairWeek));
    const amount = economy ? economy.cap(kind, capped, today) : capped;
    if (amount === 0) return 0;
    store.run('UPDATE credit_events SET amount = ? WHERE id = ?', amount, inserted.id);
    const streakDay = row?.streak_day ?? 0;
    const streak = streakDay === today ? row.streak : streakDay === today - 1 ? row.streak + 1 : 1;
    // A prize does not use up the day's earning cap: earned_today counts only what that cap limits.
    const counted = prize ? 0 : amount;
    store.run(
      `INSERT INTO accounts (user_id, balance, lifetime, day, earned_today, streak, streak_day, best_streak) VALUES (?1, ?2, ?2, ?3, ?5, ?4, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET balance = balance + ?2, lifetime = lifetime + ?2,
         earned_today = CASE WHEN day = ?3 THEN earned_today + ?5 ELSE ?5 END, day = ?3,
         streak = ?4, streak_day = ?3, best_streak = MAX(best_streak, ?4)`,
      target,
      amount,
      today,
      streak,
      counted,
    );
    return amount;
  }

  /**
   * A community reward paid from outside the routes (events.mjs): only the kinds EARN marks `award`. The earner
   * must be in good standing, and so must the giver when the giver is a member (an `event:` giver is the relay
   * itself); nobody gives to themselves. It goes through pay(), so it is paid once and under every cap that
   * applies, and the earner's Studio hears about it. -> the amount paid.
   */
  async function award({ actor, target, kind, uniq, ref = null, amount = null }) {
    if (EARN[kind]?.award !== true || !isSnowflake(target)) return 0;
    const fromMember = !String(actor).startsWith('event:');
    if (fromMember && (!isSnowflake(actor) || actor === target)) return 0;
    const [targetHeld, actorHeld] = [await heldUntil(target), fromMember ? await heldUntil(actor) : 0];
    const paid = store.transaction(() => {
      if (!standing(target, targetHeld).ok) return 0;
      if (fromMember && !standing(actor, actorHeld).ok) return 0;
      return pay({ actor, target, kind, uniq, ref, amount });
    });
    tell(target, paid, kind);
    return paid;
  }

  /**
   * Spend credits inside the caller's transaction (the Shop): off the balance only, never the lifetime total (so a
   * rank never drops), and never as a credit row, since several sums over credit_events do not look at the sign.
   * The caller keeps its own record of what the credits bought. -> false when the balance is short.
   */
  function spend(uid, amount) {
    const cost = Math.floor(Number(amount) || 0);
    if (cost <= 0) return cost === 0;
    if ((accountRow(uid)?.balance ?? 0) < cost) return false;
    store.run('UPDATE accounts SET balance = balance - ? WHERE user_id = ?', cost, uid);
    return true;
  }

  /**
   * A Shop sale, inside the caller's transaction (shop.mjs): the maker of a community pack earns `amount` from its
   * buyer, once per (buyer, maker, pack). Both must be in good standing (their holds read before the transaction),
   * nobody earns from themselves, and one buyer is worth at most GUARD.salePairWeek credits to one maker in 7 days;
   * what is left of the price is nobody's. Paid through pay(), so once and under the kind's day cap.
   * -> the amount paid (the caller tells the maker once its transaction is done).
   */
  function sale({ buyer, maker, itemId, amount, buyerHeld = 0, makerHeld = 0 }) {
    if (!isSnowflake(buyer) || !isSnowflake(maker) || buyer === maker) return 0;
    if (!standing(buyer, buyerHeld).ok || !standing(maker, makerHeld).ok) return 0;
    const week = Number(store.get(`SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE actor_id = ? AND target_id = ? AND kind = 'sale' AND at > ?`, buyer, maker, now() - 7 * DAY_MS)?.n ?? 0);
    const asked = Math.max(0, Math.min(Math.floor(Number(amount) || 0), GUARD.salePairWeek - week));
    return asked ? pay({ actor: buyer, target: maker, kind: 'sale', uniq: itemId, ref: itemId, amount: asked }) : 0;
  }

  function tell(uid, delta, reason) {
    if (!delta) return;
    const money = account(uid);
    sendToUser(uid, 'credits', { balance: money.balance, lifetime: money.lifetime, today: money.today, delta, reason, rank: rankFor(money.lifetime).key });
  }

  function projectView(row, viewer = null) {
    if (!row) return null;
    const featured = Number(row.featured_until ?? 0) > now();
    const out = {
      id: row.id,
      owner: { id: row.owner_id, name: store.get('SELECT name FROM members WHERE user_id = ?', row.owner_id)?.name ?? 'member', rank: rankFor(accountRow(row.owner_id)?.lifetime ?? 0).key },
      url: row.url,
      host: row.host,
      title: row.title,
      blurb: row.blurb,
      kind: row.kind,
      plays: row.plays,
      stars: row.stars,
      createdAt: row.created_at,
      lastPlayedAt: row.last_played_at ?? null,
      featuredUntil: featured ? row.featured_until : null,
    };
    if (viewer) out.starred = Boolean(store.get('SELECT 1 AS yes FROM stars WHERE project_id = ? AND user_id = ?', row.id, viewer));
    return out;
  }

  const projectRow = (id) => (isOpaqueId(id) ? store.get('SELECT * FROM projects WHERE id = ?', id) : undefined);

  async function playToken(projectId, uid, t) {
    return b64url(await hmac(key, `play1|${projectId}|${uid}|${t}`)).slice(0, 22);
  }

  function me(uid, held = 0) {
    const who = member(uid);
    const money = account(uid);
    const stand = standing(uid, held);
    return {
      user: { id: uid, name: who?.name ?? 'member' },
      credits: { balance: money.balance, lifetime: money.lifetime, today: money.today, todayCap: money.todayCap },
      rank: rankFor(money.lifetime),
      specialRanks: specialRanks(who?.roleKeys, who?.isMod),
      streak: { days: money.streak, best: money.best },
      featureCost: PROJECT_LIMITS.featureCost,
      canEarn: stand.ok,
      hold: stand.ok ? null : { reason: stand.reason, until: stand.until },
      // Studio shows Friends › Moderation only to moderators; every admin route checks again.
      moderator: who?.isMod === true,
      projects: store.all('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC', uid).map((row) => projectView(row, uid)),
    };
  }

  /** A member card anyone signed in may see: name, rank badge, special ranks, a few projects. Never the balance. */
  function card(uid) {
    const who = member(uid);
    if (!who) return null;
    return {
      id: uid,
      name: who.name,
      rank: (({ key, name }) => ({ key, name }))(rankFor(accountRow(uid)?.lifetime ?? 0)),
      specialRanks: specialRanks(who.roleKeys, who.isMod),
      projects: store.all('SELECT * FROM projects WHERE owner_id = ? ORDER BY plays DESC, created_at DESC LIMIT 5', uid).map((row) => projectView(row)),
    };
  }

  /**
   * The Lobby front page's side of the hub, read in one go: the week's top
   * project (plays and stars in the last 7 days; the all-time top when the
   * week is quiet), what was shared this week, who moved up a rank, and the
   * member's own week. Ranks are public; a balance only ever goes to its owner.
   */
  function front(uid, held = 0) {
    const at = now();
    const since = at - FRONT.weekMs;
    const score = new Map();
    const bump = (id, field, n) => { const was = score.get(id) ?? { plays: 0, stars: 0 }; was[field] += n; score.set(id, was); };
    // Plays and stars that count: from members in good standing, each player once a week per project.
    for (const row of store.all('SELECT project_id, COUNT(DISTINCT player_id) AS n FROM play_log WHERE day > ? GROUP BY project_id', dayOf(since))) bump(row.project_id, 'plays', Number(row.n));
    for (const row of store.all('SELECT project_id, COUNT(*) AS n FROM stars WHERE at > ? AND counted = 1 GROUP BY project_id', since)) bump(row.project_id, 'stars', Number(row.n));
    let top = null;
    for (const [id, week] of score) {
      const row = projectRow(id);
      if (!row) continue;
      const points = week.plays + 2 * week.stars;
      if (!top || points > top.points || (points === top.points && row.created_at > top.row.created_at)) top = { row, week, points };
    }
    let topView = top ? { ...projectView(top.row, uid), week: true, weekPlays: top.week.plays, weekStars: top.week.stars } : null;
    if (!topView) {
      const row = store.get('SELECT * FROM projects WHERE plays + stars > 0 ORDER BY plays + 2 * stars DESC, created_at DESC LIMIT 1');
      topView = row ? { ...projectView(row, uid), week: false, weekPlays: 0, weekStars: 0 } : null;
    }
    const fresh = store.all('SELECT * FROM projects WHERE created_at > ? ORDER BY created_at DESC LIMIT ?', since, FRONT.fresh).map((row) => projectView(row, uid));
    // A rank-up: the member's rank now differs from their rank before this week's credits.
    const rankUps = [];
    for (const row of store.all('SELECT target_id, SUM(amount) AS recent, MAX(at) AS last FROM credit_events WHERE at > ? AND amount > 0 GROUP BY target_id ORDER BY last DESC LIMIT 200', since)) {
      const lifetime = accountRow(row.target_id)?.lifetime ?? 0;
      const after = rankFor(lifetime);
      if (rankFor(Math.max(0, lifetime - Number(row.recent))).key === after.key) continue;
      const name = store.get('SELECT name FROM members WHERE user_id = ?', row.target_id)?.name;
      if (name) rankUps.push({ id: row.target_id, name, rank: { key: after.key, name: after.name }, at: row.last });
      if (rankUps.length >= FRONT.rankUps) break;
    }
    const money = account(uid);
    const week = {
      earned: Number(store.get('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE target_id = ? AND at > ?', uid, since)?.n ?? 0),
      plays: Number(store.get('SELECT COUNT(*) AS n FROM (SELECT DISTINCT l.project_id, l.player_id FROM play_log l JOIN projects p ON p.id = l.project_id WHERE p.owner_id = ? AND l.day > ?)', uid, dayOf(since))?.n ?? 0),
      stars: Number(store.get('SELECT COUNT(*) AS n FROM stars s JOIN projects p ON p.id = s.project_id WHERE p.owner_id = ? AND s.at > ? AND s.counted = 1', uid, since)?.n ?? 0),
    };
    const stand = standing(uid, held);
    const projects = Number(store.get('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?', uid)?.n ?? 0);
    return { top: topView, fresh, rankUps, you: { balance: money.balance, lifetime: money.lifetime, rank: rankFor(money.lifetime), week, projects, hold: stand.ok ? null : { reason: stand.reason, until: stand.until } } };
  }

  /** A credit row's giver as a moderator reads it: a member's name, or what a forgotten member or an event is. */
  function giverName(uid) {
    if (String(uid).startsWith('gone:')) return 'a member who used Forget me';
    if (String(uid).startsWith('event:')) return 'a community event';
    return member(uid)?.name ?? store.get('SELECT name FROM members WHERE user_id = ?', uid)?.name ?? 'member';
  }

  /**
   * Who to look at first (GET /v1/admin/credits/flags, and the moderators' alert): members whose last 30 days of
   * credits came mostly from one member, and pairs who each made the other earn a lot. A member who later used Forget
   * me still counts here as the giver they were, under an id that names nobody. -> at most 50, the most credits first.
   */
  function farmingFlags() {
    const since = now() - GUARD.reviewDays * DAY_MS;
    // Left out: a community event's prizes (no member gave them), and co-working rewards, which two people
    // working together always earn from each other; the pair limit caps those, and a review still lists them.
    const pairs = store.all(`SELECT target_id, actor_id, SUM(amount) AS amount FROM credit_events WHERE at > ? AND amount > 0 AND actor_id NOT LIKE 'event:%' AND kind NOT IN ('together', 'cowork') GROUP BY target_id, actor_id`, since);
    const byTarget = new Map();
    const given = new Map(); // "actor>target" -> amount
    for (const row of pairs) {
      const amount = Number(row.amount);
      given.set(`${row.actor_id}>${row.target_id}`, amount);
      const entry = byTarget.get(row.target_id) ?? { total: 0, top: null };
      entry.total += amount;
      if (!entry.top || amount > entry.top.amount) entry.top = { id: row.actor_id, amount };
      byTarget.set(row.target_id, entry);
    }
    const flags = [];
    for (const [uid, entry] of byTarget) {
      const share = entry.total ? entry.top.amount / entry.total : 0;
      const mutual = [...given.keys()].filter((key) => key.endsWith(`>${uid}`)).map((key) => key.split('>')[0])
        .filter((other) => (given.get(`${other}>${uid}`) ?? 0) >= GUARD.flagMutual && (given.get(`${uid}>${other}`) ?? 0) >= GUARD.flagMutual);
      const oneGiver = entry.total >= GUARD.flagMin && share >= GUARD.flagShare;
      if (!oneGiver && !mutual.length) continue;
      const forgotten = GONE_ID.test(entry.top.id);
      flags.push({
        id: uid,
        name: giverName(uid),
        total: entry.total,
        top: { id: forgotten ? null : entry.top.id, name: giverName(entry.top.id), amount: entry.top.amount, share: Math.round(share * 100), accountCreatedAt: accountCreatedAt(entry.top.id), ...(forgotten ? { forgotten: true } : {}) },
        why: oneGiver ? 'one-giver' : 'mutual',
        mutual: mutual.slice(0, 5).map((other) => ({ id: other, name: giverName(other) })),
      });
    }
    flags.sort((x, y) => y.total - x.total);
    return flags.slice(0, 50);
  }

  function routes(route) {
    const reply = (status, body) => ({ status, body });
    const fail = (status, error, extra = {}) => reply(status, { ok: false, error, ...extra });

    route('GET', '/v1/me', async ({ actor }) => reply(200, { ok: true, ...me(actor.uid, await heldUntil(actor.uid)) }));

    route('GET', '/v1/members/:id/card', ({ params }) => {
      if (!isSnowflake(params.id)) return fail(400, 'bad-request');
      const view = card(params.id);
      return view ? reply(200, { ok: true, member: view }) : fail(404, 'not-found');
    });

    route('GET', '/v1/projects', ({ actor, query }) => {
      const view = String(query?.get?.('view') ?? 'new');
      const at = now();
      const order = { new: 'created_at DESC', top: 'plays + 2 * stars DESC, created_at DESC', played: 'COALESCE(last_played_at, 0) DESC' }[view] ?? 'created_at DESC';
      const rows =
        view === 'mine'
          ? store.all('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC', actor.uid)
          : store.all(`SELECT * FROM projects ORDER BY ${order} LIMIT ?`, PROJECT_LIMITS.listMax);
      const featured = store.all('SELECT * FROM projects WHERE featured_until > ? ORDER BY featured_until DESC', at);
      return reply(200, { ok: true, projects: rows.map((row) => projectView(row, actor.uid)), featured: featured.map((row) => projectView(row, actor.uid)) });
    });

    route(
      'POST',
      '/v1/projects',
      ({ actor, body }) => {
        if (actor.isNew) return fail(403, 'forbidden', { reason: 'links-not-allowed' });
        const link = projectLink(body.url);
        if (!link) return fail(400, 'bad-request', { reason: 'bad-link' });
        const title = cleanLine(body.title, PROJECT_LIMITS.titleChars);
        if (!title) return fail(400, 'bad-request', { reason: 'title' });
        const blurb = cleanLine(body.blurb ?? '', PROJECT_LIMITS.blurbChars);
        const kind = PROJECT_KINDS.includes(body.kind) ? body.kind : 'other';
        const at = now();
        const result = store.transaction(() => {
          const count = (sql, ...args) => Number(store.get(sql, ...args)?.n ?? 0);
          if (store.get('SELECT id FROM projects WHERE owner_id = ? AND url = ?', actor.uid, link.href)) return { error: fail(409, 'conflict', { reason: 'already-shared' }) };
          if (count('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?', actor.uid) >= PROJECT_LIMITS.perOwner) return { error: fail(409, 'limit', { reason: 'owned-projects' }) };
          if (count('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ? AND created_at > ?', actor.uid, at - DAY_MS) >= PROJECT_LIMITS.createsPerDay) return { error: fail(409, 'limit', { reason: 'daily-shares' }) };
          if (count('SELECT COUNT(*) AS n FROM projects') >= PROJECT_LIMITS.hubTotal) return { error: fail(409, 'limit', { reason: 'hub-full' }) };
          const id = newId('proj');
          // Sharing is free and pays nothing by itself: credits come when members play it.
          store.run('INSERT INTO projects (id, owner_id, url, host, title, blurb, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, actor.uid, link.href, link.host, title, blurb, kind, at, at);
          return { id };
        });
        if (result.error) return result.error;
        return reply(201, { ok: true, project: projectView(projectRow(result.id), actor.uid), credited: 0 });
      },
      { write: true, body: 'shareProject' },
    );

    route(
      'PUT',
      '/v1/projects/:id',
      ({ actor, params, body }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        if (row.owner_id !== actor.uid) return fail(403, 'forbidden');
        const title = body.title === undefined ? row.title : cleanLine(body.title, PROJECT_LIMITS.titleChars);
        if (!title) return fail(400, 'bad-request', { reason: 'title' });
        const blurb = body.blurb === undefined ? row.blurb : cleanLine(body.blurb, PROJECT_LIMITS.blurbChars);
        const kind = PROJECT_KINDS.includes(body.kind) ? body.kind : row.kind;
        store.run('UPDATE projects SET title = ?, blurb = ?, kind = ?, updated_at = ? WHERE id = ?', title, blurb, kind, now(), row.id);
        return reply(200, { ok: true, project: projectView(projectRow(row.id), actor.uid) });
      },
      { write: true, body: 'editProject' },
    );

    route(
      'DELETE',
      '/v1/projects/:id',
      ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        if (row.owner_id !== actor.uid && !actor.isMod) return fail(403, 'forbidden');
        store.transaction(() => {
          store.run('DELETE FROM stars WHERE project_id = ?', row.id);
          store.run('DELETE FROM projects WHERE id = ?', row.id);
          if (row.owner_id !== actor.uid) store.run('INSERT INTO audit (kind, actor_id, target_id, detail, at) VALUES (?, ?, ?, ?, ?)', 'project-remove', actor.uid, row.owner_id, JSON.stringify({ projectId: row.id }), now());
        });
        return reply(200, { ok: true });
      },
      { write: true, readOnlyOk: true },
    );

    // Reporting a project (spam, a broken or unsafe link, someone else's work):
    // it joins the moderators' report list with its card, once per member.
    route(
      'POST',
      '/v1/projects/:id/report',
      ({ actor, params, body }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        if (row.owner_id === actor.uid) return fail(403, 'forbidden', { reason: 'self' });
        const rate = projectReports.take(actor.uid);
        if (!rate.ok) return fail(429, 'rate-limited', { retryAfter: rate.retryAfterMs });
        store.run(
          'INSERT INTO reports (id, room_id, message_id, author_id, reporter_id, reason, text, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (reporter_id, message_id) DO NOTHING',
          newId('rep'),
          'project',
          row.id,
          row.owner_id,
          actor.uid,
          body.reason,
          `${row.title} · ${row.url}`,
          now(),
        );
        return reply(202, { ok: true });
      },
      { body: 'reportProject', readOnlyOk: true },
    );

    // Playing: a token now, and a finish at least two minutes later counts the play.
    route(
      'POST',
      '/v1/projects/:id/play',
      async ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        const rate = playStarts.take(actor.uid);
        if (!rate.ok) return fail(429, 'rate-limited', { retryAfter: rate.retryAfterMs });
        const t = now();
        const token = `${t.toString(36)}.${await playToken(row.id, actor.uid, t)}`;
        return reply(200, { ok: true, url: row.url, token, minMs: PROJECT_LIMITS.playMinMs, expiresAt: t + PROJECT_LIMITS.playMaxMs });
      },
      { readOnlyOk: true },
    );

    route(
      'POST',
      '/v1/projects/:id/played',
      async ({ actor, params, body }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        const [stamp, mac] = String(body.token).split('.');
        const t = parseInt(stamp, 36);
        if (!Number.isSafeInteger(t) || !mac || !sameBytes(await playToken(row.id, actor.uid, t), mac)) return fail(400, 'bad-request', { reason: 'token' });
        const at = now();
        if (at - t < PROJECT_LIMITS.playMinMs) return fail(409, 'conflict', { reason: 'too-soon', retryAfter: PROJECT_LIMITS.playMinMs - (at - t) });
        if (at - t > PROJECT_LIMITS.playMaxMs) return fail(410, 'gone', { reason: 'expired' });
        if (row.owner_id === actor.uid) return reply(200, { ok: true, counted: false, credited: { owner: 0, you: 0 }, why: 'own' });
        // A token pays only for the day it started, so one play cannot count on both sides of midnight.
        const day = dayOf(t);
        const [playerHeld, ownerHeld] = [await heldUntil(actor.uid), await heldUntil(row.owner_id)];
        const result = store.transaction(() => {
          const stand = actor.readOnly ? { ok: false, reason: 'read-only' } : standing(actor.uid, playerHeld);
          const player = stand.ok;
          const both = player && standing(row.owner_id, ownerHeld).ok;
          // The play log: once per player and day, from members in good standing (the jam's votes read it).
          const fresh = player && Boolean(store.get('INSERT INTO play_log (project_id, player_id, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING day', row.id, actor.uid, day));
          // The project's plays, which "Top" ranks by: once a week per player, so playing it every day adds nothing more.
          const weekly = fresh && !store.get('SELECT 1 AS yes FROM play_log WHERE project_id = ? AND player_id = ? AND day BETWEEN ? AND ?', row.id, actor.uid, day - 6, day - 1);
          if (fresh) store.run('UPDATE projects SET plays = plays + ?, last_played_at = ? WHERE id = ?', weekly ? 1 : 0, at, row.id);
          // The maker earns once a day per player, whichever of their projects was played; the player once a day per maker.
          const owner = both ? pay({ actor: actor.uid, target: row.owner_id, kind: 'played', uniq: `d${day}`, ref: row.id }) : 0;
          const you = both ? pay({ actor: row.owner_id, target: actor.uid, kind: 'play', uniq: `d${day}`, ref: row.id }) : 0;
          // Why nothing was paid, in a word Studio turns into a sentence: the player's hold, the maker's, plays switched
          // off by a moderator, or a limit already reached.
          const why = !player ? stand.reason : !both ? 'maker-held' : isOff('plays') ? 'paused' : !owner && !you ? 'limit' : null;
          return { counted: fresh, owner, you, why };
        });
        tell(row.owner_id, result.owner, 'played');
        tell(actor.uid, result.you, 'play');
        return reply(200, { ok: true, counted: result.counted, credited: { owner: result.owner, you: result.you }, ...(result.why ? { why: result.why } : {}) });
      },
      { body: 'playFinish', readOnlyOk: true },
    );

    route(
      'POST',
      '/v1/projects/:id/star',
      async ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        if (row.owner_id === actor.uid) return fail(403, 'forbidden', { reason: 'self' });
        const rate = starTaps.take(actor.uid);
        if (!rate.ok) return fail(429, 'rate-limited', { retryAfter: rate.retryAfterMs });
        const [starrerHeld, ownerHeld] = [await heldUntil(actor.uid), await heldUntil(row.owner_id)];
        const result = store.transaction(() => {
          const at = now();
          const starrer = standing(actor.uid, starrerHeld).ok;
          // A star from a member not in good standing is kept for them but not counted.
          const added = store.get('INSERT INTO stars (project_id, user_id, at, counted) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING at', row.id, actor.uid, at, starrer ? 1 : 0);
          if (!added) return { paid: 0 };
          if (starrer) store.run('UPDATE projects SET stars = stars + 1 WHERE id = ?', row.id);
          // A member's stars pay a maker once a week, whichever project or link: unstarring, re-sharing or a new project never pays twice.
          return { paid: starrer && standing(row.owner_id, ownerHeld).ok ? pay({ actor: actor.uid, target: row.owner_id, kind: 'starred', uniq: `w${weekOf(at)}`, ref: row.id }) : 0 };
        });
        tell(row.owner_id, result.paid, 'starred');
        return reply(200, { ok: true, project: projectView(projectRow(row.id), actor.uid) });
      },
      { write: true },
    );

    route(
      'DELETE',
      '/v1/projects/:id/star',
      ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        store.transaction(() => {
          const gone = store.get('DELETE FROM stars WHERE project_id = ? AND user_id = ? RETURNING counted', row.id, actor.uid);
          if (gone?.counted === 1) store.run('UPDATE projects SET stars = MAX(0, stars - 1) WHERE id = ?', row.id);
        });
        return reply(200, { ok: true, project: projectView(projectRow(row.id), actor.uid) });
      },
      { write: true, readOnlyOk: true },
    );

    // Who to look at first: members whose last 30 days of credits came mostly
    // from one member, and pairs who each made the other earn a lot.
    route('GET', '/v1/admin/credits/flags', () => reply(200, { ok: true, days: GUARD.reviewDays, flags: farmingFlags() }), { mod: true });

    // The switches (SWITCHES): what a moderator turned off, and turning one off or back on (audited). Never a write
    // route, so they work while the relay is paused too. Registered before /v1/admin/credits/:uid, which would match.
    route('GET', '/v1/admin/credits/switches', () => reply(200, { ok: true, off: [...switchedOff()].sort(), switches: Object.keys(SWITCHES) }), { mod: true });
    route(
      'POST',
      '/v1/admin/credits/switches',
      ({ actor, body }) => {
        const key = body?.key;
        if (typeof key !== 'string' || !Object.hasOwn(SWITCHES, key) || typeof body?.on !== 'boolean') return fail(400, 'bad-request');
        const off = store.transaction(() => {
          const next = switchedOff();
          if (body.on) next.delete(key);
          else next.add(key);
          store.setMeta('credits_off', JSON.stringify([...next].sort()));
          store.run('INSERT INTO audit (kind, actor_id, detail, at) VALUES (?, ?, ?, ?)', 'credits-switch', actor.uid, JSON.stringify({ key, on: body.on }), now());
          return [...next].sort();
        });
        return reply(200, { ok: true, off, switches: Object.keys(SWITCHES) });
      },
      { mod: true },
    );

    // Moderators: where a member's credits came from in the last 30 days, by
    // who caused them, with how old the account is and whether it may earn.
    // A farm shows as one or two names giving most of the total.
    route(
      'GET',
      '/v1/admin/credits/:uid',
      async ({ params }) => {
        if (!isSnowflake(params.uid)) return fail(400, 'bad-request');
        const who = member(params.uid);
        if (!who) return fail(404, 'not-found');
        const since = now() - GUARD.reviewDays * DAY_MS;
        const rows = store.all(
          'SELECT actor_id, SUM(amount) AS amount, COUNT(*) AS events FROM credit_events WHERE target_id = ? AND at > ? AND amount > 0 GROUP BY actor_id ORDER BY amount DESC LIMIT 50',
          params.uid,
          since,
        );
        const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
        const givers = rows.map((row) => {
          // Not a member: a community event's prize (events.mjs), or someone who used Forget me, whose id here is a
          // random one that names nobody, so a moderator can still take back what they gave (revoke's `from`).
          const event = String(row.actor_id).startsWith('event:');
          const forgotten = GONE_ID.test(row.actor_id);
          const giver = event || forgotten ? null : member(row.actor_id);
          return {
            id: event ? null : row.actor_id,
            name: giverName(row.actor_id),
            ...(forgotten ? { forgotten: true } : {}),
            amount: Number(row.amount),
            events: Number(row.events),
            share: total ? Math.round((Number(row.amount) / total) * 100) : 0,
            accountCreatedAt: event || forgotten ? null : accountCreatedAt(row.actor_id),
            joinedAt: giver?.joinedAt ?? null,
          };
        });
        const money = account(params.uid);
        return reply(200, {
          ok: true,
          member: { id: params.uid, name: who.name, accountCreatedAt: accountCreatedAt(params.uid), joinedAt: who.joinedAt, standing: standing(params.uid, await heldUntil(params.uid)) },
          credits: { balance: money.balance, lifetime: money.lifetime, rank: rankFor(money.lifetime).key },
          days: GUARD.reviewDays,
          total,
          givers,
        });
      },
      { mod: true },
    );

    // Taking back credits that came from farming: every credit the member
    // earned in the last `days` (all of them, or only those `from` one
    // member, or from one who used Forget me since, by the id the review
    // shows for them), off the balance and the lifetime total (so the rank
    // too). The rows stay with amount 0, so the same plays and stars can never
    // pay again.
    route(
      'POST',
      '/v1/admin/credits/:uid/revoke',
      ({ actor, params, body }) => {
        const days = body?.days === undefined ? GUARD.reviewDays : Number(body.days);
        const from = body?.from === undefined || body?.from === null ? null : String(body.from);
        if (!isSnowflake(params.uid) || !Number.isSafeInteger(days) || days < 1 || days > 180 || (from !== null && !isSnowflake(from) && !GONE_ID.test(from))) return fail(400, 'bad-request');
        if (!member(params.uid) && !accountRow(params.uid)) return fail(404, 'not-found');
        const since = now() - days * DAY_MS;
        const total = store.transaction(() => {
          const where = from ? 'target_id = ? AND actor_id = ? AND at > ? AND amount > 0' : 'target_id = ? AND at > ? AND amount > 0';
          const args = from ? [params.uid, from, since] : [params.uid, since];
          const sum = Number(store.get(`SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE ${where}`, ...args)?.n ?? 0);
          if (!sum) return 0;
          store.run(`UPDATE credit_events SET amount = 0 WHERE ${where}`, ...args);
          store.run('UPDATE accounts SET balance = MAX(0, balance - ?1), lifetime = MAX(0, lifetime - ?1) WHERE user_id = ?2', sum, params.uid);
          store.run('INSERT INTO audit (kind, actor_id, target_id, detail, at) VALUES (?, ?, ?, ?, ?)', 'credits-revoke', actor.uid, params.uid, JSON.stringify({ from, days, total: sum }), now());
          return sum;
        });
        tell(params.uid, -total, 'revoked');
        const money = account(params.uid);
        return reply(200, { ok: true, revoked: total, credits: { balance: money.balance, lifetime: money.lifetime, rank: rankFor(money.lifetime).key } });
      },
      { mod: true },
    );

    // Spending: a day at the top of the hub, three slots at once, one per owner.
    route(
      'POST',
      '/v1/projects/:id/feature',
      ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        if (row.owner_id !== actor.uid) return fail(403, 'forbidden');
        // A moderator switched featuring off for now (SWITCHES): nothing is spent.
        if (isOff('featuring')) return fail(409, 'limit', { reason: 'featuring-paused' });
        const at = now();
        const result = store.transaction(() => {
          const live = store.all('SELECT owner_id, featured_until FROM projects WHERE featured_until > ? ORDER BY featured_until', at);
          if (live.some((item) => item.owner_id === actor.uid)) return { error: fail(409, 'limit', { reason: 'one-featured' }) };
          if (live.length >= PROJECT_LIMITS.featureSlots) return { error: fail(409, 'limit', { reason: 'featured-full', retryAfter: live[0].featured_until - at }) };
          if (Number(row.cooldown_until ?? 0) > at) return { error: fail(409, 'limit', { reason: 'cooldown', retryAfter: row.cooldown_until - at }) };
          // Once a week per owner, so removing and sharing a project again never skips the wait.
          const last = Number(store.get('SELECT MAX(ends_at) AS t FROM features WHERE owner_id = ?', actor.uid)?.t ?? 0);
          if (last && last + PROJECT_LIMITS.featureCooldownMs > at) return { error: fail(409, 'limit', { reason: 'cooldown', retryAfter: last + PROJECT_LIMITS.featureCooldownMs - at }) };
          const money = accountRow(actor.uid);
          if ((money?.balance ?? 0) < PROJECT_LIMITS.featureCost) return { error: fail(409, 'limit', { reason: 'credits', need: PROJECT_LIMITS.featureCost, balance: money?.balance ?? 0 }) };
          const until = at + PROJECT_LIMITS.featureMs;
          store.run('UPDATE accounts SET balance = balance - ? WHERE user_id = ?', PROJECT_LIMITS.featureCost, actor.uid);
          store.run('UPDATE projects SET featured_until = ?, cooldown_until = ? WHERE id = ?', until, until + PROJECT_LIMITS.featureCooldownMs, row.id);
          store.run('INSERT INTO features (project_id, owner_id, cost, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)', row.id, actor.uid, PROJECT_LIMITS.featureCost, at, until);
          return { until };
        });
        if (result.error) return result.error;
        tell(actor.uid, -PROJECT_LIMITS.featureCost, 'feature');
        return reply(200, { ok: true, featuredUntil: result.until, balance: account(actor.uid).balance });
      },
      { write: true },
    );
  }

  /**
   * Forget me: the member's credits, projects, stars and plays. The credits
   * they gave others stay, under a random id that names nobody (and with no
   * project), for the 180 days every credit row is kept: the receivers'
   * daily and weekly limits still count them, and a moderator can still see
   * them and take them back, so second accounts cannot hide what they paid
   * someone by forgetting themselves. The fingerprint holds this account's
   * credits for 30 days, so forgetting and coming back cannot reset a limit.
   */
  function forget(uid, print) {
    for (const row of store.all('SELECT id FROM projects WHERE owner_id = ?', uid)) store.run('DELETE FROM stars WHERE project_id = ?', row.id);
    store.run('DELETE FROM projects WHERE owner_id = ?', uid);
    for (const row of store.all('SELECT project_id FROM stars WHERE user_id = ? AND counted = 1', uid)) store.run('UPDATE projects SET stars = MAX(0, stars - 1) WHERE id = ?', row.project_id);
    store.run('DELETE FROM stars WHERE user_id = ?', uid);
    store.run('DELETE FROM play_log WHERE player_id = ?', uid);
    if (print) {
      store.run('UPDATE OR IGNORE credit_events SET actor_id = ?, ref = NULL WHERE actor_id = ? AND target_id <> ?', `gone:${b64url(randomBytes(12))}`, uid, uid);
      store.run('INSERT INTO credit_holds (fingerprint, until) VALUES (?, ?) ON CONFLICT (fingerprint) DO UPDATE SET until = excluded.until', print, now() + GUARD.forgetHoldMs);
    }
    store.run('DELETE FROM credit_events WHERE actor_id = ? OR target_id = ?', uid, uid);
    store.run('DELETE FROM features WHERE owner_id = ?', uid);
    store.run('DELETE FROM accounts WHERE user_id = ?', uid);
  }

  /** Daily: projects nobody played for 90 days go, and credit history past 180 days. */
  function upkeep() {
    const at = now();
    for (const row of store.all('SELECT id FROM projects WHERE COALESCE(last_played_at, created_at) < ?', at - PROJECT_LIMITS.idleMs)) {
      store.run('DELETE FROM stars WHERE project_id = ?', row.id);
      store.run('DELETE FROM projects WHERE id = ?', row.id);
    }
    store.run('DELETE FROM credit_events WHERE at < ?', at - PROJECT_LIMITS.eventKeepMs);
    store.run('DELETE FROM credit_holds WHERE until < ?', at);
    store.run('DELETE FROM play_log WHERE day < ?', dayOf(at) - 8);
    store.run('DELETE FROM features WHERE ends_at < ?', at - PROJECT_LIMITS.eventKeepMs);
  }

  return Object.freeze({ routes, forget, fingerprint, upkeep, me, card, account, front, standing, heldUntil, award, spend, sale, tell, farmingFlags, isOff, facts });
}
