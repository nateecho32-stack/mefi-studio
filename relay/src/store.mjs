// The relay's SQLite store: the schema, its migrations and a small facade.
//
// On Cloudflare the database is the Hub Durable Object's own SQLite
// (ctx.storage.sql); under Node the tests use node:sqlite (relay/node/sql.mjs).
// Both are reached through one port:
//
//   sql.exec(query, ...bindings) -> rows (an array of plain objects)
//   sql.transaction(fn)          -> fn's result, all or nothing
//
// What is kept, and why, is listed in relay/README.md. Chat text, files, IP
// addresses and Discord tokens are never written here.

export const SCHEMA_VERSION = 6;

// One statement per entry: Cloudflare's exec runs a single statement when it has bindings.
const V1 = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  // People who have signed in to the relay: the Discord id, the name shown in rooms,
  // the Discord facts the rules read (roles, join date, timeout) and when they were checked.
  `CREATE TABLE IF NOT EXISTS members (
     user_id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     name_key TEXT NOT NULL,
     role_keys TEXT NOT NULL DEFAULT '[]',
     is_mod INTEGER NOT NULL DEFAULT 0,
     joined_at INTEGER,
     timed_out_until INTEGER,
     pending INTEGER NOT NULL DEFAULT 0,
     suspended_until INTEGER,
     checked_at INTEGER NOT NULL,
     first_seen INTEGER NOT NULL,
     last_seen INTEGER NOT NULL
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS members_name ON members (name_key)`,
  // A keyed hash of a Discord access token the relay has already checked, so a
  // renewal does not ask Discord again. Never the token itself.
  `CREATE TABLE IF NOT EXISTS token_cache (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT, WITHOUT ROWID`,
  // Signed-out sessions (kind 'sid') and members whose sessions all ended (kind 'uid').
  `CREATE TABLE IF NOT EXISTS revoked (kind TEXT NOT NULL, key TEXT NOT NULL, not_before INTEGER NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (kind, key)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS rooms (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     name TEXT NOT NULL,
     owner_id TEXT,
     policy TEXT NOT NULL,
     listed INTEGER NOT NULL,
     max_members INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'active',
     member_count INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     closed_at INTEGER
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS rooms_open ON rooms (status, listed)`,
  `CREATE INDEX IF NOT EXISTS rooms_owner ON rooms (owner_id, status)`,
  `CREATE TABLE IF NOT EXISTS room_members (room_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (room_id, user_id)) STRICT, WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS room_members_user ON room_members (user_id)`,
  `CREATE TABLE IF NOT EXISTS removals (room_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (room_id, user_id)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS join_requests (
     id TEXT PRIMARY KEY,
     room_id TEXT NOT NULL,
     requester_id TEXT NOT NULL,
     note TEXT,
     status TEXT NOT NULL DEFAULT 'pending',
     decided_by TEXT,
     created_at INTEGER NOT NULL,
     decided_at INTEGER
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS join_requests_room ON join_requests (room_id, status)`,
  `CREATE INDEX IF NOT EXISTS join_requests_requester ON join_requests (requester_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS invites (
     id TEXT PRIMARY KEY,
     room_id TEXT NOT NULL,
     invitee_id TEXT NOT NULL,
     invited_by TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     expires_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     decided_at INTEGER
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS invites_invitee ON invites (invitee_id, status)`,
  `CREATE INDEX IF NOT EXISTS invites_inviter ON invites (invited_by, created_at)`,
  // A room's shared player while one runs: link, label, who started it and the position at updatedAt.
  `CREATE TABLE IF NOT EXISTS listen_sessions (room_id TEXT PRIMARY KEY, session TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT`,
  // Cowork claim leases, as the Void Engine hub keeps them.
  `CREATE TABLE IF NOT EXISTS leases (
     lease_id TEXT PRIMARY KEY,
     room_id TEXT NOT NULL,
     member_id TEXT NOT NULL,
     machine_id TEXT NOT NULL,
     run_id TEXT,
     task_key TEXT,
     scope_hash TEXT,
     paths_json TEXT NOT NULL DEFAULT '[]',
     exclusive INTEGER NOT NULL DEFAULT 1,
     branch TEXT,
     base_sha TEXT,
     title TEXT,
     fence INTEGER NOT NULL,
     at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     released_at INTEGER,
     release_reason TEXT
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS leases_room_live ON leases (room_id, released_at, expires_at)`,
  `CREATE TABLE IF NOT EXISTS fences (room_id TEXT PRIMARY KEY, last_fence INTEGER NOT NULL DEFAULT 0) STRICT`,
  // Deleted message ids for a week, so a peer's copy cannot bring a deleted message back.
  `CREATE TABLE IF NOT EXISTS tombstones (message_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, at INTEGER NOT NULL) STRICT, WITHOUT ROWID`,
  // A report keeps the reporter's copy of the message only when its relay signature checks out.
  `CREATE TABLE IF NOT EXISTS reports (
     id TEXT PRIMARY KEY,
     room_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     author_id TEXT,
     reporter_id TEXT NOT NULL,
     reason TEXT NOT NULL,
     text TEXT,
     verified INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'open',
     created_at INTEGER NOT NULL,
     UNIQUE (reporter_id, message_id)
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, actor_id TEXT, target_id TEXT, room_id TEXT, detail TEXT, at INTEGER NOT NULL) STRICT`,
];

