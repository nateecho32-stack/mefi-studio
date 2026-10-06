// Mefi's Studio AI+ — what one board push carries (main.cjs sendRows).
//
// Pure module: no Electron, no filesystem, no network, no clock reads.
//
// eyes:tasks was every card on the board (about 0.67 MB for 134 cards) and
// went out on every board write, up to once a second per running job;
// eyes:checkpoints was the whole checkpoint store. Each push now carries only
// what the page does not hold yet. Once the page holds a list it gets the rows
// whose content changed or that are new (`upsert`), the ids that left
// (`remove`), and the id order only when it moved (`order`). A keyed object
// such as the checkpoint store travels as `set` / `del` instead. The page's
// bridge (preload.cjs installBridge, mergeRows) rebuilds the whole list and
// reuses the row objects it kept for unchanged rows, so every listener still
// receives a plain list.
//
// A row's content is its JSON without `runProgress` (rowSignature): the
// executor's checkpoints move only that field, and they travel as the small
// eyes:progress push instead (main.cjs mutateBoard). A list goes whole in
// these cases:
// - the first push;
// - the first push after a project switch;
// - the first push after resync(), which the page asks for (eyes:rows-sync)
//   when a push's `base` is not the rev it holds;
// - any list whose rows cannot all be keyed (a row without an id, or an id
//   twice), as before.
// A push that would carry nothing is null: nothing is sent and the rev stays
// where it was, so the page's next base still matches.

// The row's content as the page shows it, without the executor's progress.
function rowSignature(row) {
  try {
    if (row && typeof row === "object" && !Array.isArray(row) && Object.hasOwn(row, "runProgress")) {
      const { runProgress: _progress, ...rest } = row;
      return JSON.stringify(rest);
    }
    const text = JSON.stringify(row);
    return text === undefined ? "null" : text;
  } catch {
    return {}; // unreadable: a fresh object never matches, so the row always goes
  }
}

const idOf = (row) => (row && typeof row === "object" && typeof row.id === "string" && row.id ? row.id : null);

// `key` names a row (default: its string `id`); a custom key rides along as
// `ids`, so the bridge can name the rows it gets. `signature` is a row's
// content. `start` is the first rev: main passes the clock, so a rev from an
// earlier run never matches.
function createRowPush({ key = null, signature = rowSignature, start = 0 } = {}) {
  const keyOf = typeof key === "function" ? key : idOf;
  const sign = typeof signature === "function" ? signature : rowSignature;
  let rev = Number.isFinite(start) ? start : 0;
  let held = null; // what the page holds: { projectId, object, order, sigs }
  let latest = null; // the newest list handed to payload(), for a resync's resend

  // Ids in list order, each row's signature, and where each array row sits;
  // null when the rows cannot all be keyed.
  function table(rows) {
    if (Array.isArray(rows)) {
      const order = new Array(rows.length);
      const sigs = new Map();
      const index = new Map();
      for (let at = 0; at < rows.length; at += 1) {
        const id = keyOf(rows[at]);
        if (typeof id !== "string" || !id || sigs.has(id)) return null;
        order[at] = id;
        index.set(id, at);
        sigs.set(id, sign(rows[at]));
      }
      return { object: false, order, sigs, index };
    }
    if (rows && typeof rows === "object") {
      const order = Object.keys(rows);
      const sigs = new Map();
      for (const id of order) sigs.set(id, sign(rows[id]));
      return { object: true, order, sigs, index: null };
    }
    return null;
  }

  function payload(rows, { projectId = null } = {}) {
    latest = { rows, projectId };
    const next = table(rows);
    if (!held || !next || held.projectId !== projectId || held.object !== next.object) {
      rev += 1;
      held = next ? { projectId, object: next.object, order: next.order, sigs: next.sigs } : null;
      return { rev, full: true, rows, projectId, ...(next && !next.object && key ? { ids: next.order } : {}) };
    }
    const changed = next.order.filter((id) => held.sigs.get(id) !== next.sigs.get(id));
    const remove = held.order.filter((id) => !next.sigs.has(id));
    // The order the page arrives at by itself: what it kept, then the new ids.
    const natural = held.order.filter((id) => next.sigs.has(id));
    for (const id of next.order) if (!held.sigs.has(id)) natural.push(id);
    const moved = natural.some((id, at) => id !== next.order[at]);
    if (!changed.length && !remove.length && !moved) return null;
    const base = rev;
    rev += 1;
    held = { projectId, object: next.object, order: next.order, sigs: next.sigs };
    const order = moved ? { order: next.order } : {};
    if (next.object) return { rev, base, projectId, set: Object.fromEntries(changed.map((id) => [id, rows[id]])), del: remove, ...order };
    return { rev, base, projectId, upsert: changed.map((id) => rows[next.index.get(id)]), remove, ...order, ...(key ? { ids: changed } : {}) };
  }

  // The page holds nothing usable: the next push is whole.
  function resync() {
    held = null;
  }

  return { payload, resync, last: () => latest };
}

module.exports = { createRowPush, rowSignature };
