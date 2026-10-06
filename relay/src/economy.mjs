// The community budget: how many credits the community rewards may pay out
// in a day, so the economy grows with the people in it instead of with how
// hard anyone farms it.
//
// Plays and stars keep their fixed amounts (credits.mjs EARN: a play pays the
// maker 5 and the player 2, a star pays the maker 3) under their own caps.
// The rewards that come from the community itself, building together, the
// co-work hours and the weekly Build Jam (events.mjs), share one budget:
//
//   budget(day) = 200 + 25 for every member seen in the last 7 days, at most 5,000
//
// Together and co-work rewards pay only from what is left of the day's
// budget, so on a busy day the last ones pay less, and never more than the
// budget. The Build Jam's prize pool is half of what the budget left unspent
// over the jam's week (at least 60, at most 450): a quiet week grows the
// prizes, a busy one shrinks them. Every number is worked out from the
// credit rows the relay already keeps, plus one row a day here (econ_days)
// that fixes the day's active count, so a day's budget never moves under it.
// Nothing here is per member, and nothing is shown to anyone but as totals.

import { DAY_MS } from './util.mjs';

export const ECONOMY = Object.freeze({
  basePerDay: 200,
  perActiveMember: 25,
  maxPerDay: 5000,
  activeWindowMs: 7 * DAY_MS,
  // The kinds paid from the day's budget (credits.mjs EARN marks them `community`).
  dailyKinds: Object.freeze(['together', 'cowork']),
  // The Build Jam's pool: this share of what the budget left over the jam's days.
  jamShare: 0.5,
  jamPoolMin: 60,
  jamPoolMax: 450,
  keepDays: 400,
});

export const dayOf = (ms) => Math.floor(ms / DAY_MS);

/**
 * createEconomy({ store, now })
 * -> { budget(day), paid(day), left(day), cap(kind, amount, day), jamPool(fromDay, toDay), status(), upkeep() }
 */
export function createEconomy({ store, now }) {
  const kinds = ECONOMY.dailyKinds;
  const marks = kinds.map(() => '?').join(', ');

  /** Members seen in the window before `at` (their Studio signed in or renewed). */
  function activeAt(at) {
    return Number(store.get('SELECT COUNT(*) AS n FROM members WHERE last_seen > ?', at - ECONOMY.activeWindowMs)?.n ?? 0);
  }

  /** The day's active count, fixed the first time the day is asked about. */
  function activeFor(day) {
    const row = store.get('SELECT active FROM econ_days WHERE day = ?', day);
    if (row) return Number(row.active);
    const today = dayOf(now());
    // A past day nobody asked about while it ran: today's count is the best guess there is.
    const active = activeAt(day >= today ? now() : (day + 1) * DAY_MS);
    store.run('INSERT INTO econ_days (day, active) VALUES (?, ?) ON CONFLICT (day) DO NOTHING', day, active);
    return active;
  }

  function budget(day = dayOf(now())) {
    return Math.min(ECONOMY.maxPerDay, ECONOMY.basePerDay + ECONOMY.perActiveMember * activeFor(day));
  }

  /** What the day's budget has paid already: the together and co-work rewards. */
  function paid(day = dayOf(now())) {
    return Number(store.get(`SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events WHERE day = ? AND kind IN (${marks})`, day, ...kinds)?.n ?? 0);
  }

  function left(day = dayOf(now())) {
    return Math.max(0, budget(day) - paid(day));
  }

  /** The most a reward of `kind` may pay now: the day's budget caps the community kinds. */
  function cap(kind, amount, day = dayOf(now())) {
    return kinds.includes(kind) ? Math.max(0, Math.min(amount, left(day))) : amount;
  }

  /** The Build Jam's prize pool for the days fromDay..toDay (inclusive). */
  function jamPool(fromDay, toDay) {
    let spare = 0;
    for (let day = fromDay; day <= toDay; day += 1) spare += left(day);
    return Math.max(ECONOMY.jamPoolMin, Math.min(ECONOMY.jamPoolMax, Math.floor(spare * ECONOMY.jamShare)));
  }

  /** Totals for the Lobby: today's budget, what it paid, how many members it counts. */
  function status() {
    const day = dayOf(now());
    const total = budget(day);
    const spent = paid(day);
    return { day, budget: total, paid: spent, left: Math.max(0, total - spent), active: activeFor(day) };
  }

  function upkeep() {
    store.run('DELETE FROM econ_days WHERE day < ?', dayOf(now()) - ECONOMY.keepDays);
  }

  return Object.freeze({ activeAt, budget, paid, left, cap, jamPool, status, upkeep });
}