// v2: credits, ranks and the project hub (credits.mjs). Ids, counters and project cards only.
const V2 = [
  `CREATE TABLE IF NOT EXISTS accounts (
     user_id TEXT PRIMARY KEY,
     balance INTEGER NOT NULL DEFAULT 0,
     lifetime INTEGER NOT NULL DEFAULT 0,
     day INTEGER NOT NULL DEFAULT 0,
     earned_today INTEGER NOT NULL DEFAULT 0,
     streak INTEGER NOT NULL DEFAULT 0,
     streak_day INTEGER NOT NULL DEFAULT 0,
     best_streak INTEGER NOT NULL DEFAULT 0
   ) STRICT`,
  // One row per credit, so each is paid once: (who caused it, who earned it, kind, what makes it unique).
  `CREATE TABLE IF NOT EXISTS credit_events (
     id INTEGER PRIMARY KEY,
     actor_id TEXT NOT NULL,
     target_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     ref TEXT,
     uniq TEXT NOT NULL,
     day INTEGER NOT NULL,
     amount INTEGER NOT NULL,
     at INTEGER NOT NULL,
     UNIQUE (actor_id, target_id, kind, uniq)
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS credit_events_target_day ON credit_events (target_id, kind, day)`,
  `CREATE INDEX IF NOT EXISTS credit_events_at ON credit_events (at)`,
  // A shared project is a card: a public link, a title and a blurb. Never a file.
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL,
     url TEXT NOT NULL,
     host TEXT NOT NULL,
     title TEXT NOT NULL,
     blurb TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT 'other',
     plays INTEGER NOT NULL DEFAULT 0,
     stars INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_played_at INTEGER,
     featured_until INTEGER,
     cooldown_until INTEGER,
     UNIQUE (owner_id, url)
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS projects_created ON projects (created_at)`,
  `CREATE TABLE IF NOT EXISTS stars (project_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (project_id, user_id)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS features (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, owner_id TEXT NOT NULL, cost INTEGER NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL) STRICT`,
];

// v3: connecting made simple. A short join code per room (anyone with it may
// join), and whether a member shows in Who's online.
const V3 = [
  `CREATE TABLE IF NOT EXISTS room_codes (code TEXT PRIMARY KEY, room_id TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL) STRICT, WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS room_codes_room ON room_codes (room_id)`,
  `ALTER TABLE members ADD COLUMN online_hidden INTEGER NOT NULL DEFAULT 0`,
];

// v4: credits that cannot be farmed (relay/src/credits.mjs GUARD). A project's
// plays count once per player and day (play_log); a star counts only from a
// member in good standing (stars.counted); after Forget me, a keyed
// fingerprint of the account holds its credits for 30 days (credit_holds);
// and credits between two members are summed by pair (credit_events_pair).
const V4 = [
  `CREATE TABLE IF NOT EXISTS play_log (project_id TEXT NOT NULL, player_id TEXT NOT NULL, day INTEGER NOT NULL, PRIMARY KEY (project_id, player_id, day)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS credit_holds (fingerprint TEXT PRIMARY KEY, until INTEGER NOT NULL) STRICT, WITHOUT ROWID`,
  `ALTER TABLE stars ADD COLUMN counted INTEGER NOT NULL DEFAULT 1`,
  `CREATE INDEX IF NOT EXISTS credit_events_pair ON credit_events (actor_id, target_id, at)`,
];

// v5: community events the relay runs by itself (events.mjs) and the daily
// community budget (economy.mjs). An event is a weekly Build Jam or a co-work
// hour; entries name a shared project, votes name an entrant, attendance is a
// count of the moments a member was seen in a co-work hour's room, and
// together_ticks counts the same for members' own co-work rooms, one row per
// member and day (kept a week). econ_days fixes each day's active count.
const V5 = [
  `CREATE TABLE IF NOT EXISTS events (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     theme TEXT,
     room_id TEXT,
     starts_at INTEGER NOT NULL,
     entries_until INTEGER,
     ends_at INTEGER NOT NULL,
     checks_done INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'open',
     pool INTEGER,
     results TEXT,
     closed_at INTEGER
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS events_open ON events (kind, status, ends_at)`,
  `CREATE TABLE IF NOT EXISTS event_entries (event_id TEXT NOT NULL, user_id TEXT NOT NULL, project_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (event_id, user_id)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS event_votes (event_id TEXT NOT NULL, voter_id TEXT NOT NULL, entrant_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (event_id, voter_id, entrant_id)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS event_attendance (event_id TEXT NOT NULL, user_id TEXT NOT NULL, checks INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (event_id, user_id)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS together_ticks (day INTEGER NOT NULL, user_id TEXT NOT NULL, ticks INTEGER NOT NULL DEFAULT 0, partner_id TEXT, last_at INTEGER NOT NULL, PRIMARY KEY (day, user_id)) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS econ_days (day INTEGER PRIMARY KEY, active INTEGER NOT NULL) STRICT`,
  `CREATE INDEX IF NOT EXISTS credit_events_day_kind ON credit_events (day, kind)`,
];

// v6: the Shop (shop.mjs). Members' style packs, data only (colours and a few
// keys from Studio's lists, checked by shop-pack.mjs), and who owns what,
// Studio's own items and packs alike. A purchase is kept here as the item and
// what the member paid (a tip included), never as a negative credit row.
const V6 = [
  `CREATE TABLE IF NOT EXISTS shop_packs (
     id TEXT PRIMARY KEY,
     maker_id TEXT NOT NULL,
     name TEXT NOT NULL,
     blurb TEXT NOT NULL DEFAULT '',
     price INTEGER NOT NULL,
     data TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'listed',
     sales INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS shop_packs_listed ON shop_packs (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS shop_packs_maker ON shop_packs (maker_id)`,
  `CREATE TABLE IF NOT EXISTS shop_owned (user_id TEXT NOT NULL, item_id TEXT NOT NULL, price INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, item_id)) STRICT, WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS shop_owned_item ON shop_owned (item_id)`,
];

export const MIGRATIONS = Object.freeze([
  { version: 1, statements: V1 },
  { version: 2, statements: V2 },
  { version: 3, statements: V3 },
  { version: 4, statements: V4 },
  { version: 5, statements: V5 },
  { version: 6, statements: V6 },
]);

const bindValue = (value) => (value === undefined ? null : value === true ? 1 : value === false ? 0 : value);

/**
 * createStore(sql) -> { all, get, run, transaction, migrate, meta, setMeta }
 * transaction(fn) nests: only the outermost call opens a platform transaction.
 */
export function createStore(sql) {
  if (typeof sql?.exec !== 'function' || typeof sql?.transaction !== 'function') throw new TypeError('createStore needs { exec, transaction }');
  let depth = 0;
  const all = (query, ...params) => sql.exec(query, ...params.map(bindValue));
  const get = (query, ...params) => all(query, ...params)[0];
  const run = (query, ...params) => {
    all(query, ...params);
  };
  function transaction(fn) {
    if (depth > 0) return fn();
    depth += 1;
    try {
      return sql.transaction(fn);
    } finally {
      depth -= 1;
    }
  }
  const meta = (key) => get('SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
  const setMeta = (key, value) => run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, String(value));

  function migrate() {
    run(V1[0]);
    const current = Number(meta('schema_version') ?? 0);
    for (const step of MIGRATIONS) {
      if (step.version <= current) continue;
      transaction(() => {
        for (const statement of step.statements) run(statement);
        setMeta('schema_version', step.version);
      });
    }
    return Number(meta('schema_version'));
  }

  return Object.freeze({ all, get, run, transaction, migrate, meta, setMeta });
}
