// Credits, ranks and the project hub.
//
// Members share their projects as small cards (a public https link, a title
// and a short blurb; never a file) and play each other's. Sharing is free and
// earns nothing on its own. Credits come from playing: when a member plays
// someone else's project for two minutes, both of them earn (the maker 5, the
// player 2), and a star earns the maker 3. Credits are never bought and never
// cashed out; they are spent on featuring a project at the top of the hub for
// a day.
//
// Ranks come in two kinds. Levels follow lifetime credits (Spark, Ember,
// Flame, Comet, Star, Nova, Void) and are badges in Studio only. Special
// ranks are the member's own Discord roles (Builder, Helper, Mentor,
// Spotlight...), which moderators grant as before: credits never hand out a
// Discord role, so the bot's "points never grant a role" rule stands.
//
// Against farming: nobody earns from their own project, every credit is one
// row keyed (actor, target, kind, uniq) so it is paid once, members need a
// day in the server to give or earn, and each kind has a daily cap under an
// overall 60 a day. There are no invite or referral rewards (Discord's
// platform rules), no reaction rewards and no public leaderboard: a balance
// is private, a rank badge is public.

import { publicLink, publicHost } from './media.mjs';
import { DAY_MS, MINUTE_MS, b64url, cleanLine, hmac, isOpaqueId, isSnowflake, newId, sameBytes } from './util.mjs';

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
  played: Object.freeze({ amount: 5, perDay: 30 }), // the owner, when a member plays it for 2 minutes: once per (player, project, day)
  play: Object.freeze({ amount: 2, perDay: 10 }), // the player, for playing someone else's project: once per (project, day)
  starred: Object.freeze({ amount: 3, perDay: 15 }), // the owner, for a star: once per (member, project), ever
  dayCap: 60,
});

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
 * -> { routes(route), forget(uid), upkeep(), me(uid), card(uid), account(uid), front(uid) }
 */
