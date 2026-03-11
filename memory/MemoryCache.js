/**
 * @fileoverview Query result cache for memory retrieval deduplication.
 *               Prevents redundant embedding + DB calls for identical queries
 *               within a short time window.
 * @module memory/MemoryCache
 */

import crypto from 'crypto';

// ============================================================================
// CONSTANTS
// ============================================================================

const QUERY_CACHE_TTL_MS        = 2 * 60 * 1000; // 2 minutes
const MAX_QUERY_CACHE_SIZE      = 200;
const MIN_QUERY_LENGTH_FOR_CACHE = 10;

// ============================================================================
// MEMORY CACHE
// ============================================================================

class MemoryCache {
  constructor() {
    /**
     * @type {Map<string, { results: object[], timestamp: number, historyId: string }>}
     * queryHash → cached retrieval result
     */
    this.queryCache = new Map();
  }

  // ── Query cache ───────────────────────────────────────────────────────────

  /**
   * Generate a deterministic MD5 hash for a (historyId, query, userId, guildId) tuple.
   *
   * @param {string}      historyId
   * @param {string}      query
   * @param {string|null} userId
   * @param {string|null} guildId
   * @returns {string}
   */
  generateQueryHash(historyId, query, userId = null, guildId = null) {
    const input = `${historyId}:${query}:${userId ?? ''}:${guildId ?? ''}`;
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Return cached query results if present and not expired.
   * Short queries (< MIN_QUERY_LENGTH_FOR_CACHE) are never cached.
   *
   * @param {string}      historyId
   * @param {string}      query
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {object[]|null}
   */
  getCachedQueryResults(historyId, query, userId = null, guildId = null) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) return null;

    const hash   = this.generateQueryHash(historyId, query, userId, guildId);
    const cached = this.queryCache.get(hash);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > QUERY_CACHE_TTL_MS) {
      this.queryCache.delete(hash);
      return null;
    }

    return cached.results;
  }

  /**
   * Store query results in the cache.
   * No-op for queries shorter than MIN_QUERY_LENGTH_FOR_CACHE.
   *
   * @param {string}      historyId
   * @param {string}      query
   * @param {object[]}    results
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   */
  cacheQueryResults(historyId, query, results, userId = null, guildId = null) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) return;

    const hash = this.generateQueryHash(historyId, query, userId, guildId);
    this.queryCache.set(hash, { results, timestamp: Date.now(), historyId });

    // LRU eviction — Map preserves insertion order
    if (this.queryCache.size > MAX_QUERY_CACHE_SIZE) {
      this.queryCache.delete(this.queryCache.keys().next().value);
    }
  }

  /**
   * Invalidate all cached results for a given historyId.
   * Call this after new memories are stored for that history.
   *
   * @param {string} historyId
   */
  invalidateQueryCache(historyId) {
    for (const [hash, data] of this.queryCache.entries()) {
      if (data.historyId === historyId) this.queryCache.delete(hash);
    }
  }

  /** Clear the entire query cache. */
  clearCache() {
    this.queryCache.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const memoryCache = new MemoryCache();
