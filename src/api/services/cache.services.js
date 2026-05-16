/**
 * In-memory TTL cache used to avoid hammering Kickbase when we need
 * historical league snapshots. This is a single-instance cache — fine for
 * Cloud Run's per-instance lifecycle, but if we ever scale beyond a
 * handful of instances we should move this to Firestore or Redis so the
 * cache is shared.
 *
 * Past matchdays should ideally get long TTLs (the data never changes
 * once a matchday is finished) and the current matchday a short one.
 * For step-3 v1 we use a single conservative TTL and revisit if Kickbase
 * load gets uncomfortable.
 */

const cache = new Map();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read a cached value. Returns `null` when the key is missing or expired.
 * Expired entries are evicted on read so the Map doesn't grow unbounded.
 *
 * @param {string} key
 * @returns {unknown}
 *
 * @example
 *   const snapshot = getCached(`ranking:${leagueId}:${day}`);
 *   if (snapshot) return snapshot;
 */
export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a value with the given TTL. Default TTL is 5 minutes; pass
 * a longer TTL for finalized historical data (past matchdays).
 *
 * @param {string} key
 * @param {unknown} value
 * @param {number} [ttlMs=300000]
 *
 * @example
 *   setCached(`ranking:${leagueId}:${day}`, snapshot, 24 * 60 * 60 * 1000);
 */
export function setCached(key, value, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Clear the entire cache. Intended for tests; do not call in production
 * code paths.
 */
export function clearCache() {
  cache.clear();
}