export function createCredits({ store, now, key, sendToUser, member }) {
  const accountRow = (uid) => store.get('SELECT * FROM accounts WHERE user_id = ?', uid);

  function account(uid) {
    const row = accountRow(uid);
    const today = dayOf(now());
    const earnedToday = row && row.day === today ? row.earned_today : 0;
    const streakLive = row && row.streak_day >= today - 1 ? row.streak : 0;
    return { balance: row?.balance ?? 0, lifetime: row?.lifetime ?? 0, today: earnedToday, todayCap: EARN.dayCap, streak: streakLive, best: row?.best_streak ?? 0 };
  }

  /** Pay credits inside the caller's transaction: once per (actor, target, kind, uniq), under the kind's and the day's caps. -> the amount paid. */
  function pay({ actor, target, kind, uniq, ref = null }) {
    const rule = EARN[kind];
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
    const kindToday = Number(store.get('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE target_id = ? AND kind = ? AND day = ?', target, kind, today)?.n ?? 0);
    const row = accountRow(target);
    const earnedToday = row && row.day === today ? row.earned_today : 0;
    const amount = Math.max(0, Math.min(rule.amount, rule.perDay - kindToday, EARN.dayCap - earnedToday));
    if (amount === 0) return 0;
    store.run('UPDATE credit_events SET amount = ? WHERE id = ?', amount, inserted.id);
    const streakDay = row?.streak_day ?? 0;
    const streak = streakDay === today ? row.streak : streakDay === today - 1 ? row.streak + 1 : 1;
    store.run(
      `INSERT INTO accounts (user_id, balance, lifetime, day, earned_today, streak, streak_day, best_streak) VALUES (?1, ?2, ?2, ?3, ?2, ?4, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET balance = balance + ?2, lifetime = lifetime + ?2,
         earned_today = CASE WHEN day = ?3 THEN earned_today + ?2 ELSE ?2 END, day = ?3,
         streak = ?4, streak_day = ?3, best_streak = MAX(best_streak, ?4)`,
      target,
      amount,
      today,
      streak,
    );
    return amount;
  }

  function tell(uid, delta, reason) {
    if (!delta) return;
    const money = account(uid);
    sendToUser(uid, 'credits', { balance: money.balance, lifetime: money.lifetime, today: money.today, delta, reason, rank: rankFor(money.lifetime).key });
  }

  const canEarn = (who) => who && !who.readOnly && !who.isNew;

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

  function me(uid) {
    const who = member(uid);
    const money = account(uid);
    return {
      user: { id: uid, name: who?.name ?? 'member' },
      credits: { balance: money.balance, lifetime: money.lifetime, today: money.today, todayCap: money.todayCap },
      rank: rankFor(money.lifetime),
      specialRanks: specialRanks(who?.roleKeys, who?.isMod),
      streak: { days: money.streak, best: money.best },
      featureCost: PROJECT_LIMITS.featureCost,
      canEarn: canEarn(who),
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
  function front(uid) {
    const at = now();
    const since = at - FRONT.weekMs;
    const score = new Map();
    const bump = (id, field, n) => { const was = score.get(id) ?? { plays: 0, stars: 0 }; was[field] += n; score.set(id, was); };
    for (const row of store.all(`SELECT ref, COUNT(*) AS n FROM credit_events WHERE kind = 'played' AND at > ? AND ref IS NOT NULL GROUP BY ref`, since)) bump(row.ref, 'plays', Number(row.n));
    for (const row of store.all('SELECT project_id, COUNT(*) AS n FROM stars WHERE at > ? GROUP BY project_id', since)) bump(row.project_id, 'stars', Number(row.n));
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
      plays: Number(store.get(`SELECT COUNT(*) AS n FROM credit_events WHERE target_id = ? AND kind = 'played' AND at > ?`, uid, since)?.n ?? 0),
      stars: Number(store.get('SELECT COUNT(*) AS n FROM stars s JOIN projects p ON p.id = s.project_id WHERE p.owner_id = ? AND s.at > ?', uid, since)?.n ?? 0),
    };
    return { top: topView, fresh, rankUps, you: { balance: money.balance, lifetime: money.lifetime, rank: rankFor(money.lifetime), week } };
  }

  function routes(route) {
    const reply = (status, body) => ({ status, body });
    const fail = (status, error, extra = {}) => reply(status, { ok: false, error, ...extra });

    route('GET', '/v1/me', ({ actor }) => reply(200, { ok: true, ...me(actor.uid) }));

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

    // Playing: a token now, and a finish at least two minutes later counts the play.
    route(
      'POST',
      '/v1/projects/:id/play',
      async ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
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
        if (row.owner_id === actor.uid) return reply(200, { ok: true, counted: false, credited: { owner: 0, you: 0 } });
        const today = dayOf(at);
        const result = store.transaction(() => {
          const fresh = !store.get(`SELECT 1 AS yes FROM credit_events WHERE actor_id = ? AND target_id = ? AND kind = 'played' AND uniq = ?`, actor.uid, row.owner_id, `${today}:${row.id}`);
          if (fresh) store.run('UPDATE projects SET plays = plays + 1, last_played_at = ? WHERE id = ?', at, row.id);
          const owner = canEarn(actor) && member(row.owner_id) ? pay({ actor: actor.uid, target: row.owner_id, kind: 'played', uniq: `${today}:${row.id}`, ref: row.id }) : 0;
          const you = canEarn(actor) ? pay({ actor: row.owner_id, target: actor.uid, kind: 'play', uniq: `${today}:${row.id}`, ref: row.id }) : 0;
          return { counted: fresh, owner, you };
        });
        tell(row.owner_id, result.owner, 'played');
        tell(actor.uid, result.you, 'play');
        return reply(200, { ok: true, counted: result.counted, credited: { owner: result.owner, you: result.you } });
      },
      { body: 'playFinish', readOnlyOk: true },
    );

    route(
      'POST',
      '/v1/projects/:id/star',
      ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        if (row.owner_id === actor.uid) return fail(403, 'forbidden', { reason: 'self' });
        const result = store.transaction(() => {
          const added = store.get('INSERT INTO stars (project_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING at', row.id, actor.uid, now());
          if (!added) return { paid: 0 };
          store.run('UPDATE projects SET stars = stars + 1 WHERE id = ?', row.id);
          // Once per (member, project) ever: unstarring and starring again never pays twice.
          return { paid: canEarn(actor) ? pay({ actor: actor.uid, target: row.owner_id, kind: 'starred', uniq: row.id, ref: row.id }) : 0 };
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
          const gone = store.get('DELETE FROM stars WHERE project_id = ? AND user_id = ? RETURNING at', row.id, actor.uid);
          if (gone) store.run('UPDATE projects SET stars = MAX(0, stars - 1) WHERE id = ?', row.id);
        });
        return reply(200, { ok: true, project: projectView(projectRow(row.id), actor.uid) });
      },
      { write: true, readOnlyOk: true },
    );

    // Spending: a day at the top of the hub, three slots at once, one per owner.
    route(
      'POST',
      '/v1/projects/:id/feature',
      ({ actor, params }) => {
        const row = projectRow(params.id);
        if (!row) return fail(404, 'not-found');
        if (row.owner_id !== actor.uid) return fail(403, 'forbidden');
        const at = now();
        const result = store.transaction(() => {
          const live = store.all('SELECT owner_id, featured_until FROM projects WHERE featured_until > ? ORDER BY featured_until', at);
          if (live.some((item) => item.owner_id === actor.uid)) return { error: fail(409, 'limit', { reason: 'one-featured' }) };
          if (live.length >= PROJECT_LIMITS.featureSlots) return { error: fail(409, 'limit', { reason: 'featured-full', retryAfter: live[0].featured_until - at }) };
          if (Number(row.cooldown_until ?? 0) > at) return { error: fail(409, 'limit', { reason: 'cooldown', retryAfter: row.cooldown_until - at }) };
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

  /** Forget me: the member's credits, events on either side, projects and stars. */
  function forget(uid) {
    for (const row of store.all('SELECT id FROM projects WHERE owner_id = ?', uid)) store.run('DELETE FROM stars WHERE project_id = ?', row.id);
    store.run('DELETE FROM projects WHERE owner_id = ?', uid);
    for (const row of store.all('SELECT project_id FROM stars WHERE user_id = ?', uid)) store.run('UPDATE projects SET stars = MAX(0, stars - 1) WHERE id = ?', row.project_id);
    store.run('DELETE FROM stars WHERE user_id = ?', uid);
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
    store.run('DELETE FROM features WHERE ends_at < ?', at - PROJECT_LIMITS.eventKeepMs);
  }

  return Object.freeze({ routes, forget, upkeep, me, card, account, front });
}
