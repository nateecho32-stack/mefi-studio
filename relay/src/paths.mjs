// Claim path grammar for cowork leases (pure and self-contained). Carried
// over unchanged from the Void Engine hub's src/claims/paths.mjs.
//
// A claim names repo-relative POSIX paths. Each one is either an exact file
// ("src/app.js") or a directory with everything under it ("src/**"). The hub
// only compares these strings; it never touches a file system. The file has
// no imports, so Mefi's Studio can vendor it next to src/protocol.mjs (as its
// scripts/room-claims.cjs) and both ends agree on what overlaps. Studio's local
// sameFile() is deliberately looser (it matches basenames); remote claims use
// this grammar instead.
//
//   normalizeClaimPath('.\\src\\App.js')          -> { ok: true, path: 'src/App.js' }
//   normalizeClaimPath('../secrets')              -> { ok: false, error: 'must not contain ".." segments' }
//   normalizeClaimPaths(['src/**', 'README.md'])  -> { ok: true, paths: ['src/**', 'README.md'] }
//   pathsOverlap('src/**', 'SRC/app.js')          -> true   (case-folded)
//   pathsOverlap('src/a', 'src/ab')               -> false  (whole segments only)
//
// normalizeClaimPath applies these rules in order:
//   1. A string of 1-200 UTF-16 code units, well-formed Unicode, with no NUL or
//      other control character and no leading or trailing whitespace.
//   2. Backslashes become "/", and only then is the path checked.
//   3. Not absolute ("/x", "//server/share") and no drive letter ("C:", "c:/x").
//   4. No trailing "/" (a directory claim is "dir/**").
//   5. Empty and "." segments are dropped ("./a//b" -> "a/b"); ".." is refused.
//   6. "*" and "?" are refused, except for one final "/**". A bare "**" (the
//      whole repository) is refused: claim the directories you need.
// The original letter case is kept for display. Comparisons fold case (NFC,
// then toLowerCase), so "Src/A.js" and "src/a.js" are the same file, as on
// Windows and macOS. Folding can only add overlaps, never hide one.

export const CLAIM_PATH_LIMITS = Object.freeze({
  maxPaths: 50, // per claim (protocol LIMITS.claimPaths)
  maxChars: 200, // per path, UTF-16 code units (protocol LIMITS.claimPathChars)
});

const DIR_SUFFIX = '/**';
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE = /^[A-Za-z]:/;
const WILDCARD = /[*?]/;
const WHOLE_REPO = '"**" alone would claim the whole repository; claim "dir/**" instead';

const fail = (error) => ({ ok: false, error });

/** normalizeClaimPath(path) -> { ok: true, path } | { ok: false, error } */
export function normalizeClaimPath(input) {
  if (typeof input !== 'string') return fail('must be a string');
  if (input.length === 0) return fail('must not be empty');
  if (input.length > CLAIM_PATH_LIMITS.maxChars) return fail(`must be at most ${CLAIM_PATH_LIMITS.maxChars} characters`);
  if (input.includes('\u0000')) return fail('must not contain NUL');
  if (CONTROL.test(input)) return fail('must not contain control characters');
  if (!input.isWellFormed()) return fail('must be well-formed Unicode');
  if (input.trim() !== input) return fail('must not start or end with whitespace');

  const slashed = input.replaceAll('\\', '/');
  if (slashed.startsWith('/')) return fail('must be relative to the repository root, not absolute');
  if (DRIVE.test(slashed)) return fail('must not start with a drive letter');
  if (slashed.endsWith('/')) return fail('must not end with "/"; claim a directory as "dir/**"');

  const dir = slashed === '**' || slashed.endsWith(DIR_SUFFIX);
  const body = slashed === '**' ? '' : dir ? slashed.slice(0, -DIR_SUFFIX.length) : slashed;
  const segments = [];
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return fail('must not contain ".." segments');
    if (WILDCARD.test(segment)) return fail('must be an exact file or "dir/**"; other wildcards are not allowed');
    segments.push(segment);
  }
  if (segments.length === 0) return fail(dir ? WHOLE_REPO : 'must name a file');
  return { ok: true, path: dir ? `${segments.join('/')}${DIR_SUFFIX}` : segments.join('/') };
}

/**
 * normalizeClaimPaths(list) -> { ok: true, paths } | { ok: false, error, index }
 * At most 50 entries. [] is valid: a presence-only claim. Duplicates (after
 * case folding) are dropped, and the first spelling is kept.
 */
export function normalizeClaimPaths(list) {
  if (!Array.isArray(list)) return { ok: false, error: 'paths must be an array', index: -1 };
  if (list.length > CLAIM_PATH_LIMITS.maxPaths) {
    return { ok: false, error: `paths must hold at most ${CLAIM_PATH_LIMITS.maxPaths} entries`, index: -1 };
  }
  const paths = [];
  const seen = new Set();
  for (let index = 0; index < list.length; index += 1) {
    const result = normalizeClaimPath(list[index]);
    if (!result.ok) return { ok: false, error: `paths[${index}] ${result.error}`, index };
    const key = keyOf(result.path);
    const id = `${key.dir ? 'd' : 'f'}:${key.base}`;
    if (seen.has(id)) continue;
    seen.add(id);
    paths.push(result.path);
  }
  return { ok: true, paths };
}

function foldCase(text) {
  return text.normalize('NFC').toLowerCase();
}

// A normalized path -> { dir, base }, where base is the folded path without "/**".
function keyOf(normalized) {
  const dir = normalized.endsWith(DIR_SUFFIX);
  return { dir, base: foldCase(dir ? normalized.slice(0, -DIR_SUFFIX.length) : normalized) };
}

/**
 * claimPathKey(path) -> { dir, base }: the folded comparison key. It throws a
 * TypeError for a path the grammar refuses, because that is a caller bug.
 */
export function claimPathKey(path) {
  const result = normalizeClaimPath(path);
  if (!result.ok) throw new TypeError(`not a claim path: ${result.error}`);
  return keyOf(result.path);
}

const within = (path, dir) => path === dir || path.startsWith(`${dir}/`);

/** Do two keys from claimPathKey overlap? */
export function keysOverlap(a, b) {
  if (a.dir && b.dir) return within(a.base, b.base) || within(b.base, a.base);
  if (a.dir) return within(b.base, a.base);
  if (b.dir) return within(a.base, b.base);
  return a.base === b.base;
}

/**
 * pathsOverlap(a, b) -> boolean. A case-folded prefix test that respects whole
 * path segments:
 *   file vs file: the same file.
 *   "d/**" vs file: the file is d itself or lies under d/.
 *   "d/**" vs "e/**": one directory contains the other.
 * "src/**" also overlaps a file named "src": one name cannot safely be a file
 * on one machine and a directory on another. Throws a TypeError for paths the
 * grammar refuses.
 */
export function pathsOverlap(a, b) {
  return keysOverlap(claimPathKey(a), claimPathKey(b));
}

/** overlappingPaths(mine, theirs) -> the entries of theirs that overlap any entry of mine. */
export function overlappingPaths(mine, theirs) {
  if (mine.length === 0 || theirs.length === 0) return [];
  const mineKeys = mine.map(claimPathKey);
  return theirs.filter((path) => {
    const key = claimPathKey(path);
    return mineKeys.some((own) => keysOverlap(own, key));
  });
}
